import uuid
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, inspect, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session

from app.db import make_engine
from app.main import create_app, order_data
from app.manage import initialize, seed_demo
from app.models import Audit, Consumption, Grant, Lot, Operation, Outbox, Route, User, WorkOrder
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


def get_orders_with_queries(client, engine):
    statements = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = client.get('/api/plants/1/orders')
    finally:
        event.remove(engine, 'before_cursor_execute', capture)
    assert response.status_code == 200, response.text
    return response.json(), statements


def test_orders_query_count_is_constant(env):
    client, engine = env
    counts = []
    created = 0
    # Include another plant's operations to catch missing plant/order scoping.
    assert create_order(client, code='OTHER-PLANT', plant=2, route=2).status_code == 201
    for size in (3, 10):
        while created < size:
            created += 1
            assert create_order(client, code=f'COUNT-{created}').status_code == 201
        # The original per-order serializer provides the full pre-change response,
        # outside the measured request (including database timestamp formatting).
        with Session(engine) as db:
            expected = [order_data(db, order) for order in db.scalars(
                select(WorkOrder).where(WorkOrder.plant_id == 1).order_by(WorkOrder.id.desc()).limit(500))]
        payload, statements = get_orders_with_queries(client, engine)
        counts.append(len(statements))
        assert payload == expected
        assert len(payload) == size
        assert all(len(order['operations']) == 3 for order in payload)
        assert len({op['id'] for order in payload for op in order['operations']}) == size * 3
        data_queries = [sql for sql in statements if 'FROM work_orders' in sql or 'FROM operations' in sql]
        assert len(data_queries) == 2
    # Four unchanged queries authenticate the session/user and check grant/plant;
    # only two queries fetch orders and operations, regardless of result count.
    assert counts[0] == counts[1]
    assert max(counts) <= 6


def test_empty_orders_skip_operation_query(env):
    client, engine = env
    payload, statements = get_orders_with_queries(client, engine)
    assert payload == []
    assert len(statements) <= 5
    assert not any('FROM operations' in sql for sql in statements)


def test_order_without_operations_does_not_fall_back_to_per_order_query(env):
    client, engine = env
    with Session(engine) as db, db.begin():
        db.add(WorkOrder(plant_id=1, code='NO-OPERATIONS', route_id=1,
                         product='ASM-100', revision=1, planned_qty=10))
    payload, statements = get_orders_with_queries(client, engine)
    assert len(payload) == 1 and payload[0]['operations'] == []
    assert sum('FROM operations' in sql for sql in statements) == 1
    assert len(statements) <= 6


def test_orders_preserve_limit_and_operation_sequence(env):
    client, engine = env
    with Session(engine) as db, db.begin():
        for index in range(501):
            order = WorkOrder(plant_id=1, code=f'PAGE-{index}', route_id=1,
                              product='ASM-100', revision=1, planned_qty=10)
            db.add(order)
            db.flush()
            # Deliberately insert out of sequence so ordering is observable.
            for sequence in (3, 1, 2):
                db.add(Operation(order_id=order.id, sequence=sequence,
                                 name=f'{order.code}-STEP-{sequence}', work_center='CNC-01'))
    payload, statements = get_orders_with_queries(client, engine)
    assert len(payload) == 500
    assert [order['code'] for order in payload] == [f'PAGE-{index}' for index in range(500, 0, -1)]
    for order in payload:
        assert [op['sequence'] for op in order['operations']] == [1, 2, 3]
        assert [op['name'] for op in order['operations']] == [f'{order["code"]}-STEP-{i}' for i in (1, 2, 3)]
    assert len(statements) <= 6


def test_query_indexes_and_reversible_migration(env):
    _, engine = env
    expected = {
        'audit_events': ('ix_audit_events_plant_entity_entity_id', ['plant_id', 'entity', 'entity_id']),
        'consumptions': ('ix_consumptions_lot_id', ['lot_id']),
    }

    def assert_indexes_present():
        for table, (name, columns) in expected.items():
            indexes = {index['name']: index['column_names'] for index in inspect(engine).get_indexes(table)}
            assert indexes[name] == columns
            if table == 'audit_events':
                assert indexes['ix_audit_events_plant_id'] == ['plant_id']

    def migrate(direction):
        script = Path(__file__).parents[1] / 'migrations' / f'001_query_indexes.{direction}.sql'
        with engine.begin() as connection:
            for statement in script.read_text().split(';'):
                if statement.strip():
                    connection.exec_driver_sql(statement)

    assert_indexes_present()  # Fresh databases get indexes from ORM metadata.
    migrate('down')
    migrate('down')  # Downgrade is idempotent too.
    for table, (name, _) in expected.items():
        assert name not in {index['name'] for index in inspect(engine).get_indexes(table)}
    assert 'ix_audit_events_plant_id' in {index['name'] for index in inspect(engine).get_indexes('audit_events')}
    migrate('up')
    migrate('up')
    assert_indexes_present()
