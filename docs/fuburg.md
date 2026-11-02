# Fuburg business workflow

The Fuburg module adapts the user-supplied `fuburg_mes_app` (interface v2.1-v12, dated 2026-11-02) to this MES. It uses the existing SQLAlchemy database, login, plant access and redesigned UI. The reference documents describe business rules; they are not deployment authorization. No supplied SQL Server DDL is installed and no client-700 order examples are provisioned in production.

## Workflow and ownership

SAP owns orders, operations, components/reservations, material master, order revisions and conversion rates. Only the integration worker can import ORDER/MASTER events. Operators cannot edit those snapshots through the web API.

1. Start a run for an open SAP order, line, production date and shift. One open run per line.
2. Report A/GOOD, B/AY and C/SCRAP independently. Finish with machine minutes and optional labor.
3. A supervisor confirms finished runs of one order. GOOD and SCRAP populate PP totals; AY stays in the grade breakdown. UUIDs and the outbound payload are persisted together.
4. QA releases at most the remaining good quantity. Packaging cannot exceed released pieces. Order-unit conversion uses AFPO; other units use the material conversion snapshot saved at confirmation.
5. Request warehouse receipt: full packages use the package unit; packages plus loose pieces use EA. A changed SAP order version blocks receipt pending reconciliation. WH approves or rejects with a reason. Duplicate in-flight decisions are blocked.
6. AY receipt creates 531 plus carton 261 in one request. AY must be mapped and have ZHAL master data. Bag materials require EA and no carton. Carton issue location must be configured or explicitly entered.
7. Shift material use is allocated by A+B+C output. Preview returns a content token; supervisor confirmation fails if materials, output or the allocation changed. Each order gets one 261 request with its reservation. Backflush components are excluded; ambiguous reservations stop for review. Returns use 262 with unit validation.
8. Pending cancellation, material-document reversal and posted-PP correction requests are queued for intf to validate. SAP remains authoritative for posting, correction resolution and document status.

Storage-location rules, grades, shifts, AY packaging and approval status live in per-plant configuration. The sample is disabled and contains pending business decisions. `1011`/`2101` are not automatically created during startup.

## Install and configure

For a new database, normal `python -m app.manage init-db` includes the module. For an existing database, back up first and run:

```sh
python -m migrations.002_fuburg_workflow upgrade
python -m app.manage create-plant 1011 'Fuburg Taiwan' --timezone Asia/Taipei
python -m app.manage create-plant 2101 'Fuburg Thailand' --timezone Asia/Bangkok
python -m app.fuburg.manage configure 1011 config/fuburg.example.json
python -m app.fuburg.manage configure 2101 config/fuburg.example.json
```

Use an approved private configuration file for deployment. Do not edit the source example to store secrets. `integration_enabled` defaults false; enabling it requires `grade_rule_ref.status` and `sites.status` to be `APPROVED`. This status is set by administrators after business signoff; it is not automatic verification of approval.

Migration 002 adds only `fb_*` tables, indexes and an immutable audit trigger. It supports SQLite and PostgreSQL. It can be applied repeatedly. Rollback is `python -m migrations.002_fuburg_workflow downgrade`; **this deletes all Fuburg records** and leaves the original MES tables untouched. Do not run it on live data without an approved backup/rollback procedure. It does not replace migration 001 for existing installations.

## Roles and endpoints

Existing plant roles map to operator → MES, planner → LEAD, quality → QA, viewer → VIEWER. Administrators have all actions. WH is explicitly granted, and a Fuburg override does not grant access to the plant itself:

```sh
python -m app.manage grant warehouse_user 1011 viewer
python -m app.fuburg.manage grant warehouse_user 1011 WH
```

- `GET /api/plants/{plant_id}/fuburg`: work queues, available actions, synchronization summary, recent audit.
- `POST /api/plants/{plant_id}/fuburg/actions`: `{ "action": "start_run", "body": { ... } }`. Writes require an `Idempotency-Key` of 8–80 characters. Identity and plant are enforced by the session/path. Retrying the same request returns the original result plus `duplicate:true`; changing content with the same key returns a conflict.
- `ingest_event` is worker-only and is rejected by the HTTP endpoint even for administrators.

Open **Fuburg operations** in the navigation. Forms show records and quantities rather than raw payloads. Work queues are bounded (500 orders, 200 records per queue); the good-output card covers the displayed recent confirmations, not an all-time accounting total.

## Integration worker

Install `pymssql` in the worker environment in addition to the normal application dependencies. Supply `INTF_HOST`, `INTF_PORT`, `INTF_DB`, `INTF_USER` and `INTF_PASSWORD` via the deployment secret mechanism. Use the MES service account, not a DBA account. Then run:

```sh
python -m app.fuburg.manage worker 1011 2101 --poll 2
```

The client calls only `EXEC intf.api @action, @body`. Inbox changes commit before acknowledgment. Retry uses the stored body unchanged, including when a remote commit succeeds but its reply is lost. Dependency failures block downstream messages. Per-plant database locking serializes writes and delivery, so simultaneous QA releases cannot over-allocate. The worker holds the plant lock during a remote call (up to the client timeout); evaluate throughput during UAT before production scale-up.

## Remaining business decisions and deployment limits

The supplied documents leave site mapping, the official grade rule, Thailand shifts, some AY master records, ASRS exceptions, carton issue locations and final interface DDL pending. Preserve those decisions for business signoff. The module has been tested with a fake interface, not the enterprise UAT server. SAP posting/PP→GR dependencies, document reversals and correction resolution must be exercised against that server before go-live. Equipment acquisition, label printing, inventory reconciliation and a correction-reconciliation UI are not implemented here. An order changed during a run is blocked for controlled reconciliation; the UI does not silently rebase it. Failed/blocked outbox messages are visible but do not have a manual replay/edit button because payloads must remain immutable.
