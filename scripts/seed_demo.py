"""Create the demo accounts for testing and the defense: 1 administrator and 2
responders. Prompts for each email and password; nothing is hard-coded.

Use a scratch database by setting DATABASE_URL first.
From the repo root:  python -m scripts.seed_demo
"""

from backend.db import ROLE_ADMIN, ROLE_RESPONDER, make_engine
from scripts.create_admin import create_account, prompt_password

ACCOUNTS = [
    ("Demo Administrator", ROLE_ADMIN),
    ("Demo Responder 1", ROLE_RESPONDER),
    ("Demo Responder 2", ROLE_RESPONDER),
]


def main():
    engine = make_engine()
    for name, role in ACCOUNTS:
        print(f"\n{name} ({role})")
        email = input("Email: ")
        password = prompt_password()
        try:
            print(f"Created {create_account(engine, name, email, 'Demo', password, role)}.")
        except ValueError as error:
            print(f"Skipped: {error}")


if __name__ == "__main__":
    main()
