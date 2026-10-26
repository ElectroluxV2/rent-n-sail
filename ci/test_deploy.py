import ast
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch
from urllib.error import HTTPError

from ci.deploy import (
    DeploymentError,
    JsonApi,
    Neon,
    Vercel,
    alias_name,
    clear_build_environment,
    fingerprint,
    inject_runtime,
    pack_output,
    plan_application,
    plan_changes,
    publish,
    resolve_mode,
    restore_output,
    select_deployment,
    smoke,
)


class DeploymentPolicyTests(unittest.TestCase):
    def test_controller_syntax_is_compatible_with_runner_python_before_uv_setup(self):
        for path in Path(__file__).parent.glob("*.py"):
            ast.parse(path.read_text(), filename=str(path), feature_version=(3, 12))

    def test_documentation_and_database_changes_do_not_build_applications(self):
        for files in (
            ["README.md"],
            ["database/migrations/versions/0002.py"],
            [".github/workflows/reusable-database.yml"],
        ):
            self.assertEqual(plan_changes(files), {"backend": False, "frontend": False})

    def test_native_path_equivalents_select_only_affected_applications(self):
        self.assertEqual(
            plan_changes(["backend/main.py"]), {"backend": True, "frontend": False}
        )
        self.assertEqual(
            plan_changes(["frontend/src/server.ts"]),
            {"backend": False, "frontend": True},
        )
        self.assertEqual(
            plan_changes(["ci/deploy.py"]), {"backend": True, "frontend": True}
        )

    def test_aliases_are_stable_and_isolated(self):
        name = alias_name("frontend", "feature/boats", "preview")
        self.assertEqual(name, alias_name("frontend", "feature/boats", "preview"))
        self.assertNotEqual(name, alias_name("frontend", "feature/bookings", "preview"))
        self.assertNotEqual(
            alias_name("x" * 50 + "a", "branch", "preview"),
            alias_name("x" * 50 + "b", "branch", "preview"),
        )
        self.assertLessEqual(
            len(alias_name("x" * 80, "branch", "preview").split(".")[0]), 63
        )

    def test_existing_preview_is_preferred_only_when_its_configuration_matches(self):
        preview = {"meta": {"rnsConfigHash": "correct", "rnsArtifactId": "123"}}
        production = {"meta": {"rnsArtifactId": "456"}}
        self.assertEqual(
            resolve_mode(False, preview, production, "correct"), ("reuse", preview)
        )
        self.assertEqual(
            resolve_mode(False, preview, production, "changed"), ("restore", preview)
        )
        self.assertEqual(
            resolve_mode(False, None, production, "correct"), ("restore", production)
        )
        self.assertEqual(
            resolve_mode(True, preview, production, "correct"), ("build", None)
        )

    def test_missing_or_expired_builds_never_silently_trigger_a_build(self):
        with self.assertRaisesRegex(DeploymentError, "manual workflow"):
            resolve_mode(False, None, {"meta": {}}, "correct")

    def test_preview_selection_requires_ready_state_branch_and_target(self):
        deployments = [
            {
                "id": "wrong-branch",
                "state": "READY",
                "created": 10,
                "meta": {"githubCommitRef": "other"},
            },
            {
                "id": "not-ready",
                "state": "ERROR",
                "created": 11,
                "meta": {"githubCommitRef": "branch"},
            },
            {
                "id": "production",
                "state": "READY",
                "created": 12,
                "target": "production",
                "meta": {"githubCommitRef": "branch"},
            },
            {
                "id": "preview",
                "state": "READY",
                "created": 9,
                "meta": {"githubCommitRef": "branch"},
            },
        ]
        self.assertEqual(
            select_deployment(deployments, "branch", "preview")["id"], "preview"
        )
        self.assertEqual(
            select_deployment(deployments, "branch", "production")["id"], "production"
        )

    def test_database_credential_rotation_changes_the_binding_fingerprint(self):
        self.assertNotEqual(
            fingerprint({"DATABASE_URL": "old"}), fingerprint({"DATABASE_URL": "new"})
        )


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.directory = self.enterContext(tempfile.TemporaryDirectory())
        self.root = Path(self.directory)
        self.source = self.root / "source"
        self.function = self.source / "functions/app.func"
        self.function.mkdir(parents=True)
        (self.source / "config.json").write_text('{"version":3}')
        (self.source / "builds.json").write_text(
            '{"target":"production","private":"credential-fixture"}'
        )
        (self.function / "app.py").write_text("app = 'portable'\n")
        (self.function / ".vc-config.json").write_text(
            json.dumps(
                {
                    "runtime": "python3.14",
                    "handler": "app.py",
                    "environment": {
                        "DATABASE_URL": "credential-fixture",
                        "VERCEL_TOKEN": "token-fixture",
                        "PYTHONPATH": ".",
                    },
                }
            )
        )
        (self.function / ".env.preview.local").write_text("private-fixture")
        self.archive = self.root / "build-output.tar.gz"

    def test_portable_output_has_no_runtime_credentials_and_can_be_rebound(self):
        pack_output(
            self.source,
            self.archive,
            "backend",
            ["credential-fixture", "token-fixture", "private-fixture"],
        )
        destination = self.root / "restored"
        restore_output(self.archive, destination, "backend")
        config_path = destination / "functions/app.func/.vc-config.json"
        config = json.loads(config_path.read_text())
        self.assertEqual(config["environment"], {"PYTHONPATH": "."})
        self.assertFalse((destination / "builds.json").exists())
        self.assertFalse((config_path.parent / ".env.preview.local").exists())
        inject_runtime(destination, {"DATABASE_URL": "new-private-runtime"})
        self.assertEqual(
            json.loads(config_path.read_text())["environment"]["DATABASE_URL"],
            "new-private-runtime",
        )

    def test_embedded_credentials_are_rejected_rather_than_uploaded(self):
        (self.function / "app.py").write_text("secret = 'credential-fixture'\n")
        with self.assertRaisesRegex(DeploymentError, "refusing upload"):
            pack_output(self.source, self.archive, "backend", ["credential-fixture"])

    def test_downloaded_runtime_env_is_not_available_to_compilation(self):
        settings = self.root / "project.json"
        settings.write_text('{"projectId":"public-id"}')
        env_file = self.root / ".env.preview.local"
        env_file.write_text("DATABASE_URL=private-fixture")
        clear_build_environment(self.root)
        self.assertEqual(env_file.read_text(), "")
        self.assertEqual(settings.read_text(), '{"projectId":"public-id"}')

    def test_wrong_application_artifact_is_rejected(self):
        pack_output(self.source, self.archive, "backend")
        with self.assertRaisesRegex(DeploymentError, "Incompatible"):
            restore_output(self.archive, self.root / "wrong", "frontend")

    def test_external_symlinks_and_archive_traversal_are_rejected(self):
        (self.function / "external").symlink_to(self.root / "outside")
        with self.assertRaisesRegex(DeploymentError, "external symlink"):
            pack_output(self.source, self.archive, "backend")
        with tarfile.open(self.archive, "w:gz") as archive:
            info = tarfile.TarInfo("../escaped")
            info.size = 4
            archive.addfile(info, io.BytesIO(b"evil"))
        with self.assertRaises(tarfile.FilterError):
            restore_output(self.archive, self.root / "target", "backend")
        self.assertFalse((self.root / "escaped").exists())


