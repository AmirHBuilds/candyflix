"""A guard: every API route needs a signed-in person, except the few the sign-in screen itself needs."""
from fastapi.routing import APIRoute

from app.main import app

# Routes that work without signing in, and why.
OPEN = {
    ("GET", "/api"),  # tiny status line
    ("GET", "/api/health"), ("GET", "/api/health/db"), ("GET", "/api/health/redis"), ("GET", "/api/health/full"),  # for Docker / uptime checks
    ("GET", "/api/auth/users"),  # the "Who's watching?" screen
    ("POST", "/api/auth/login"), ("POST", "/api/auth/login/verify"), ("POST", "/api/auth/login/resend"), ("POST", "/api/auth/logout"),
    ("GET", "/api/site/badge"),  # the crown on the sign-in screen
}


def _dependency_names(route: APIRoute) -> set[str]:
    names: set[str] = set()

    def walk(dep):
        for sub in dep.dependencies:
            names.add(getattr(sub.call, "__name__", str(sub.call)))
            walk(sub)

    walk(route.dependant)
    return names


def test_only_the_sign_in_essentials_are_open():
    open_routes = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and not ({"get_current_user", "require_admin"} & _dependency_names(route)):
            for method in route.methods - {"HEAD", "OPTIONS"}:
                open_routes.add((method, route.path))
    assert open_routes == OPEN, f"unexpected open routes: {sorted(open_routes - OPEN)}; missing: {sorted(OPEN - open_routes)}"
