"""Forecast rainfall for the map: a grid and three watch zones from Open-Meteo.

This is weather forecast data, not model risk. The model's risk applies to one
grid cell only, and neighbourhoods are never coloured by it.
"""

import threading
import time

import pandas as pd
from flask import Blueprint, jsonify

from backend import db, live
from pipeline import config

bp = Blueprint("map", __name__)

PAST_HOURS = 24
FUTURE_HOURS = 12
CACHE_SECONDS = 30 * 60
LABEL = "Weather forecast from Open-Meteo, not model risk."
NO_RAIN_MM = 0.1  # below this, there's no peak worth mentioning

# Rows and columns around the city centre. Open-Meteo's cells are coarser than
# this, so neighbouring squares can show the same value.
GRID_LATITUDES = [-1.36, -1.32, -1.28, -1.24, -1.20]
GRID_LONGITUDES = [36.72, 36.77, 36.82, 36.87, 36.92]
LAT_STEP = 0.04
LON_STEP = 0.05
ZONES = [
    {"name": "Mathare", "lat": -1.2594, "lon": 36.8590},
    {"name": "Kibera", "lat": -1.3133, "lon": 36.7876},
    {"name": "CBD", "lat": -1.2864, "lon": 36.8172},
]

_cache = {"at": 0.0, "body": None}
_lock = threading.Lock()


def fetch_points():
    """One multi-location call. Returns the times and one rainfall series per point:
    the centre, then the grid, then the zones."""
    grid = [(lat, lon) for lat in GRID_LATITUDES for lon in GRID_LONGITUDES]
    points = [(config.LATITUDE, config.LONGITUDE), *grid, *[(z["lat"], z["lon"]) for z in ZONES]]
    payload = live.fetch({
        "latitude": ",".join(str(lat) for lat, _ in points),
        "longitude": ",".join(str(lon) for _, lon in points),
        "hourly": config.TARGET, "timezone": config.TIMEZONE,
        "past_hours": PAST_HOURS, "forecast_hours": FUTURE_HOURS + 1,
    })
    try:
        if not isinstance(payload, list) or len(payload) != len(points):
            raise ValueError("wrong number of locations")
        times = payload[0]["hourly"]["time"]
        series = [[value or 0.0 for value in item["hourly"][config.TARGET]] for item in payload]
        if any(len(values) != len(times) for values in series):
            raise ValueError("uneven series")
    except (KeyError, TypeError, ValueError) as error:
        raise live.LiveDataError(f"Map forecast response not usable ({type(error).__name__})") from error
    return times, series, grid


def peak(times, rain, now_index):
    """The wettest forecast hour after now, or None if no real rain is forecast."""
    future = rain[now_index + 1:now_index + 1 + FUTURE_HOURS]
    if not future or max(future) < NO_RAIN_MM:
        return None
    position = future.index(max(future))
    return {"hours": position + 1, "mm": future[position], "time": times[now_index + 1 + position]}


def build():
    times, series, grid = fetch_points()
    now_local = (db.utcnow() + live.NAIROBI_OFFSET).replace(minute=0, second=0, microsecond=0)
    parsed = [pd.Timestamp(value).to_pydatetime() for value in times]
    now_index = parsed.index(now_local) if now_local in parsed else min(PAST_HOURS, len(times) - 1)
    centre, grid_rain, zone_rain = series[0], series[1:1 + len(grid)], series[1 + len(grid):]
    return {
        "available": True,
        "label": LABEL,
        "times": times,
        "now_index": now_index,
        "centre": {"lat": config.LATITUDE, "lon": config.LONGITUDE},
        "peak": peak(times, centre, now_index),
        "grid": [{"lat": lat, "lon": lon, "rain": rain} for (lat, lon), rain in zip(grid, grid_rain)],
        "cell": {"lat": LAT_STEP, "lon": LON_STEP},
        "zones": [{**zone, "rain": rain} for zone, rain in zip(ZONES, zone_rain)],
    }


@bp.get("/api/map/forecast")
def forecast():
    """Served from a short cache, and from the last good copy if a fetch fails."""
    with _lock:
        fresh = _cache["body"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS
        if not fresh:
            try:
                _cache.update(body=build(), at=time.monotonic())
                _cache["stale"] = False
            except live.LiveDataError:
                _cache["stale"] = True
        if _cache["body"] is None:
            return jsonify({"available": False, "label": LABEL})
        return jsonify({**_cache["body"], "stale": _cache.get("stale", False)})


def clear_cache():
    with _lock:
        _cache.update(at=0.0, body=None, stale=False)
