# notify

The notify module serves [contracts/notify.md](../../contracts/notify.md): topics, notifications to attendees' phones and the inbox. Plan and split: [docs/plans/issue-188.md](../../docs/plans/issue-188.md). This is package 1 (#188): the topic registry, each event's topic configuration, the trigger engine that turns domain events into notifications, and the inbox. Web Push and subscriptions follow in #225; quiet hours, Discord DMs, follows and privacy in #226; check-in codes and the check-in page in #227; custom topics and the admin pages in #228.

## How it works
- **Tenancy:** each request's event comes from its `Host`, through the kit's `TenancyMiddleware` and `TenantResolver` (`CANCCU_TENANTS_URL`). The registry (`notify_topic_types`) and its history are global, as the contract says; everything else is per tenant under RLS. Requests run as `canccu_notify_app` (`SET LOCAL ROLE` inside each transaction).
- **Registry:** modules register their topic types with `PUT /internal/notify/topic-types/{topic}`, signed with the kit's module identity. A module registers only its own topics (the signed caller must be the `owner`) and only its own events. Every change is appended to `notify_topic_type_history`, which the app role may insert into and read but never change.
- **Configuration:** `PUT …/config` is versioned by the write itself (two writes of one `config_version` cannot both succeed), refused on an archived event (409 `event_archived`) and while admin is unreachable, and audited through the tenants module inside its transaction: a change whose audit entry cannot be written is rolled back. The admin settings `topics` and `schedule_lead_minutes` are the same values as `enabled` and the `schedule` topic's `lead_minutes`, and the later write wins. An `admin.settings.changed` for either key clears the event's own value (and bumps `config_version`); until that event arrives, a setting that differs from the one the config write saw already wins. A config write does not yet write admin's settings back (a follow-up). Without either, the type's defaults apply.
- **Trigger engine:** `engine.py` is pure (an envelope and a registration in, candidates out). `consumer.py` reads every module's tenant stream, skips events no registered trigger listens for, checks each enabled topic's triggers, takes the dedupe key only when a notification is made, and writes one notification for event-wide parts or one per recipient for personal parts. Entity-scoped parts make nothing until follows exist (#226).
- **Time zones:** templates format `|time` and `|date` in the event's time zone. The stream consumer has no request, so each request stores the event's zone from its tenant context in `notify_event_state`; an event that no request has reached yet formats in UTC.
- **Members:** until the tenants membership API lands (#150), every valid session on the event's hostname counts as a member (`access.is_member`), as in the agenda.
- **Inbox:** `GET /api/notify/inbox` needs a session for now; the subscription token comes with subscriptions (#225).

## Environment
`CANCCU_DATABASE_URL`, `CANCCU_TENANTS_URL`, plus the kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`. Optional: `CANCCU_MIGRATE_DATABASE_URL` (the migration role; without it the login role migrates, as in the tests), `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME`, `CANCCU_IP_MODE=demo` (only with version `dev`), `CANCCU_TRUSTED_PROXIES`.

Through Caddy: `/api/notify/health` and the contract's `/api/notify/…` paths. `/internal/notify/…` is never routed.

## Check
```sh
pip install -e ".[dev]" && ruff check . && ruff format --check . && mypy . && pytest
```
The engine tests run anywhere. Everything else needs a real Postgres, because RLS cannot be faked; without `CANCCU_DATABASE_URL` those tests are skipped. They include the cross-tenant leak tests (`tests/test_leak.py`). CI runs them in the `integration (kit)` job:
```sh
docker compose -f ../../deploy/compose.yml -f ../../deploy/compose.test.yml up -d --wait postgres
CANCCU_DATABASE_URL=postgres://canccu:canccu-local-only@127.0.0.1:5432/canccu pytest
```
