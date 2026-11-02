"""Business acceptance tests; synthetic fixtures, no external SAP connection."""
import copy
import importlib
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
import pytest
from sqlalchemy import select, insert, text, inspect
from sqlalchemy.orm import Session
from app.models import Plant, User, Grant
from app.security import hash_password
from app.fuburg.core import api, MesError, one, rows
from app.fuburg.manage import configure
from app.fuburg.storage import Database
from app.fuburg.schema import roles
from app.fuburg.worker import pull_events_once, push_outbox_once
from fuburg_support.fake_intf import FakeIntf
from test_workflows import env

ORDER = {'plant':'1011','order_no':'000000000001','source_version':1,'order_type':'PP01',
         'order_uom':'B','planned_qty':'20','planned_pieces':1200,'main_work_center':'TEST-WC','site':'TEST-SITE',
         'released':True,'closed':False,'deleted':False,
         'material':{'material':'TEST-FG','description':'Synthetic training product','source_version':1,'base_uom':'EA','uoms':[{'uom':'B','numerator':50,'denominator':1}]},
         'order_uom_rate':{'numerator':60,'denominator':1,'source':'AFPO'},
         'operations':[{'operation_no':'0010','work_center':'TEST-WC'}],
         'components':[{'reservation_no':'0000000001','reservation_item':'0001','material':'TEST-RAW','issue_uom':'KG','backflush':False}],
         'ay_materials':[{'ay_material':'D0015241'}]}

@pytest.fixture
def fb(env):
    client, engine = env
    with Session(engine) as s, s.begin():
        plant = Plant(code='1011',name='Test Taiwan',timezone='Asia/Taipei'); s.add(plant);s.flush();pid=plant.id
        s.add(Plant(code='2101',name='Test Thailand',timezone='Asia/Bangkok'))
    cfg=json.loads((Path(__file__).parents[1]/'config/fuburg.example.json').read_text())['plants']['1011']
    cfg.update(integration_enabled=True,carton_sloc='3201')
    cfg['grade_rule_ref']['status']=cfg['sites']['status']='APPROVED'
    configure(engine,'1011',cfg);configure(engine,'2101',cfg)
    db=Database(engine)
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'ORDER','payload':copy.deepcopy(ORDER)},role='SYNC')
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'MASTER','payload':{'kind':'material','material':'D0015241','material_type':'ZHAL','source_version':1}},role='SYNC')
    def call(action, body=None, role='ADMIN', plant='1011'):
        return api(db,action,dict(body or {},plant=plant),role=role,user='tester')
    return client,engine,db,call,pid


def produce(call, good=130, ay=10, scrap=5, order='000000000001',line='L1'):
    run=call('start_run',{'order_no':order,'line':line,'production_date':'2026-11-03','shift':'A','operator':'OP'})['run_id']
    for grade,qty in [('A',good),('B',ay),('C',scrap)]:
        if qty:call('report_output',{'run_id':run,'grade_code':grade,'pieces':str(qty)})
    call('finish_run',{'run_id':run,'machine_minutes':'60'})
    return run


def completion(call, good=130):
    run=produce(call,good)
    return call('confirm_completion',{'run_ids':[run],'posting_date':'2026-11-03','approved_by':'LEAD','approval_ref':'APR-1','actor':'LEAD'})


def chain(call):
    c=completion(call)
    rel=call('release_quality',{'completion_id':c['completion_id'],'pieces':130,'actor':'QA','evidence_ref':'QC-1'})
    pkg=call('record_packaging',{'release_id':rel['release_id'],'package_uom':'B','actual_packages':2,'loose_pieces':10,'lot_no':'LOT-1','actor':'OP','evidence_ref':'PK-1'})
    rec=call('submit_receipt',{'package_id':pkg['package_id'],'actual_packages':2,'loose_pieces':10,'storage_location':'1101','posting_date':'2026-11-03','shift':'A','actor':'OP','evidence_ref':'GR-1'})
    return c,rel,pkg,rec


def test_full_chain_preserves_grades_units_and_order(fb):
    _,_,db,call,_=fb
    c,rel,pkg,rec=chain(call)
    assert (c['good_pieces'],c['ay_pieces'],c['scrap_pieces'])==(130,10,5)
    assert pkg['pieces']==130 # AFPO 60, not MARM 50
    assert (rec['quantity'],rec['uom'])==('130','EA')
    call('decide_receipt',{'receipt_id':rec['receipt_id'],'decision':'APPROVE','actor':'WH','evidence_ref':'WH-1'})
    fake=FakeIntf()
    assert push_outbox_once(db,fake,'1011')=={'sent':5,'retry':0,'failed':0}
    assert [a for a,b in fake.calls]==['submit_completion','release_quality','record_packaging','submit_receipt','decide_receipt']
    payload=fake.calls[0][1]
    assert payload['good_pieces']=='130' and payload['scrap_pieces']=='5'
    assert payload['grades'][1]['disposition']=='AY'
    assert one(db,'SELECT state FROM receipt WHERE receipt_id=?',rec['receipt_id'])['state']=='APPROVED'
    # Stale business event must not regress a final warehouse decision.
    pull_events_once(db,fake,'1011')
    assert call('get_completion',{'completion_id':c['completion_id']})['receipts'][0]['state']=='APPROVED'


