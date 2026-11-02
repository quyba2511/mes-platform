"""Add/remove only the fb_* module tables; supports SQLite and PostgreSQL.
Usage: python -m migrations.002_fuburg_workflow upgrade|downgrade
Downgrade deletes Fuburg records. Back them up before an explicitly requested rollback.
"""
import argparse
from sqlalchemy import text
from app.db import make_engine, database_url
from app import models
from app.fuburg.schema import FUBURG_TABLES


def upgrade(engine):
    with engine.begin() as conn:
        for table in FUBURG_TABLES:
            table.create(conn, checkfirst=True)
        if engine.dialect.name == 'sqlite':
            for action in ('UPDATE', 'DELETE'):
                conn.execute(text(f"CREATE TRIGGER IF NOT EXISTS fb_audit_{action.lower()} BEFORE {action} ON fb_mes_audit BEGIN SELECT RAISE(ABORT,'Immutable MES record'); END"))
        elif engine.dialect.name == 'postgresql':
            conn.execute(text("CREATE OR REPLACE FUNCTION fb_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable MES record'; END; $$"))
            conn.execute(text('DROP TRIGGER IF EXISTS fb_audit_immutable ON fb_mes_audit'))
            conn.execute(text('CREATE TRIGGER fb_audit_immutable BEFORE UPDATE OR DELETE ON fb_mes_audit FOR EACH ROW EXECUTE FUNCTION fb_immutable()'))


def downgrade(engine):
    with engine.begin() as conn:
        for table in reversed(FUBURG_TABLES):
            table.drop(conn, checkfirst=True)
        if engine.dialect.name == 'postgresql':
            conn.execute(text('DROP FUNCTION IF EXISTS fb_immutable()'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('direction',choices=['upgrade','downgrade'])
    globals()[parser.parse_args().direction](make_engine(database_url()))
