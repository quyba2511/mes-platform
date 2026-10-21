import uuid
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session

from app.db import make_engine
from app.main import create_app
from app.manage import initialize, seed_demo
from app.models import Audit, Consumption, Grant, Lot, Outbox, Route, User, WorkOrder
from app.security import hash_password

@pytest.fixture
def env(tmp_path):
    test_url = os.getenv('TEST_DATABASE_URL')
    root_engine = None
    if test_url:
        schema = 'test_' + uuid.uuid4().hex
        root_engine = create_engine(test_url)
        with root_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA {schema}'))
        engine = create_engine(test_url, connect_args={'options':f'-csearch_path={schema}'})
    else:
        engine = make_engine(f"sqlite:///{tmp_path}/test.db")
    initialize(engine)
    seed_demo(engine, "test-only-password-123")
    app = create_app(engine)
    with TestClient(app) as client:
        response = client.post('/api/login', json={"username":"demo", "password":"test-only-password-123"})
        assert response.status_code == 200, response.text
        client.headers['Authorization'] = 'Bearer ' + response.json()['token']
        yield client, engine
    engine.dispose()
    if root_engine:
        with root_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        root_engine.dispose()

def create_order(client, code='WO-001', plant=1, route=1, qty=10, key=None):
    return client.post(f'/api/plants/{plant}/orders', json={"code":code,"route_id":route,"planned_qty":qty}, headers={'Idempotency-Key':key or str(uuid.uuid4())})

def act(client, order, action, key=None, **fields):
    return client.post(f'/api/plants/{order["plant_id"]}/orders/{order["id"]}/actions', json={"action":action,"version":order['version'],**fields}, headers={'Idempotency-Key':key or str(uuid.uuid4())})

def released(client):
    order=create_order(client).json()
    response=act(client, order, 'release', allocations=[{"lot_id":1,"quantity":10},{"lot_id":2,"quantity":40}])
    assert response.status_code==200,response.text
    return response.json()

def finished(client, scrap=0):
    order=released(client)
    for i, op in enumerate(order['operations']):
        response=act(client, order, 'record', operation_id=op['id'],good=10-scrap,scrap=scrap if i==0 else 0,finish=True,reason='Scrap test')
        assert response.status_code==200,response.text
        order=response.json()
    return order

def test_complete_traceable_lifecycle(env):
    client,engine=env
    order=finished(client)
    assert act(client,order,'complete').status_code==409
    response=act(client,order,'quality',decision='pass',reason='Inspection report QC-001')
    assert response.status_code==200,response.text
    order=response.json()
    response=act(client,order,'complete')
    assert response.status_code==200,response.text
    order=response.json()
    assert order['state']=='completed'
    trace=client.get(f'/api/plants/1/orders/{order["id"]}/trace').json()
    assert len(trace['inputs'])==2 and trace['output_lot']=='WO-001'
    assert len(trace['events'])==7
    used=client.get('/api/plants/1/lots/1/where-used').json()
    assert used[0]['quantity']==10 and used[0]['order']=='WO-001'
    assert act(client,order,'hold',reason='Too late').status_code==409
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Audit))==db.scalar(select(func.count()).select_from(Outbox))

def test_idempotency_does_not_duplicate_production(env):
    client,_=env
    order=released(client)
    key=str(uuid.uuid4())
    response=act(client,order,'record',key=key,operation_id=order['operations'][0]['id'],good=3)
    retry=act(client,order,'record',key=key,operation_id=order['operations'][0]['id'],good=3)
    assert response.status_code==retry.status_code==200
    assert response.json()==retry.json()
    assert retry.json()['operations'][0]['good']==3
    assert act(client,order,'record',key=key,operation_id=order['operations'][0]['id'],good=4).status_code==409

def test_create_order_retry(env):
    client,_=env
    key=str(uuid.uuid4())
    first=create_order(client,key=key)
    retry=create_order(client,key=key)
    assert first.status_code==retry.status_code==201
    assert first.json()['id']==retry.json()['id']
    assert len(client.get('/api/plants/1/orders').json())==1

def test_stale_version_cannot_change_order(env):
    client,_=env
    order=released(client)
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=2).status_code==200
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=2).status_code==409

def test_invalid_release_rolls_back_inventory_audit_and_version(env):
    client,engine=env
    order=create_order(client).json()
    assert act(client,order,'release',allocations=[{'lot_id':1,'quantity':10},{'lot_id':2,'quantity':39}]).status_code==409
    with Session(engine) as db:
        assert db.get(Lot,1).available==10000
        assert db.get(WorkOrder,order['id']).version==1
        assert db.scalar(select(func.count()).select_from(Consumption))==0
        assert db.scalar(select(func.count()).select_from(Audit))==1

def test_quarantine_blocks_release(env):
    client,engine=env
    with Session(engine) as db, db.begin(): db.get(Lot,1).quality='quarantine'
    order=create_order(client).json()
    assert act(client,order,'release',allocations=[{'lot_id':1,'quantity':10},{'lot_id':2,'quantity':40}]).status_code==409

def test_cannot_use_other_plant_lot_or_route(env):
    client,_=env
    assert create_order(client,route=2).status_code==404
    order=create_order(client).json()
    assert act(client,order,'release',allocations=[{'lot_id':3,'quantity':10},{'lot_id':2,'quantity':40}]).status_code==404

