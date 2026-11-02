"""Authenticated Fuburg endpoints mounted on the existing MES application."""
import json
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect, select
from .core import api, ACTIONS, MesError, one, rows
from .storage import Database
from .schema import roles
from ..models import Plant, Grant


class ActionRequest(BaseModel):
    action: str = Field(max_length=80)
    body: dict = Field(default_factory=dict)


def install(app, current_user, db_session, access):
    def context(db, user, plant_id):
        access(db, user, plant_id)
        plant = db.get(Plant, plant_id)
        role = 'ADMIN' if user.is_admin else None
        if not role:
            role = db.scalar(select(roles.c.role).where(roles.c.user_id == user.id, roles.c.plant_id == plant_id))
            if not role:
                grant = db.scalar(select(Grant).where(Grant.user_id == user.id, Grant.plant_id == plant_id))
                role = {'operator': 'MES', 'quality': 'QA', 'planner': 'LEAD', 'viewer': 'VIEWER'}[grant.role]
        return plant.code, role

    @app.get('/api/plants/{plant_id}/fuburg')
    def overview(plant_id: int, user=Depends(current_user, scope='function'), db=Depends(db_session, scope='function')):
        access(db, user, plant_id)
        if not inspect(app.state.engine).has_table('fb_config'):
            return {'enabled': False}
        plant, role = context(db, user, plant_id)
        local = Database(app.state.engine)
        cfg = one(local, 'SELECT settings FROM fb_config WHERE plant=?', plant)
        if not cfg:
            return {'enabled': False}
        settings = json.loads(cfg['settings'])
        # Consistent snapshot of work queues; each is bounded for kiosk clients.
        with local.transaction(plant, write=False):
            result = {'enabled': True, 'plant': plant, 'role': role,
                      'integration_enabled': settings.get('integration_enabled', False),
                      'pending_configuration': [key for key in ('grade_rule_ref', 'sites') if settings.get(key, {}).get('status') != 'APPROVED'],
                      'shifts': {k:v for k,v in settings.get('shifts', {}).items() if not k.startswith('_')},
                      'orders': rows(local, 'SELECT order_no,description,material,site,source_version,planned_pieces,released,closed,deleted,order_uom FROM work_order WHERE plant=? ORDER BY order_no LIMIT 500', plant)}
            for name, key in [('run','started_at'), ('completion','created_at'), ('release_lot','created_at'), ('package','created_at'), ('receipt','created_at'), ('goods_movement','created_at')]:
                result[name] = rows(local, f'SELECT * FROM {name} WHERE plant=? ORDER BY {key} DESC LIMIT 200', plant)
            result['sync'] = {'counts': {r['state']:r['n'] for r in rows(local,'SELECT state,COUNT(*) n FROM outbox WHERE plant=? GROUP BY state',plant)},
                              'problems': rows(local,"SELECT intf_action,state,last_error FROM outbox WHERE plant=? AND state IN ('FAILED','BLOCKED','RETRY') ORDER BY seq DESC LIMIT 100",plant)}
            result['audit'] = rows(local, 'SELECT action,actor,at FROM mes_audit WHERE plant=? ORDER BY id DESC LIMIT 30', plant)
        result['actions'] = api(local, 'list_actions', {'plant': plant}, role=role, user=user.username)['actions']
        return result

    @app.post('/api/plants/{plant_id}/fuburg/actions')
    def execute(plant_id: int, data: ActionRequest, idempotency_key: str = Header(default=''),
                user=Depends(current_user, scope='function'), db=Depends(db_session, scope='function')):
        access(db, user, plant_id)
        if not inspect(app.state.engine).has_table('fb_config'):
            raise HTTPException(503, 'Fuburg schema migration is required')
        plant, role = context(db, user, plant_id)
        if data.action == 'ingest_event':
            raise HTTPException(403, 'Only the integration worker can import SAP events')
        action = ACTIONS.get(data.action)
        if not action:
            raise HTTPException(422, 'Unknown action')
        if not action.readonly and not 8 <= len(idempotency_key) <= 80:
            raise HTTPException(400, 'Idempotency-Key must contain 8–80 characters')
        if len(json.dumps(data.body)) > 100_000:
            raise HTTPException(413, 'Request too large')
        if data.body.get('plant', plant) != plant:
            raise HTTPException(403, 'Plant mismatch')
        # Identity and permissions come from the session, never from client-supplied roles.
        body = dict(data.body, plant=plant, actor=user.username, operator=user.username, approved_by=user.username)
        body['request_id'] = idempotency_key
        try:
            return api(Database(app.state.engine), data.action, body, role=role, user=user.username)
        except MesError as exc:
            status = 403 if exc.code == 'ROLE_NOT_ALLOWED' else 422 if exc.code in {'FIELD_REQUIRED','INVALID_REQUEST'} else 409
            raise HTTPException(status, {'code': exc.code, 'message': exc.detail or exc.code}) from exc