class NeonTests(unittest.TestCase):
    def test_branch_resolution_is_idempotent_and_inherits_compute_defaults(self):
        class Api:
            def __init__(self):
                self.branches = []
                self.created = []

            def request(self, method, path, **kwargs):
                if method == "GET":
                    return {"branches": self.branches}
                self.created.append(kwargs["data"])
                branch = {"id": "preview-id", "name": kwargs["data"]["branch"]["name"]}
                self.branches.append(branch)
                return {"branch": branch}

        api = Api()
        provider = Neon(api, "project")
        self.assertEqual(
            provider.ensure_branch("preview/feature", "parent"), "preview-id"
        )
        self.assertEqual(
            provider.ensure_branch("preview/feature", "parent"), "preview-id"
        )
        self.assertEqual(
            api.created,
            [
                {
                    "branch": {"name": "preview/feature", "parent_id": "parent"},
                    "endpoints": [{"type": "read_write"}],
                }
            ],
        )

    def test_provider_preconditions_are_useful_but_do_not_disclose_credentials(self):
        payload = json.dumps(
            {
                "message": "Compute setting is not allowed token-fixture postgresql://owner:password@db/test"
            }
        ).encode()
        error = HTTPError(
            "https://provider.test", 412, "precondition", {}, io.BytesIO(payload)
        )
        with (
            patch("ci.deploy.urlopen", side_effect=error),
            self.assertRaises(DeploymentError) as caught,
        ):
            JsonApi("https://provider.test", "token-fixture").request(
                "POST", "/branches", data={}
            )
        self.assertIn("Compute setting is not allowed", str(caught.exception))
        self.assertNotIn("token-fixture", str(caught.exception))
        self.assertNotIn("password", str(caught.exception))

    def test_connection_lookup_is_explicit_and_pooling_is_selected_per_use(self):
        class Api:
            def request(self, method, path, **kwargs):
                self.query = kwargs["query"]
                return {"uri": "postgresql://fixture"}

        api = Api()
        provider = Neon(api, "project", "database", "role")
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}):
            provider.connection("branch-id", pooled=True)
        self.assertEqual(
            api.query,
            {
                "branch_id": "branch-id",
                "database_name": "database",
                "role_name": "role",
                "pooled": "true",
            },
        )