def test_quality_and_packaging_balance(fb):
    *_,call,pid=fb
    c=completion(call,60)
    with pytest.raises(MesError,match='RELEASE_EXCEEDS_GOOD'):
        call('release_quality',{'completion_id':c['completion_id'],'pieces':61,'actor':'QA','evidence_ref':'Q'})
    rel=call('release_quality',{'completion_id':c['completion_id'],'pieces':60,'actor':'QA','evidence_ref':'Q'})
    body={'release_id':rel['release_id'],'package_uom':'B','actual_packages':1,'loose_pieces':1,'lot_no':'L','actor':'M','evidence_ref':'E'}
    with pytest.raises(MesError,match='PACKAGE_EXCEEDS_RELEASE'):call('record_packaging',body)
    body['loose_pieces']=0;pkg=call('record_packaging',body)
    receipt={'package_id':pkg['package_id'],'actual_packages':1,'loose_pieces':0,'storage_location':'2101','posting_date':'2026-11-03','shift':'A','actor':'M','evidence_ref':'E'}
    with pytest.raises(MesError,match='ASRS_MANAGED_SLOC'):call('submit_receipt',receipt)
    receipt['storage_location']='1101';result=call('submit_receipt',receipt)
    assert (result['quantity'],result['uom'])==('1','B')


def test_duplicate_warehouse_decision_rejected(fb):
    _,_,db,call,_=fb
    *_,r=chain(call)
    b={'receipt_id':r['receipt_id'],'decision':'REJECT','actor':'W','evidence_ref':'E','reason':'Wrong lot','request_id':'decision-1'}
    call('decide_receipt',b);assert call('decide_receipt',b)['duplicate']
    with pytest.raises(MesError,match='RECEIPT_NOT_DRAFT'):call('decide_receipt',dict(b,request_id='decision-2'))
    assert len(rows(db,"SELECT * FROM outbox WHERE intf_action='decide_receipt'"))==1


def test_retry_identical_after_remote_commit_and_dependencies_block(fb):
    _,_,db,call,_=fb
    chain(call);fake=FakeIntf();fake.lose_reply.add('submit_completion')
    assert push_outbox_once(db,fake,'1011')['retry']==1
    db.execute('UPDATE outbox SET next_try_at=NULL')
    assert push_outbox_once(db,fake,'1011')['sent']==4
    bodies=[b for a,b in fake.calls if a=='submit_completion']
    assert bodies[0]==bodies[1]
    c=completion(call)
    call('release_quality',{'completion_id':c['completion_id'],'pieces':1,'actor':'Q','evidence_ref':'E'})
    fake.fail_next['submit_completion']=['ORDER_NOT_OPEN_OR_SITE_MISMATCH']
    assert push_outbox_once(db,fake,'1011')['failed']==1
    counts=call('outbox_status')['counts'];assert counts['FAILED']==counts['BLOCKED']==1


def test_inbox_commits_before_ack_dedupe_and_stale_order(fb):
    _,engine,db,call,_=fb
    fake=FakeIntf();fake.publish_order(dict(ORDER,source_version=2),site='TEST-SITE',rate=ORDER['order_uom_rate'])
    original=fake.a_ack_delivery
    def ack(b):
        assert one(Database(engine),'SELECT event_id FROM inbox_event WHERE event_id=?',b['event_id'])
        return original(b)
    fake.a_ack_delivery=ack
    pull_events_once(db,fake,'1011')
    event=fake.events[0];event['state']='PENDING'
    pull_events_once(db,fake,'1011')
    assert len(rows(db,'SELECT * FROM inbox_event WHERE event_id=?',event['event_id']))==1
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'ORDER','payload':ORDER},role='SYNC')
    assert call('get_order',{'order_no':ORDER['order_no']})['source_version']==2


def test_cross_plant_event_and_entity_are_rejected(fb):
    _,_,db,call,_=fb
    c=completion(call)
    with pytest.raises(MesError,match='COMPLETION_NOT_FOUND'):
        call('release_quality',{'completion_id':c['completion_id'],'pieces':1,'actor':'Q','evidence_ref':'E'},plant='2101')
    with pytest.raises(MesError,match='EVENT_PLANT_MISMATCH'):
        api(db,'ingest_event',{'plant':'2101','event_id':'malformed','event_type':'ORDER','payload':ORDER},role='SYNC')


