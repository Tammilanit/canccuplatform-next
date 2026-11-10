"""`python -m canccu_notify vapid-keygen` prints a new VAPID private key for deploy/.env."""

from __future__ import annotations

import sys

from .webpush import keygen

if sys.argv[1:] != ["vapid-keygen"]:
    raise SystemExit("usage: python -m canccu_notify vapid-keygen")
print(keygen())
