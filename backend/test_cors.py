import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from main import create_app


class CorsTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(
            patch.dict(
                os.environ,
                {
                    "CORS_ALLOWED_ORIGINS": "https://frontend.test, https://second.test",
                },
            )
        )
        self.client = TestClient(create_app())
        self.addCleanup(self.client.close)

    def test_origins_configured_in_environment_are_allowed(self):
        for origin in (
            "https://frontend.test",
            "https://second.test",
        ):
            with self.subTest(origin=origin):
                response = self.client.get("/api", headers={"Origin": origin})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"Hello": "World"})
                self.assertEqual(
                    response.headers["access-control-allow-origin"], origin
                )
                self.assertIn("Origin", response.headers["vary"])
                self.assertNotIn("access-control-allow-credentials", response.headers)

    def test_origins_not_configured_in_environment_are_not_allowed(self):
        for origin in (
            "https://unconfigured.test",
            "https://preview-feature.frontend.test",
            "https://preview-feature.another.test",
            "https://frontend.test.evil.test",
        ):
            with self.subTest(origin=origin):
                response = self.client.get("/api", headers={"Origin": origin})
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_preflight_allows_supported_frontend_request(self):
        origin = "https://frontend.test"
        response = self.client.options(
            "/api",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_absent_environment_configuration_does_not_allow_origins(self):
        with patch.dict(os.environ, {}, clear=True), TestClient(create_app()) as client:
            response = client.get("/api", headers={"Origin": "https://frontend.test"})

        self.assertNotIn("access-control-allow-origin", response.headers)


if __name__ == "__main__":
    unittest.main()