def test_sap_order_changed_while_run_in_progress(fb):
    _,_,db,call,_=fb
    run=call('start_run',{'order_no':ORDER['order_no'],'line':'L','production_date':'2026-11-03','shift':'A','operator':'O'})
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'ORDER','payload':dict(ORDER,source_version=2)},role='SYNC')
    with pytest.raises(MesError,match='ORDER_VERSION_CHANGED'):call('report_output',{'run_id':run['run_id'],'grade_code':'A','pieces':1})


def test_ay_pair_and_asrs_carton_rules(fb):
    _,_,db,call,_=fb
    b={'order_no':ORDER['order_no'],'ay_material':'D0015241','quantity':'2','uom':'B','storage_location':'2101','posting_date':'2026-11-03','shift':'A','actor':'O'}
    r=call('report_ay',b)
    assert [(i['movement_type'],i['quantity']) for i in r['items']]==[('531','2'),('261','2')]
    with pytest.raises(MesError,match='AY_PACK_COUNT_MISMATCH'):call('report_ay',dict(b,cartons=3))
    with pytest.raises(MesError,match='ASRS_MANAGED_SLOC'):call('report_ay',dict(b,carton_sloc='2101'))


def test_consumption_uses_abc_weights_and_preview_snapshot(fb):
    _,_,db,call,_=fb
    second=copy.deepcopy(ORDER);second['order_no']='000000000002';second['components'][0]['reservation_no']='0000000002'
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'ORDER','payload':second},role='SYNC')
    produce(call,700,10,10);produce(call,470,0,10,order=second['order_no'])
    scope={'line':'L1','production_date':'2026-11-03','shift':'A'}
    use=dict(scope,material='TEST-RAW',quantity='200',uom='KG',storage_location='3201')
    call('record_material_use',use)
    preview=call('preview_consumption',scope)
    assert [Decimal(v[0]['quantity']) for v in preview['plan'].values()]==[Decimal(120),Decimal(80)]
    body=dict(scope,posting_date='2026-11-03',actor='LEAD',preview_token=preview['preview_token'])
    call('record_material_use',dict(use,quantity='1'))
    with pytest.raises(MesError,match='CONSUMPTION_PREVIEW_CHANGED'):call('allocate_consumption',body)
    preview=call('preview_consumption',scope)
    movements=call('allocate_consumption',dict(body,preview_token=preview['preview_token']))['movements']
    assert len(movements)==2
    assert sum(Decimal(m['items'][0]['quantity']) for m in movements)==Decimal(201)
    assert movements[1]['items'][0]['reservation_no']=='0000000002'
    with pytest.raises(MesError,match='NOTHING_TO_ALLOCATE'):call('allocate_consumption',body)
    with pytest.raises(MesError,match='UOM_CONVERSION_FAILED'):
        call('return_material',{'order_no':ORDER['order_no'],'items':[{'material':'TEST-RAW','quantity':1,'uom':'WRONG','storage_location':'3201'}],'posting_date':'2026-11-03','shift':'A','actor':'O'})


@pytest.mark.parametrize('value',['NaN','Infinity','-1','0','0.0001'])
def test_invalid_quantities_are_atomic(fb,value):
    _,_,db,call,_=fb
    before=len(rows(db,'SELECT * FROM mes_audit'))
    with pytest.raises(MesError):
        call('record_material_use',{'line':'L','production_date':'2026-11-03','shift':'A','material':'RAW','quantity':value,'uom':'KG','storage_location':'3201'})
    assert not rows(db,'SELECT * FROM material_use')
    assert len(rows(db,'SELECT * FROM mes_audit'))==before


def test_http_rbac_actor_and_idempotency(fb):
    client,engine,db,call,pid=fb
    path=f'/api/plants/{pid}/fuburg/actions'
    def send(action,body,key='http-key-1'):
        return client.post(path,json={'action':action,'body':body},headers={'Idempotency-Key':key})
    body={'order_no':ORDER['order_no'],'line':'L','production_date':'2026-11-03','shift':'A','operator':'forged','actor':'forged'}
    result=send('start_run',body);assert result.status_code==200,result.text
    assert send('start_run',body).json()['duplicate']
    assert send('start_run',dict(body,line='L2')).status_code==409
    assert one(db,'SELECT actor FROM mes_audit ORDER BY id DESC LIMIT 1')['actor']=='demo'
    assert send('ingest_event',{}).status_code==403
    assert send('start_run',dict(body,plant='2101')).status_code==403
    with Session(engine) as s,s.begin():
        u=User(username='viewer',password_hash=hash_password('test-only-password-123'));s.add(u);s.flush();s.add(Grant(user_id=u.id,plant_id=pid,role='viewer'))
    token=client.post('/api/login',json={'username':'viewer','password':'test-only-password-123'}).json()['token']
    client.headers['Authorization']='Bearer '+token
    assert send('start_run',body).status_code==403
    assert client.get(f'/api/plants/{pid}/fuburg').status_code==200
    assert client.get('/api/plants/1/fuburg').status_code==403


