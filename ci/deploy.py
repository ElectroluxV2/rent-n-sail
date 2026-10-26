"""Branch deployment resolution and portable, credential-free build outputs.

Only non-secret resource references cross job outputs. Runtime credentials stay
in a private runner file and are applied after the portable artifact is saved.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ARTIFACT_VERSION = 2


class DeploymentError(RuntimeError):
    pass


def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise DeploymentError(f"Configure {name} before deploying.")
    return value


def output(name, value):
    value = str(value)
    if any(character in value for character in "\r\n\0"):
        raise DeploymentError("Invalid multiline workflow output.")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"{name}={value}\n")


def mask(value):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        escaped = value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::add-mask::{escaped}", flush=True)


class JsonApi:
    def __init__(self, base, token, query=None):
        self.base = base
        self.token = token
        self.query = query or {}

    def request(self, method, path, *, query=None, data=None, missing=False):
        params = {**self.query, **(query or {})}
        url = self.base + path + ("?" + urlencode(params) if params else "")
        request = Request(
            url,
            data=json.dumps(data).encode() if data is not None else None,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        for attempt in range(3):
            try:
                with urlopen(request, timeout=60) as response:
                    return json.load(response)
            except HTTPError as error:
                if missing and error.code == 404:
                    return None
                if (
                    method == "GET"
                    and error.code in (423, 429, 502, 503, 504)
                    and attempt < 2
                ):
                    time.sleep(2**attempt)
                    continue
                # Report useful precondition errors, never raw response bodies.
                try:
                    body = json.loads(error.read())
                    detail = body.get("message") or body.get("error", {}).get(
                        "message", ""
                    )
                    if not isinstance(detail, str):
                        detail = ""
                except (ValueError, AttributeError):
                    detail = ""
                for secret in (
                    self.token,
                    *(
                        os.environ.get(key, "")
                        for key in ("VERCEL_TOKEN", "NEON_API_KEY", "GITHUB_TOKEN")
                    ),
                ):
                    if secret:
                        detail = detail.replace(secret, "<REDACTED>")
                detail = re.sub(
                    r"(?:postgres(?:ql)?|https?)://\S+", "<REDACTED URL>", detail
                )[:500]
                raise DeploymentError(
                    f"{self.base} {method} {path}: HTTP {error.code}. {detail}"
                ) from None


class Neon:
    def __init__(self, api, project, database="neondb", role="neondb_owner"):
        self.api, self.project, self.database, self.role = api, project, database, role

    def parent(self, selected=""):
        branches = self.api.request("GET", f"/projects/{quote(self.project)}/branches")[
            "branches"
        ]
        matches = [
            branch
            for branch in branches
            if (selected and selected in (branch["id"], branch["name"]))
            or (not selected and branch.get("default"))
        ]
        if len(matches) != 1:
            raise DeploymentError(
                "Set NEON_PARENT_BRANCH_ID to an unambiguous production parent."
            )
        return matches[0]["id"]

    def connection(self, branch, *, pooled):
        result = self.api.request(
            "GET",
            f"/projects/{quote(self.project)}/connection_uri",
            query={
                "branch_id": branch,
                "database_name": self.database,
                "role_name": self.role,
                "pooled": str(pooled).lower(),
            },
        )
        mask(result["uri"])
        return result["uri"]

    def ensure_branch(self, name, parent):
        path = f"/projects/{quote(self.project)}/branches"
        branches = self.api.request("GET", path)["branches"]
        matches = [branch for branch in branches if branch["name"] == name]
        if len(matches) > 1:
            raise DeploymentError("The preview branch name is ambiguous.")
        if matches:
            return matches[0]["id"]
        # Inherit supported project defaults rather than overriding compute or
        # autosuspend settings on managed/free plans.
        result = self.api.request(
            "POST",
            path,
            data={
                "branch": {"name": name, "parent_id": parent},
                "endpoints": [{"type": "read_write"}],
            },
        )
        return result["branch"]["id"]


def neon():
    return Neon(
        JsonApi("https://console.neon.tech/api/v2", required("NEON_API_KEY")),
        required("NEON_PROJECT_ID"),
        os.environ.get("NEON_DATABASE_NAME") or "neondb",
        os.environ.get("NEON_ROLE_NAME") or "neondb_owner",
    )


def select_deployment(deployments, branch, target):
    candidates = [
        deployment
        for deployment in deployments
        if (
            deployment.get("readyState", deployment.get("state")) == "READY"
            and (
                (target == "production" and deployment.get("target") == "production")
                or (
                    target == "preview"
                    and deployment.get("target") != "production"
                    and deployment.get("meta", {}).get("githubCommitRef") == branch
                )
            )
        )
    ]
    return max(
        candidates,
        key=lambda item: item.get("createdAt", item.get("created", 0)),
        default=None,
    )


def resolve_mode(build, preview, production, fingerprint):
    if build:
        return "build", None
    if preview and preview.get("meta", {}).get("rnsConfigHash") == fingerprint:
        return "reuse", preview
    source = preview or production
    if not source or not source.get("meta", {}).get("rnsArtifactId"):
        raise DeploymentError(
            "No retained prebuilt output is available. Run the selected application's manual "
            "workflow with build=true once; ordinary Vercel redeploy would rebuild source."
        )
    return "restore", source


class Vercel:
    def __init__(self, api):
        self.api = api

    def project(self, identifier):
        return self.api.request("GET", f"/v9/projects/{quote(identifier)}")

    def deployments(self, project):
        deployments, cursor = [], None
        for _ in range(10):
            query = {"projectId": project, "state": "READY", "limit": 100}
            if cursor:
                query["until"] = cursor
            page = self.api.request("GET", "/v6/deployments", query=query)
            deployments.extend(page["deployments"])
            cursor = page.get("pagination", {}).get("next")
            if not cursor:
                return deployments
        raise DeploymentError(
            "Deployment history exceeds the resolver's pagination limit."
        )

    def alias(self, hostname, project):
        alias = self.api.request("GET", f"/v4/aliases/{quote(hostname)}", missing=True)
        if alias and alias.get("projectId") != project:
            raise DeploymentError("The requested alias belongs to another project.")
        return alias

    def assign(self, hostname, project, deployment):
        existing = self.alias(hostname, project)
        if existing and existing.get("deploymentId") == deployment:
            return
        self.api.request(
            "POST",
            f"/v2/deployments/{quote(deployment)}/aliases",
            data={"alias": hostname},
        )


def alias_name(project_name, branch, target):
    if target == "production":
        return f"{project_name}.vercel.app"
    digest = hashlib.sha256(f"{project_name}:{branch}".encode()).hexdigest()[:12]
    return f"{project_name[:42]}-preview-{digest}.vercel.app"


def fingerprint(runtime):
    return hashlib.sha256(
        json.dumps(
            {"protocol": ARTIFACT_VERSION, "runtime": runtime}, sort_keys=True
        ).encode()
    ).hexdigest()


def save_private(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(data, stream)


def plan_application(
    component, *, provider, database, branch, target, build, state_path, github=None
):
    project = provider.project(required(f"VERCEL_{component.upper()}_PROJECT_ID"))
    frontend = provider.project(required("VERCEL_FRONTEND_PROJECT_ID"))
    frontend_alias = alias_name(frontend["name"], branch, target)
    # Reserve/verify ownership before granting this exact origin CORS access.
    # A missing preview alias temporarily points at the already-public stable app.
    if target == "preview" and not provider.alias(frontend_alias, frontend["id"]):
        stable = select_deployment(
            provider.deployments(frontend["id"]), branch, "production"
        )
        if not stable:
            raise DeploymentError(
                "Create the initial production frontend before reserving preview URLs."
            )
        provider.assign(
            frontend_alias, frontend["id"], stable.get("uid", stable.get("id"))
        )
    if component == "backend":
        runtime = {
            "DATABASE_URL": database.connection(
                required("NEON_BRANCH_ID"), pooled=True
            ),
            "CORS_ALLOWED_ORIGINS": "https://" + frontend_alias,
        }
    else:
        runtime = {
            "BACKEND_URL": required("BACKEND_URL"),
            "FRONTEND_URL": "https://" + frontend_alias,
        }
    identity = fingerprint(runtime)
    deployments = provider.deployments(project["id"]) if not build else []
    existing = select_deployment(deployments, branch, target)
    stable = select_deployment(deployments, branch, "production")
    mode, source = resolve_mode(build, existing, stable, identity)
    state = {
        "component": component,
        "project_id": project["id"],
        "branch": branch,
        "target": target,
        "runtime": runtime,
        "fingerprint": identity,
        "alias": alias_name(project["name"], branch, target),
        "mode": mode,
        "source": source,
    }
    save_private(state_path, state)
    output("mode", mode)
    if mode == "restore":
        metadata = source["meta"]
        artifact_id = str(metadata["rnsArtifactId"])
        if github is None:
            raise DeploymentError(
                "Artifact access requires an authenticated GitHub client."
            )
        artifact = github.request(
            "GET",
            f"/repos/{required('GITHUB_REPOSITORY')}/actions/artifacts/{quote(artifact_id)}",
        )
        if artifact.get("expired") or artifact["name"] != metadata["rnsArtifactName"]:
            raise DeploymentError(
                "The retained build artifact is expired or has an unexpected identity."
            )
        if str(artifact.get("workflow_run", {}).get("id")) != str(
            metadata["rnsArtifactRunId"]
        ):
            raise DeploymentError(
                "The retained artifact belongs to a different workflow run."
            )
        source_repo = artifact.get("workflow_run", {}).get("head_repository_id")
        if source_repo and str(source_repo) != required("GITHUB_REPOSITORY_ID"):
            raise DeploymentError("Refusing build output from a fork repository.")
        output("artifact_id", artifact_id)
        output("artifact_run_id", metadata["rnsArtifactRunId"])
        output("artifact_name", metadata["rnsArtifactName"])
    return state


SAFE_RUNTIME_HINTS = {
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONUNBUFFERED",
    "NODE_ENV",
    "TZ",
    "LANG",
    "LC_ALL",
}


def portable_copy(source, destination, allowed_root, ancestors=frozenset()):
    source, destination = Path(source), Path(destination)
    resolved = source.resolve()
    if not resolved.is_relative_to(allowed_root) or resolved in ancestors:
        raise DeploymentError(
            "Build output contains an external symlink or a symlink cycle."
        )
    if source.name.startswith(".env"):
        return
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            portable_copy(
                child, destination / child.name, allowed_root, ancestors | {resolved}
            )
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def materialize_file_maps(output_dir, workspace):
    workspace = Path(workspace).resolve()
    for path in Path(output_dir).glob("functions/**/*.func/.vc-config.json"):
        config = json.loads(path.read_text())
        mapping = config.pop("filePathMap", {})
        root = path.parent.resolve()
        for relative, source in mapping.items():
            name = Path(relative)
            if name.is_absolute() or ".." in name.parts:
                raise DeploymentError("Unsafe mapped function destination.")
            if any(
                part.startswith(".env")
                or part in {"__pycache__", ".pytest_cache", ".ruff_cache"}
                for part in name.parts
            ):
                continue
            destination = root / name
            if not destination.resolve().is_relative_to(root):
                raise DeploymentError(
                    "Mapped function destination escapes the function."
                )
            original = workspace / source
            if original.resolve() != destination.resolve():
                portable_copy(original, destination, workspace)
        if mapping:
            path.write_text(json.dumps(config))


def pack_output(source, archive, component, secrets=()):
    source, archive = Path(source), Path(archive)
    if not (source / "config.json").is_file():
        raise DeploymentError("The Vercel build did not produce output/config.json.")
    configuration = json.loads((source / "config.json").read_text())
    if (
        configuration.get("version") != 3
        or configuration.get("services")
        or configuration.get("daemons")
    ):
        raise DeploymentError("Unsupported portable Build Output configuration.")
    workspace = Path(os.environ.get("GITHUB_WORKSPACE", source)).resolve()
    if not source.resolve().is_relative_to(workspace):
        workspace = source.resolve()
    materialize_file_maps(source, workspace)
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary) / "output"
        # Vercel can link output directories to build files elsewhere in the
        # checkout. Materialize those links, never runner credentials/tool dirs.
        stage.mkdir()
        # Copy the public Build Output contract, not CLI builds.json (which can
        # bind output to the original target), diagnostics, or build caches.
        for name in ("config.json", "functions", "static"):
            if (source / name).exists():
                portable_copy(source / name, stage / name, workspace)
        for path in sorted(stage.rglob("*"), reverse=True):
            if path.is_symlink() and not path.resolve().is_relative_to(stage):
                raise DeploymentError("Build output contains an external symlink.")
            if path.name.startswith(".env"):
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            elif path.name == ".vc-config.json":
                config = json.loads(path.read_text())
                hints = {
                    key: value
                    for key, value in config.get("environment", {}).items()
                    if key in SAFE_RUNTIME_HINTS
                }
                config["environment"] = hints
                path.write_text(json.dumps(config))
        needles = [value.encode() for value in secrets if value]
        for path in stage.rglob("*"):
            if path.is_file():
                data = path.read_bytes()
                if any(value in data for value in needles):
                    raise DeploymentError(
                        f"Credential found in build output {path.relative_to(stage)}; refusing upload."
                    )
        manifest = Path(temporary) / "manifest.json"
        manifest.write_text(
            json.dumps({"version": ARTIFACT_VERSION, "component": component})
        )
        archive.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(stage, arcname="output")
            tar.add(manifest, arcname="manifest.json")


def restore_output(archive, destination, component):
    destination = Path(destination)
    with tempfile.TemporaryDirectory() as temporary:
        with tarfile.open(archive) as tar:
            if sum(member.size for member in tar.getmembers()) > 2 * 1024**3:
                raise DeploymentError("Expanded build output exceeds the size limit.")
            tar.extractall(temporary, filter="data")
        manifest = json.loads((Path(temporary) / "manifest.json").read_text())
        if manifest != {"version": ARTIFACT_VERSION, "component": component}:
            raise DeploymentError("Incompatible build output artifact.")
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(Path(temporary) / "output", destination, symlinks=True)


def inject_runtime(output_dir, runtime):
    configurations = list(Path(output_dir).glob("functions/**/*.func/.vc-config.json"))
    if not configurations:
        raise DeploymentError(
            "The build output contains no runtime function configuration."
        )
    for path in configurations:
        config = json.loads(path.read_text())
        config["environment"] = {**config.get("environment", {}), **runtime}
        path.write_text(json.dumps(config))


def clear_build_environment(directory):
    # These files were just downloaded by `vercel pull`. Compilation is
    # intentionally target-neutral; private bindings are applied at publication.
    for path in Path(directory).glob(".env.*.local"):
        path.write_text("")


def publish(state, provider):
    if state["mode"] == "reuse":
        deployment_id = state["source"].get("uid", state["source"].get("id"))
    else:
        inject_runtime(".vercel/output", state["runtime"])
        if state["mode"] == "build":
            artifact_id = required("BUILD_ARTIFACT_ID")
            artifact_run = required("GITHUB_RUN_ID")
            artifact_name = required("BUILD_ARTIFACT_NAME")
        else:
            metadata = state["source"]["meta"]
            artifact_id, artifact_run, artifact_name = (
                metadata["rnsArtifactId"],
                metadata["rnsArtifactRunId"],
                metadata["rnsArtifactName"],
            )
        metadata = {
            "githubDeployment": "1",
            "githubCommitRef": state["branch"],
            "githubCommitSha": required("GITHUB_SHA"),
            "rnsConfigHash": state["fingerprint"],
            "rnsArtifactId": str(artifact_id),
            "rnsArtifactRunId": str(artifact_run),
            "rnsArtifactName": artifact_name,
        }
        command = [
            "vercel",
            "deploy",
            "--prebuilt",
            "--local-config",
            required("VERCEL_LOCAL_CONFIG"),
            "--environment",
            state["target"],
        ]
        for key, value in metadata.items():
            command.extend(["--meta", f"{key}={value}"])
        # Valueless --env reads the named process variable in Vercel CLI. Values
        # stay out of command arguments while overriding inherited project env.
        for key in state["runtime"]:
            command.extend(["--env", key])
        result = subprocess.run(
            command,
            env={
                **os.environ,
                **state["runtime"],
                "VERCEL_PROJECT_ID": state["project_id"],
            },
            text=True,
            capture_output=True,
        )
        private_values = [
            os.environ.get(key, "")
            for key in ("VERCEL_TOKEN", "NEON_API_KEY", "GITHUB_TOKEN")
        ]
        private_values += list(state["runtime"].values())
        logs = result.stderr
        for secret in private_values:
            if secret:
                logs = logs.replace(secret, "<REDACTED>")
        print(logs, end="")
        if result.returncode:
            raise DeploymentError("Vercel deployment failed; see sanitized CLI output.")
        url = result.stdout.strip().removeprefix("https://")
        deployment = provider.api.request("GET", f"/v13/deployments/{quote(url)}")
        if deployment["readyState"] != "READY":
            raise DeploymentError("Vercel did not finish deployment successfully.")
        deployment_id = deployment["id"]
    provider.assign(state["alias"], state["project_id"], deployment_id)
    state["deployment_id"] = deployment_id
    if os.environ.get("STATE_FILE"):
        save_private(os.environ["STATE_FILE"], state)
    url = "https://" + state["alias"]
    output("url", url)
    output("deployment_id", deployment_id)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(
                f"## {state['component'].title()} deployment\n\n"
                f"- Target: {state['target']}\n- Mode: {state['mode']}\n- URL: <{url}>\n"
            )


def sanitized(text, state):
    for value in [
        *(
            os.environ.get(key, "")
            for key in ("VERCEL_TOKEN", "NEON_API_KEY", "GITHUB_TOKEN")
        ),
        *state["runtime"].values(),
    ]:
        if value:
            text = text.replace(value, "<REDACTED>")
    text = re.sub(
        r"x-vercel-protection-bypass[:=]\s*\S+",
        "x-vercel-protection-bypass:<REDACTED>",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(r"postgres(?:ql)?(?:\+\w+)?://\S+", "<REDACTED DATABASE URL>", text)


def runtime_diagnostics(state):
    environment = {**os.environ, "VERCEL_PROJECT_ID": state["project_id"]}
    try:
        if state["component"] == "backend":
            health = subprocess.run(
                [
                    "vercel",
                    "curl",
                    "https://" + state["alias"] + "/api/health",
                    "--",
                    "--fail",
                    "--silent",
                    "--show-error",
                ],
                env=environment,
                text=True,
                capture_output=True,
                timeout=35,
            )
            print(
                f"Diagnostic health probe: {'healthy' if health.returncode == 0 else 'failed'}."
            )
        logs = subprocess.run(
            [
                "vercel",
                "logs",
                "--project",
                state["project_id"],
                "--deployment",
                state.get("deployment_id") or "https://" + state["alias"],
                "--since",
                "10m",
                "--limit",
                "40",
                "--json",
            ],
            env=environment,
            text=True,
            capture_output=True,
            timeout=35,
        )
        messages = []
        for line in logs.stdout.splitlines():
            try:
                record = json.loads(line)
                data = record.get("data", record)
                # CLI 65 emits request records with nested logs; newer formats
                # wrap individual runtime messages in a typed data envelope.
                entries = data.get("logs") or [data]
                messages.extend(
                    entry["message"]
                    for entry in entries
                    if isinstance(entry, dict) and isinstance(entry.get("message"), str)
                )
            except (ValueError, AttributeError):
                continue
        if messages:
            print(
                "Sanitized runtime diagnostics:\n"
                + sanitized("\n".join(messages)[-12000:], state)
            )
        else:
            print(
                "Runtime log query returned no message records. "
                + f"CLI exit status: {logs.returncode}. "
                + sanitized(logs.stderr[-1500:], state)
            )
    except subprocess.TimeoutExpired:
        print("Runtime diagnostics timed out; use the Vercel project logs.")


def smoke(state):
    path = "/api/boats" if state["component"] == "backend" else "/runtime-config.json"
    with tempfile.TemporaryDirectory() as directory:
        headers = Path(directory) / "headers"
        command = [
            "vercel",
            "curl",
            "https://" + state["alias"] + path,
            "--",
            "--fail",
            "--silent",
            "--show-error",
            "--dump-header",
            str(headers),
        ]
        if state["component"] == "backend":
            command += ["-H", "Origin: " + state["runtime"]["CORS_ALLOWED_ORIGINS"]]
        result = subprocess.run(
            command,
            env={**os.environ, "VERCEL_PROJECT_ID": state["project_id"]},
            text=True,
            capture_output=True,
        )
        if result.returncode:
            print(sanitized(result.stderr, state), end="")
            runtime_diagnostics(state)
            raise DeploymentError(
                "Authenticated preview HTTP verification failed; inspect the Vercel runtime logs."
            )
        try:
            data = json.loads(result.stdout)
        except ValueError:
            raise DeploymentError(
                "Preview HTTP verification did not return application JSON."
            ) from None
        if state["component"] == "backend":
            if not isinstance(data, list) or any(
                not isinstance(row, dict)
                or not {"id", "name", "daily_rate"} <= row.keys()
                for row in data
            ):
                raise DeploymentError(
                    "The backend did not return the migrated sample inventory."
                )
            origins = [
                line.partition(":")[2].strip()
                for line in headers.read_text().splitlines()
                if line.partition(":")[0].lower() == "access-control-allow-origin"
            ]
            if not origins or origins[-1] != state["runtime"]["CORS_ALLOWED_ORIGINS"]:
                raise DeploymentError(
                    "The backend did not allow the resolved frontend origin."
                )
            print(
                f"Verified live backend inventory ({len(data)} rows) and explicit CORS origin."
            )
        elif data.get("backendUrl") != state["runtime"]["BACKEND_URL"]:
            raise DeploymentError(
                "The frontend runtime URL does not match its resolved backend."
            )
        else:
            print(
                "Verified live frontend runtime configuration matches its resolved backend."
            )


def plan_changes(files):
    shared = ("ci/", ".github/actions/")
    shared_files = {".github/workflows/automatic.yml", ".github/workflows/actions.lock"}
    return {
        "backend": any(
            path.startswith(("backend/", *shared))
            or path
            in shared_files
            | {
                "vercel.json",
                "frontend/package.json",
                ".github/workflows/reusable-backend.yml",
            }
            for path in files
        ),
        "frontend": any(
            path.startswith(("frontend/", *shared))
            or path in shared_files | {".github/workflows/reusable-frontend.yml"}
            for path in files
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=(
            "changes",
            "database-plan",
            "database-env",
            "database-branch",
            "plan",
            "pack",
            "restore",
            "publish",
            "build-env",
            "smoke",
        ),
    )
    args = parser.parse_args()
    command = args.command
    if command == "build-env":
        clear_build_environment(".vercel")
        return
    if command == "changes":
        event = json.loads(Path(required("GITHUB_EVENT_PATH")).read_text())
        if "pull_request" in event:
            api = JsonApi("https://api.github.com", required("GITHUB_TOKEN"))
            files, page = [], 1
            while True:
                batch = api.request(
                    "GET",
                    f"/repos/{required('GITHUB_REPOSITORY')}/pulls/{event['number']}/files",
                    query={"per_page": 100, "page": page},
                )
                files.extend(item["filename"] for item in batch)
                files.extend(
                    item["previous_filename"]
                    for item in batch
                    if item.get("previous_filename")
                )
                if len(batch) < 100:
                    break
                page += 1
            branch, target = event["pull_request"]["head"]["ref"], "preview"
        else:
            before, after = event.get("before", ""), required("GITHUB_SHA")
            if not before or set(before) == {"0"}:
                files = subprocess.check_output(
                    ["git", "ls-files"], text=True
                ).splitlines()
            else:
                files = subprocess.check_output(
                    ["git", "diff", "--name-only", before, after], text=True
                ).splitlines()
            branch, target = os.environ["GITHUB_REF_NAME"], "production"
        for component, changed in plan_changes(files).items():
            output("build_" + component, str(changed).lower())
        output("branch", branch)
        output("target", target)
        output("pr_number", event.get("number", 0))
        return
    if command == "database-plan":
        if required("DEPLOY_TARGET") not in ("preview", "production"):
            raise DeploymentError("Invalid database deployment target.")
        parent = neon().parent(os.environ.get("NEON_PARENT_BRANCH_ID", ""))
        output("parent_branch_id", parent)
        output("branch_name", "preview/" + required("DEPLOY_BRANCH"))
        return
    if command == "database-env":
        value = neon().connection(required("NEON_BRANCH_ID"), pooled=False)
        if os.environ.get("GITHUB_ENV"):
            with open(os.environ["GITHUB_ENV"], "a") as stream:
                stream.write(f"DATABASE_URL={value}\n")
        return
    if command == "database-branch":
        branch = neon().ensure_branch(
            "preview/" + required("DEPLOY_BRANCH"), required("NEON_RESOLVED_PARENT")
        )
        output("branch_id", branch)
        return
    state_path = required("STATE_FILE")
    if command == "plan":
        target = required("DEPLOY_TARGET")
        if target not in ("production", "preview"):
            raise DeploymentError("Invalid deployment target.")
        provider = Vercel(
            JsonApi(
                "https://api.vercel.com",
                required("VERCEL_TOKEN"),
                {"teamId": required("VERCEL_ORG_ID")},
            )
        )
        plan_application(
            required("COMPONENT"),
            provider=provider,
            database=neon() if os.environ["COMPONENT"] == "backend" else None,
            branch=required("DEPLOY_BRANCH"),
            target=target,
            build=required("BUILD_REQUESTED") == "true",
            state_path=state_path,
            github=JsonApi("https://api.github.com", required("GITHUB_TOKEN")),
        )
        return
    state = json.loads(Path(state_path).read_text())
    if command == "pack":
        private = [
            os.environ.get(key, "")
            for key in ("VERCEL_TOKEN", "NEON_API_KEY", "GITHUB_TOKEN")
        ]
        private += [
            value for key, value in state["runtime"].items() if "DATABASE" in key
        ]
        pack_output(
            ".vercel/output", required("ARCHIVE_PATH"), state["component"], private
        )
    elif command == "restore":
        restore_output(required("ARCHIVE_PATH"), ".vercel/output", state["component"])
    elif command == "smoke":
        smoke(state)
    else:
        publish(
            state,
            Vercel(
                JsonApi(
                    "https://api.vercel.com",
                    required("VERCEL_TOKEN"),
                    {"teamId": required("VERCEL_ORG_ID")},
                )
            ),
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = (
            str(error)
            if isinstance(error, DeploymentError)
            else f"{type(error).__name__}: deployment operation failed"
        )
        message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::error title=Deployment failed::{message}")
        raise SystemExit(1) from None
