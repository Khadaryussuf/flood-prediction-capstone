"""Create the first administrator. Prompts for everything; nothing is hard-coded.

From the repo root:  python -m scripts.create_admin
"""

import getpass

from sqlalchemy.orm import Session

from backend import accounts
from backend.db import ROLE_ADMIN, STATUS_ACTIVE, make_engine


def prompt_password(label="Password"):
    """Ask twice without echoing."""
    while True:
        password = getpass.getpass(f"{label}: ")
        if password == getpass.getpass(f"{label} again: "):
            return password
        print("Those didn't match. Try again.")


def create_account(engine, name, email, organisation, password, role):
    """Add an active account. Raises ValueError if a rule isn't met."""
    with Session(engine) as session:
        user = accounts.new_user(session, name, email, organisation, password,
                                 role=role, status=STATUS_ACTIVE)
        accounts.audit(session, "script", "create_user", user.email, f"role={role}")
        session.commit()
        return user.email


def main():
    engine = make_engine()
    name = input("Name: ")
    email = input("Email: ")
    organisation = input("Organisation: ")
    password = prompt_password()
    try:
        created = create_account(engine, name, email, organisation, password, ROLE_ADMIN)
    except ValueError as error:
        raise SystemExit(f"Not created: {error}")
    print(f"Administrator {created} created.")


if __name__ == "__main__":
    main()