class ProviderBindingTests(unittest.TestCase):
    def test_live_backend_verification_checks_database_rows_and_cors(self):
        def request(command, **kwargs):
            self.assertEqual(command[:2], ["vercel", "curl"])
            headers = Path(command[command.index("--dump-header") + 1])
            headers.write_text(
                "HTTP/2 200\naccess-control-allow-origin: https://frontend.test\n"
            )
            return CompletedProcess(
                command,
                0,
                '[{"id":1,"name":"Demo sailboat","daily_rate":"125.00"}]',
                "",
            )

        with patch("ci.deploy.subprocess.run", side_effect=request):
            smoke(
                {
                    "component": "backend",
                    "project_id": "backend",
                    "alias": "backend.test",
                    "runtime": {"CORS_ALLOWED_ORIGINS": "https://frontend.test"},
                }
            )

    def test_live_frontend_verification_rejects_the_wrong_backend(self):
        with (
            patch(
                "ci.deploy.subprocess.run",
                return_value=CompletedProcess(
                    [], 0, '{"backendUrl":"https://wrong.test"}', ""
                ),
            ),
            self.assertRaisesRegex(DeploymentError, "does not match"),
        ):
            smoke(
                {
                    "component": "frontend",
                    "project_id": "frontend",
                    "alias": "frontend.test",
                    "runtime": {"BACKEND_URL": "https://backend.test"},
                }
            )

    def test_reusing_a_ready_deployment_does_not_invoke_a_build_or_cli(self):
        class Provider:
            def assign(self, hostname, project, deployment):
                self.bound = (hostname, project, deployment)

        provider = Provider()
        with tempfile.TemporaryDirectory() as directory:
            outputs = Path(directory) / "outputs"
            summary = Path(directory) / "summary"
            with (
                patch.dict(
                    os.environ,
                    {
                        "GITHUB_OUTPUT": str(outputs),
                        "GITHUB_STEP_SUMMARY": str(summary),
                    },
                ),
                patch(
                    "ci.deploy.subprocess.run",
                    side_effect=AssertionError("No CLI call is permitted"),
                ),
            ):
                publish(
                    {
                        "mode": "reuse",
                        "source": {"id": "ready"},
                        "project_id": "backend",
                        "alias": "backend.test",
                        "component": "backend",
                        "target": "preview",
                    },
                    provider,
                )
            self.assertEqual(provider.bound, ("backend.test", "backend", "ready"))
            self.assertIn("url=https://backend.test", outputs.read_text())
            self.assertIn("Mode: reuse", summary.read_text())

    def test_alias_assignment_is_idempotent_and_never_takes_another_project_alias(self):
        class Api:
            def request(self, method, path, **kwargs):
                if method == "POST":
                    raise AssertionError(
                        "An existing binding must not be assigned again"
                    )
                return {"projectId": "frontend", "deploymentId": "ready"}

        provider = Vercel(Api())
        provider.assign("frontend.test", "frontend", "ready")
        with self.assertRaisesRegex(DeploymentError, "another project"):
            provider.assign("frontend.test", "backend", "ready")

    def test_runtime_credentials_are_private_not_workflow_outputs(self):
        events = []

        class Provider:
            def project(self, identifier):
                return {"id": identifier, "name": identifier}

            def alias(self, hostname, project):
                return None

            def deployments(self, project):
                return [{"id": "stable", "state": "READY", "target": "production"}]

            def assign(self, *args):
                events.append("reserved-frontend-origin")

        class Database:
            def connection(self, branch, pooled):
                events.append("read-database-credential")
                return "postgresql://credential-fixture"

        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            outputs = Path(directory) / "outputs"
            with patch.dict(
                os.environ,
                {
                    "VERCEL_BACKEND_PROJECT_ID": "backend",
                    "VERCEL_FRONTEND_PROJECT_ID": "frontend",
                    "NEON_BRANCH_ID": "preview-id",
                    "GITHUB_OUTPUT": str(outputs),
                },
            ):
                state = plan_application(
                    "backend",
                    provider=Provider(),
                    database=Database(),
                    branch="feature",
                    target="preview",
                    build=True,
                    state_path=state_path,
                )
            self.assertEqual(
                events, ["reserved-frontend-origin", "read-database-credential"]
            )
            self.assertEqual(
                state["runtime"]["DATABASE_URL"], "postgresql://credential-fixture"
            )
            self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn("credential-fixture", outputs.read_text())

    def test_build_links_inside_the_checkout_are_materialized(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            actual = workspace / "application/function"
            actual.mkdir(parents=True)
            (actual / ".vc-config.json").write_text('{"runtime":"nodejs24.x"}')
            (actual / "server.mjs").write_text("export default () => {};\n")
            output = workspace / "output"
            (output / "functions").mkdir(parents=True)
            (output / "config.json").write_text('{"version":3}')
            (output / "functions/app.func").symlink_to(actual, target_is_directory=True)
            archive = workspace / "build.tar.gz"
            with patch.dict(os.environ, {"GITHUB_WORKSPACE": str(workspace)}):
                pack_output(output, archive, "frontend")
            restored = workspace / "restored"
            restore_output(archive, restored, "frontend")
            self.assertFalse((restored / "functions/app.func").is_symlink())
            self.assertTrue((restored / "functions/app.func/server.mjs").is_file())


if __name__ == "__main__":
    unittest.main()
