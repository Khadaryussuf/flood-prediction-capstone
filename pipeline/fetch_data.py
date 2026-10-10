"""Download hourly ERA5 weather for Nairobi from the Open-Meteo archive.

Makes one request per year and saves the combined result to RAW_CSV.
ERA5-Land is not used: Open-Meteo returns no precipitation, surface
pressure or wind speed for this location under that model.
"""

import time

import pandas as pd
import requests

from pipeline import config

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def fetch_year(year):
    params = {
        "latitude": config.LATITUDE,
        "longitude": config.LONGITUDE,
        "start_date": f"{year}-01-01",
        "end_date": f"{year}-12-31",
        "hourly": ",".join(config.FEATURES),
        "models": "era5",
        "timezone": config.TIMEZONE,
    }
    response = requests.get(ARCHIVE_URL, params=params, timeout=60)
    response.raise_for_status()
    hourly = response.json()["hourly"]
    return pd.DataFrame(hourly)[["time"] + config.FEATURES]


def main():
    frames = []
    for year in range(config.START_YEAR, config.END_YEAR + 1):
        print(f"Fetching {year}...")
        frames.append(fetch_year(year))
        time.sleep(1)

    df = pd.concat(frames, ignore_index=True)
    df["time"] = pd.to_datetime(df["time"])
    df = df.sort_values("time").drop_duplicates("time").reset_index(drop=True)

    config.RAW_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.RAW_CSV, index=False)

    print(f"Saved {len(df)} rows to {config.RAW_CSV}")
    print(f"Range: {df['time'].min()} to {df['time'].max()}")
    print("Missing values per column:")
    print(df[config.FEATURES].isna().sum().to_string())


if __name__ == "__main__":
    main()
