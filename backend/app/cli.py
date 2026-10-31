import re
import sys
from getpass import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.demo_data import seed_demo_data
from app.db.session import SessionLocal
from app.models import User


def create_admin() -> None:
    email = input("Admin email: ").strip().lower()
    full_name = input("Admin full name: ").strip()
    password = getpass("Password (min 9 chars, uppercase, lowercase, special): ")
    if not email or not full_name:
        raise SystemExit("Email and full name are required.")
    if (
        len(password) <= 8
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[a-z]", password)
        or not re.search(r"[^A-Za-z0-9]", password)
    ):
        raise SystemExit("Password does not meet the required complexity.")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.email == email)) is not None:
            raise SystemExit("That email already has an account.")
        db.add(User(email=email, full_name=full_name, password_hash=hash_password(password), role="admin"))
        db.commit()
    print("Admin account created.")


def seed_demo() -> None:
    with SessionLocal() as db:
        try:
            counts = seed_demo_data(db)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
    print("Demo workspace data created:")
    for entity, count in counts.items():
        print(f"  {entity}: {count}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.cli create-admin|seed-demo")
    commands = {"create-admin": create_admin, "seed-demo": seed_demo}
    command = commands.get(sys.argv[1])
    if command is None:
        raise SystemExit("Usage: python -m app.cli create-admin|seed-demo")
    command()
