"""Durable intake and ordered delivery. External effects only from this worker."""
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from .core import api, canon, now, one, rows, MesError
from .intf_client import IntfError

log = logging.getLogger(__name__)
ENTITY = {'completion': ('completion', 'completion_id', 'ACCEPTED'),
          'release_lot': ('release_lot', 'release_id', 'ACCEPTED'),
          'package': ('package', 'package_id', 'ACCEPTED'),
          'receipt': ('receipt', 'receipt_id', 'DRAFT'),
          'goods_movement': ('goods_movement', 'movement_id', 'ACCEPTED')}


def integration_config(db, plant):
    row = one(db, 'SELECT settings FROM fb_config WHERE plant=?', plant)
    cfg = json.loads(row['settings']) if row else {}
    if not cfg.get('integration_enabled'):
        raise MesError('INTEGRATION_DISABLED')
    if cfg.get('grade_rule_ref', {}).get('status') != 'APPROVED' or cfg.get('sites', {}).get('status') != 'APPROVED':
        raise MesError('CONFIG_APPROVAL_PENDING')
    return cfg


def pull_events_once(db, intf, plant, limit=50):
    integration_config(db, plant)
    batch = intf.call('claim_delivery', {'plant': plant, 'limit': limit})
    count = 0
    for ev in batch.get('events') or []:
        api(db, 'ingest_event', {'plant': plant, 'event_id': ev['event_id'], 'event_type': ev['event_type'],
                               'payload': ev['payload']}, role='SYNC', user='intf-worker')
        # api has committed, including inbox dedupe and local state, before any ACK.
        try:
            intf.call('ack_delivery', {'plant': plant, 'event_id': ev['event_id'], 'claim_token': ev['claim_token']})
        except IntfError as exc:
            if exc.code != 'STALE_DELIVERY_TOKEN':
                raise
        count += 1
    return count


def entity_result(db, plant, kind, ref, error=None, result=None):
    if kind == 'receipt_decision':
        if error:
            db.execute("UPDATE receipt SET state='DRAFT',error=? WHERE receipt_id=? AND plant=? AND state='DECISION_QUEUED'", (error, ref, plant))
        else:
            state = 'APPROVED' if result['decision'] == 'APPROVE' else 'REJECTED'
            db.execute("UPDATE receipt SET state=?,error=NULL WHERE receipt_id=? AND plant=? AND state='DECISION_QUEUED'", (state, ref, plant))
    elif kind in ENTITY:
        table, key, state = ENTITY[kind]
        if error:
            db.execute(f"UPDATE {table} SET state='REJECTED',error=? WHERE {key}=? AND plant=?", (error, ref, plant))
        else:
            db.execute(f"UPDATE {table} SET state=? WHERE {key}=? AND plant=? AND state='QUEUED'", (state, ref, plant))


def block_dependents(db, plant, msg_id, error):
    pending = [msg_id]
    while pending:
        for row in rows(db, "SELECT * FROM outbox WHERE depends_on=? AND plant=? AND state IN ('NEW','RETRY')", pending.pop(), plant):
            db.execute("UPDATE outbox SET state='BLOCKED',last_error=? WHERE msg_id=?", (error, row['msg_id']))
            entity_result(db, plant, row['ref_kind'], row['ref_id'], error='BLOCKED_BY:' + error)
            pending.append(row['msg_id'])


def push_outbox_once(db, intf, plant, max_msgs=100):
    integration_config(db, plant)
    stats = {'sent': 0, 'retry': 0, 'failed': 0}
    for _ in range(max_msgs):
        stop = False
        # Serializes workers with local writers. If killed after remote commit,
        # local transaction rolls back and the exact frozen body is sent again.
        with db.transaction(plant):
            message = one(db, """SELECT o.* FROM outbox o WHERE o.plant=? AND o.state IN ('NEW','RETRY')
                AND (o.depends_on IS NULL OR EXISTS(SELECT 1 FROM outbox d WHERE d.msg_id=o.depends_on AND d.state='SENT'))
                ORDER BY o.seq LIMIT 1""", plant)
            if not message or (message['next_try_at'] and message['next_try_at'] > now()):
                break
            body = json.loads(message['body'])
            try:
                result = intf.call(message['intf_action'], body)
                if not isinstance(result, dict) or not (result.get('accepted') or result.get('duplicate')):
                    raise IntfError('INVALID_RESPONSE')
            except IntfError as exc:
                if exc.retryable:
                    delay = [2, 5, 15, 30, 60, 120, 300][min(message['attempts'], 6)]
                    next_at = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat(timespec='seconds')
                    db.execute("UPDATE outbox SET state='RETRY',attempts=attempts+1,next_try_at=?,last_error=? WHERE msg_id=?", (next_at, exc.code, message['msg_id']))
                    stats['retry'] += 1
                    stop = True
                else:
                    db.execute("UPDATE outbox SET state='FAILED',attempts=attempts+1,last_error=? WHERE msg_id=?", (exc.code, message['msg_id']))
                    entity_result(db, plant, message['ref_kind'], message['ref_id'], error=exc.code)
                    block_dependents(db, plant, message['msg_id'], exc.code)
                    stats['failed'] += 1
            else:
                db.execute("UPDATE outbox SET state='SENT',attempts=attempts+1,sent_at=?,response=?,last_error=NULL WHERE msg_id=?", (now(), canon(result), message['msg_id']))
                entity_result(db, plant, message['ref_kind'], message['ref_id'], result=body)
                stats['sent'] += 1
        if stop:
            break
    return stats


def run_forever(db, intf, plants, poll_seconds=2):
    if not 1 <= poll_seconds <= 5:
        raise ValueError('Poll interval must be between 1 and 5 seconds')
    for plant in plants:
        integration_config(db, plant)
    while True:
        for plant in plants:
            try:
                pull_events_once(db, intf, plant)
                push_outbox_once(db, intf, plant)
            except Exception:
                log.exception('Fuburg sync failed for plant %s', plant)
        time.sleep(poll_seconds)
