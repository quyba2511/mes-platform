"""Explicit Fuburg provisioning. Web startup never installs schema or loads examples."""
import argparse
import json
from pathlib import Path
from sqlalchemy import delete, insert, select, update
from sqlalchemy.orm import Session
from ..db import make_engine, database_url
from ..models import Plant, User, Grant
from .schema import config, roles
from .storage import Database
from .core import api


def configure(engine, plant_code, settings):
    if not isinstance(settings, dict) or not settings.get('grades') or not settings.get('shifts'):
        raise ValueError('Plant configuration requires grades and shifts')
    if settings.get('integration_enabled'):
        for field in ('grade_rule_ref', 'sites'):
            if settings.get(field, {}).get('status') != 'APPROVED':
                raise ValueError(f'{field} must be approved before integration is enabled')
    with engine.begin() as conn:
        if not conn.scalar(select(Plant.id).where(Plant.code == plant_code)):
            raise ValueError('Create the MES plant first')
        row = conn.scalar(select(config.c.plant).where(config.c.plant == plant_code))
        if row:
            conn.execute(update(config).where(config.c.plant == plant_code).values(settings=json.dumps(settings), revision=config.c.revision+1))
        else:
            conn.execute(insert(config).values(plant=plant_code,settings=json.dumps(settings)))


def main():
    parser = argparse.ArgumentParser(description='Configure Fuburg module')
    sub = parser.add_subparsers(dest='command', required=True)
    cfg = sub.add_parser('configure'); cfg.add_argument('plant'); cfg.add_argument('file')
    grant = sub.add_parser('grant'); grant.add_argument('username'); grant.add_argument('plant'); grant.add_argument('role',choices=['MES','LEAD','QA','WH','VIEWER'])
    worker = sub.add_parser('worker'); worker.add_argument('plants',nargs='+'); worker.add_argument('--poll',type=float,default=2)
    args = parser.parse_args(); engine = make_engine(database_url())
    if args.command == 'configure':
        document = json.loads(Path(args.file).read_text())
        configure(engine,args.plant,document['plants'][args.plant])
    elif args.command == 'grant':
        with Session(engine) as db, db.begin():
            user = db.scalar(select(User).where(User.username==args.username))
            plant = db.scalar(select(Plant).where(Plant.code==args.plant))
            if not user or not plant or not db.scalar(select(Grant).where(Grant.user_id==user.id,Grant.plant_id==plant.id)):
                raise ValueError('User must already have access to this plant')
            db.execute(delete(roles).where(roles.c.user_id==user.id,roles.c.plant_id==plant.id))
            db.execute(insert(roles).values(user_id=user.id,plant_id=plant.id,role=args.role))
    else:
        from .intf_client import SqlServerIntf
        from .worker import run_forever
        run_forever(Database(engine),SqlServerIntf(),args.plants,args.poll)

if __name__ == '__main__':
    main()
