#!/usr/bin/env bash
# Fresh secrets for CI's stack (scripts/stack-smoke env): notify does not start without a VAPID
# key, and no fixed key goes in the repo.
set -euo pipefail
# A random 32-byte scalar is a valid P-256 key but for a chance of about 2^-32.
echo "CANCCU_NOTIFY_VAPID_PRIVATE_KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
