"""Log in, send a real 24-hour window to the running backend and print the response.

Start the server first (python -m backend.app), then from the repo root:
    python -m scripts.demo_request
It prompts for an active account's email and password.
"""

import getpass
import json

import requests

from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly

BASE_URL = "http://127.0.0.1:5000"


def main():
    # /predict needs a session and a CSRF token, like any other logged-in call
    client = requests.Session()
    token = client.get(f"{BASE_URL}/api/auth/session", timeout=30).json()["csrf_token"]
    login = client.post(f"{BASE_URL}/api/auth/login",
                        json={"email": input("Email: "), "password": getpass.getpass("Password: ")},
                        headers={"X-CSRF-Token": token}, timeout=30)
    if not login.ok:
        raise SystemExit(f"Login failed: {login.json().get('error')}")
    token = login.json()["csrf_token"]

    # Take the first 24 hours of the real test split, in raw units
    test_split = chronological_split(load_hourly())[2]
    window = test_split.iloc[:config.WINDOW]
    print(f"Sending hours {window.index[0]} to {window.index[-1]} to {BASE_URL}/predict")

    # Send them in the format /predict expects
    readings = window.to_dict(orient="records")
    response = client.post(f"{BASE_URL}/predict", json={"readings": readings},
                           headers={"X-CSRF-Token": token}, timeout=30)

    print(f"Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))


if __name__ == "__main__":
    main()