def test_cannot_skip_or_overproduce(env):
    client,_=env
    order=released(client)
    assert act(client,order,'record',operation_id=order['operations'][1]['id'],good=1).status_code==409
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=11).status_code==409
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=9,finish=True).status_code==409

def test_scrap_reduces_downstream_capacity_and_requires_close_reason(env):
    client,_=env
    order=finished(client,scrap=2)
    order=act(client,order,'quality',decision='pass',reason='Validated scrap').json()
    assert act(client,order,'complete').status_code==409
    assert act(client,order,'complete',reason='Approved short close: two scrapped units').status_code==200

def test_quality_failure_holds_order_until_explicit_resolution(env):
    client,_=env
    order=finished(client)
    order=act(client,order,'quality',decision='fail',reason='Failed inspection').json()
    assert order['state']=='on_hold'
    assert act(client,order,'complete').status_code==409
    assert act(client,order,'quality',decision='pass',reason='Skip disposition').status_code==409
    order=act(client,order,'resume',reason='Verified disposition QC-002').json()
    assert order['quality']=='pending'
    order=act(client,order,'quality',decision='pass',reason='Re-inspection report').json()
    assert act(client,order,'complete').status_code==200

def test_hold_prevents_production(env):
    client,_=env
    order=released(client)
    order=act(client,order,'hold',reason='Machine breakdown').json()
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=1).status_code==409

def test_role_and_plant_isolation(env):
    client,engine=env
    with Session(engine) as db, db.begin():
        user=User(username='operator',password_hash=hash_password('operator-password-123'))
        db.add(user);db.flush();db.add(Grant(user_id=user.id,plant_id=1,role='operator'))
    order=released(client)
    login=client.post('/api/login',json={'username':'operator','password':'operator-password-123'}).json()
    client.headers['Authorization']='Bearer '+login['token']
    assert len(client.get('/api/plants').json())==1
    for path in ['orders','routes','lots','audit','orders/1/trace','lots/3/where-used']:
        assert client.get('/api/plants/2/'+path).status_code==403
    assert create_order(client,code='OP-CANNOT-CREATE').status_code==403
    assert act(client,order,'quality',decision='pass',reason='Not QA').status_code==403
    assert act(client,order,'record',operation_id=order['operations'][0]['id'],good=1).status_code==200

def test_audit_and_route_are_immutable_at_database_level(env):
    client,engine=env
    create_order(client)
    for statement in ["UPDATE audit_events SET action='forged'", "DELETE FROM audit_events", "UPDATE routes SET revision=2", "DELETE FROM routes"]:
        with pytest.raises(DatabaseError):
            with engine.begin() as connection: connection.execute(text(statement))

def test_logout_revokes_session(env):
    client,_=env
    assert client.post('/api/logout').status_code==200
    assert client.get('/api/plants').status_code==401

def test_unauthenticated_requests_rejected(env):
    client,_=env
    client.headers.pop('Authorization')
    assert client.get('/api/plants/1/orders').status_code==401

def test_input_validation(env):
    client,_=env
    assert create_order(client,qty=-1).status_code==422
    assert create_order(client,qty=1.5).status_code==422
    response=client.post('/api/plants/1/orders',json={'code':'BAD','route_id':1,'planned_qty':1})
    assert response.status_code==400

def test_lot_receipt_and_quality(env):
    client,_=env
    lot=client.post('/api/plants/1/lots',json={'code':'NEW','material':'HOUSING','quantity':5})
    assert lot.status_code==201
    id=lot.json()['id']
    assert client.post(f'/api/plants/1/lots/{id}/quality',json={'decision':'released','reason':'Inspection passed'}).status_code==200
    assert client.post(f'/api/plants/1/lots/{id}/quality',json={'decision':'rejected','reason':'Overwrite'}).status_code==409

def test_route_revision_does_not_change_existing_order(env):
    client,_=env
    order=create_order(client).json()
    route={'product':'ASM-100','revision':2,'name':'New route','steps':[{'name':'New operation','work_center':'NEW-01'}],'bom':[{'material':'HOUSING','per_unit':2,'unit':'pcs'}]}
    assert client.post('/api/plants/1/routes',json=route).status_code==201
    unchanged=client.get('/api/plants/1/orders').json()[0]
    assert unchanged['revision']==1 and len(unchanged['operations'])==3
    assert client.post('/api/plants/1/routes',json=route).status_code==409

def test_concurrent_writers_have_one_winner(env):
    client,engine=env
    order=released(client)
    body={'action':'record','version':order['version'],'operation_id':order['operations'][0]['id'],'good':1}
    app=create_app(engine)
    auth=client.headers['Authorization']
    def send(_):
        with TestClient(app) as c:
            return c.post(f'/api/plants/1/orders/{order["id"]}/actions',json=body,headers={'Authorization':auth,'Idempotency-Key':str(uuid.uuid4())}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(send,range(2)))
    assert sorted(codes)==[200,409]
    assert client.get('/api/plants/1/orders').json()[0]['operations'][0]['good']==1

def test_login_throttling(env):
    client,_=env
    for _ in range(10):
        assert client.post('/api/login',json={'username':'unknown','password':'wrong'}).status_code==401
    assert client.post('/api/login',json={'username':'unknown','password':'wrong'}).status_code==429

def test_health_and_security_headers(env):
    client,_=env
    assert client.get('/health/ready').status_code==200
    assert client.get('/').status_code==200
    assert "frame-ancestors 'none'" in client.get('/').headers['content-security-policy']
    assert client.get('/api/plants').headers['cache-control']=='no-store'
