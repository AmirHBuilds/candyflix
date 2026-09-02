"""
CandyFlix user management CLI.

There is no public signup — users are provisioned by whoever runs the
app. This keeps the app private and invite-only by construction.

Usage (from inside the backend container or a local venv with the
same DATABASE_URL):

    python -m app.cli create-user candy "Candy"
    python -m app.cli create-user mom "Mom"
    python -m app.cli create-user sister "Sister"

    python -m app.cli list-users

Password is never taken as a plain CLI argument (so it can't end up
in shell history or process listings) — it's always prompted for
securely via getpass, with confirmation.
"""
import argparse
import asyncio
import getpass
import sys

from app.core.db import AsyncSessionLocal
from app.services import auth_service


async def _create_user(username: str, display_name: str) -> None:
    password = getpass.getpass(f"Password for '{username}': ")
    if not password:
        print("Password cannot be empty.", file=sys.stderr)
        sys.exit(1)
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords did not match.", file=sys.stderr)
        sys.exit(1)

    async with AsyncSessionLocal() as db:
        existing = await auth_service.get_user_by_username(db, username)
        if existing is not None:
            print(f"User '{username}' already exists.", file=sys.stderr)
            sys.exit(1)

        user = await auth_service.create_user(db, username, display_name, password)
        print(f"Created user: {user.username} ({user.display_name}) — id={user.id}")


async def _list_users() -> None:
    async with AsyncSessionLocal() as db:
        users = await auth_service.list_users(db)
        if not users:
            print("No users yet.")
            return
        for u in users:
            print(f"- {u.username} ({u.display_name}) — created {u.created_at}")


def main() -> None:
    parser = argparse.ArgumentParser(description="CandyFlix user management CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser("create-user", help="Create a new user")
    create_parser.add_argument("username", help="Login username, e.g. 'candy'")
    create_parser.add_argument("display_name", help="Display name, e.g. 'Candy'")

    subparsers.add_parser("list-users", help="List existing users")

    args = parser.parse_args()

    if args.command == "create-user":
        asyncio.run(_create_user(args.username, args.display_name))
    elif args.command == "list-users":
        asyncio.run(_list_users())


if __name__ == "__main__":
    main()
