"""canccu_kit: shared plumbing for CanccuPlatform modules (contracts/admin.md)."""

from .admin import AdminClient
from .bus import STREAM_MAXLEN, Bus, Event, InvalidEnvelope, InvalidEventType, Subscription
from .config import Config, ConfigError, load_config
from .context import correlation, get_correlation_id, new_id
from .errors import (
    AdminError,
    AdminUnavailable,
    KitError,
    MissingRight,
    NotSignedIn,
    VersionConflict,
    error_body,
    parse_error_body,
)
from .health import Check, CheckResult, Health, HealthResult, postgres_check, valkey_check
from .log import JsonFormatter, create_logger
from .rights import CACHE_SECONDS, RightsChecker, Session, session_id_from_cookie
from .settings import SettingsClient
from .store import StreamStore, ValkeyStreamStore

__all__ = [
    "CACHE_SECONDS",
    "STREAM_MAXLEN",
    "AdminClient",
    "AdminError",
    "AdminUnavailable",
    "Bus",
    "Check",
    "CheckResult",
    "Config",
    "ConfigError",
    "Event",
    "Health",
    "HealthResult",
    "InvalidEnvelope",
    "InvalidEventType",
    "JsonFormatter",
    "KitError",
    "MissingRight",
    "NotSignedIn",
    "RightsChecker",
    "Session",
    "SettingsClient",
    "StreamStore",
    "Subscription",
    "ValkeyStreamStore",
    "VersionConflict",
    "correlation",
    "create_logger",
    "error_body",
    "get_correlation_id",
    "load_config",
    "new_id",
    "parse_error_body",
    "postgres_check",
    "session_id_from_cookie",
    "valkey_check",
]