def test_two_concurrent_qc_releases_cannot_overallocate(fb):
    _,engine,_,call,_=fb
    c=completion(call,60)
    def release(_):
        try:
            api(Database(engine),'release_quality',{'plant':'1011','completion_id':c['completion_id'],'pieces':40,'actor':'Q','evidence_ref':'E'},role='QA')
            return 'ok'
        except MesError as exc:return exc.code
    with ThreadPoolExecutor(2) as pool:result=list(pool.map(release,range(2)))
    assert sorted(result)==['RELEASE_EXCEEDS_GOOD','ok']


def test_integration_disabled_until_configuration_approved(fb):
    _,engine,db,_,_=fb
    cfg=json.loads(one(db,'SELECT settings FROM fb_config WHERE plant=?','1011')['settings'])
    cfg['integration_enabled']=False;configure(engine,'1011',cfg)
    fake=FakeIntf()
    with pytest.raises(MesError,match='INTEGRATION_DISABLED'):push_outbox_once(db,fake,'1011')
    assert not fake.calls
    cfg['integration_enabled']=True;cfg['sites']['status']='PENDING'
    with pytest.raises(ValueError):configure(engine,'1011',cfg)


def test_migration_up_down_preserves_existing_mes(env):
    _,engine=env
    migration=importlib.import_module('migrations.002_fuburg_workflow')
    migration.upgrade(engine);migration.upgrade(engine)
    assert 'fb_outbox' in inspect(engine).get_table_names()
    migration.downgrade(engine)
    assert 'fb_outbox' not in inspect(engine).get_table_names()
    assert 'work_orders' in inspect(engine).get_table_names()
    migration.upgrade(engine)


def test_packaging_uses_confirmation_snapshot_after_order_update(fb):
    _,_,db,call,_=fb
    c=completion(call,120)
    changed=copy.deepcopy(ORDER);changed['source_version']=2;changed['order_uom_rate']['numerator']=30
    api(db,'ingest_event',{'plant':'1011','event_id':str(uuid.uuid4()),'event_type':'ORDER','payload':changed},role='SYNC')
    rel=call('release_quality',{'completion_id':c['completion_id'],'pieces':120,'actor':'Q','evidence_ref':'E'})
    pkg=call('record_packaging',{'release_id':rel['release_id'],'package_uom':'B','actual_packages':2,'loose_pieces':0,'lot_no':'L','actor':'M','evidence_ref':'E'})
    assert pkg['pieces']==120
    with pytest.raises(MesError,match='ORDER_VERSION_CHANGED'):
        call('submit_receipt',{'package_id':pkg['package_id'],'actual_packages':2,'loose_pieces':0,'storage_location':'1101','posting_date':'2026-11-03','shift':'A','actor':'M','evidence_ref':'E'})


def test_supervisor_can_preview_but_operator_cannot_confirm(fb):
    _,_,_,call,_=fb
    produce(call)
    scope={'line':'L1','production_date':'2026-11-03','shift':'A'}
    call('record_material_use',dict(scope,material='TEST-RAW',quantity=1,uom='KG',storage_location='3201'))
    preview=call('preview_consumption',scope,role='LEAD')
    body=dict(scope,posting_date='2026-11-03',actor='L',preview_token=preview['preview_token'])
    with pytest.raises(MesError,match='ROLE_NOT_ALLOWED'):call('allocate_consumption',body,role='MES')
    assert call('allocate_consumption',body,role='LEAD')['movements']


def test_audit_cannot_be_modified(fb):
    from sqlalchemy.exc import DatabaseError
    _,_,db,_,_=fb
    with pytest.raises(DatabaseError):db.execute("UPDATE mes_audit SET actor='forged'")
    with pytest.raises(DatabaseError):db.execute('DELETE FROM mes_audit')


def test_bad_date_and_labor_roll_back(fb):
    _,_,db,call,_=fb
    b={'order_no':ORDER['order_no'],'line':'L','production_date':'bad-date','shift':'A','operator':'O'}
    with pytest.raises(MesError,match='INVALID_REQUEST'):call('start_run',b)
    run=call('start_run',dict(b,production_date='2026-11-03'))
    with pytest.raises(MesError,match='PIECE_INTEGER_REQUIRED'):
        call('finish_run',{'run_id':run['run_id'],'machine_minutes':10,'labor':[{'work_center':'W','headcount':-1,'labor_minutes':5}]})
    assert one(db,'SELECT state FROM run WHERE run_id=?',run['run_id'])['state']=='OPEN'
