"""Send a real 24-hour window to the running backend and print the response.

Start the server first (python -m backend.app), then from the repo root:
    python -m scripts.demo_request
"""

import json

import requests

from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly

URL = "http://127.0.0.1:5000/predict"


def main():
    # Take the first 24 hours of the real test split, in raw units
    test_split = chronological_split(load_hourly())[2]
    window = test_split.iloc[:config.WINDOW]
    print(f"Sending hours {window.index[0]} to {window.index[-1]} to {URL}")

    # Send them in the format /predict expects
    readings = window.to_dict(orient="records")
    response = requests.post(URL, json={"readings": readings}, timeout=30)

    print(f"Status: {response.status_code}")
    print(json.dumps(response.json(), indent=2))


if __name__ == "__main__":
    main()
