import unittest

from fastapi.testclient import TestClient

from main import app


class CorsTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_frontend_origins_can_read_backend_directly(self):
        for origin in (
            "http://localhost:4200",
            "https://frontend.localhost",
            "https://rent-n-sail-frontend.vercel.app",
            "https://rent-n-sail-frontend-3slpyq5h9-rent-n-sail.vercel.app",
            "https://rent-n-sail-frontend-git-cd-rent-n-sail.vercel.app",
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

    def test_foreign_origins_are_not_allowed(self):
        for origin in (
            "https://unrelated.vercel.app",
            "https://rent-n-sail-frontend-git-cd-another-team.vercel.app",
            "https://rent-n-sail-frontend-git-cd-rent-n-sail.vercel.app.evil.test",
        ):
            with self.subTest(origin=origin):
                response = self.client.get("/api", headers={"Origin": origin})
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_preflight_allows_supported_frontend_request(self):
        origin = "https://rent-n-sail-frontend.vercel.app"
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


if __name__ == "__main__":
    unittest.main()
