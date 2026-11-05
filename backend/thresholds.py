"""Risk thresholds. Defaults come from pipeline/config.py, which stays unchanged;
an administrator's override is kept in the database."""

import json

from backend.db import AppSetting, utcnow
from pipeline import config

THRESHOLDS_KEY = "thresholds"

# The caveat shown wherever risk is shown. The frontend has the same two strings
# in src/lib/copy.ts, and tests check they match.
DISCLAIMER = ("Risk level is hourly rainfall intensity (AMS classes), not flood "
              "probability, and is not calibrated to Nairobi flood records.")
DISCLAIMER_OVERRIDDEN = ("Risk level is hourly rainfall intensity (administrator-set limits), "
                         "not flood probability, and is not calibrated to Nairobi flood records.")
COOLDOWN_KEY = "alert_cooldown_hours"
DEFAULT_COOLDOWN_HOURS = 3


def default_thresholds():
    return [(limit, label) for limit, label in config.RISK_THRESHOLDS_MM]


def get_setting(session, key, default=None):
    row = session.get(AppSetting, key)
    return json.loads(row.value) if row else default


def set_setting(session, key, value):
    row = session.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key)
        session.add(row)
    row.value = json.dumps(value)
    row.updated_at = utcnow()


def clear_setting(session, key):
    row = session.get(AppSetting, key)
    if row is not None:
        session.delete(row)


def current_thresholds(session):
    """[(limit_mm, label), ...], lowest first."""
    saved = get_setting(session, THRESHOLDS_KEY)
    return [tuple(pair) for pair in saved] if saved else default_thresholds()


def is_overridden(session):
    return get_setting(session, THRESHOLDS_KEY) is not None


def disclaimer(session):
    """The disclaimer for the limits in use: AMS classes, or an administrator's."""
    return DISCLAIMER_OVERRIDDEN if is_overridden(session) else DISCLAIMER


def classify(predicted_mm, thresholds=None):
    """Map rainfall to a risk level. The API's values stay low, moderate and high."""
    for limit, label in thresholds or default_thresholds():
        if predicted_mm < limit:
            return label
    return config.HIGHEST_RISK


def thresholds_payload(thresholds):
    return [{"below_mm": limit, "label": label} for limit, label in thresholds]
