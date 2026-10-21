"""Explicit database provisioning; the web process never creates schema or demo accounts."""
import argparse
import getpass
import secrets
from zoneinfo import ZoneInfo
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session
from .db import Base, database_url, make_engine
from .models import Grant, Lot, Plant, Route, SchemaVersion, User
from .security import hash_password

def initialize(engine):
    if inspect(engine).has_table("schema_version"):
        with Session(engine) as db:
            if db.get(SchemaVersion, 1):
                return
        raise RuntimeError("Unknown schema version; do not overwrite database")
    if inspect(engine).get_table_names():
        raise RuntimeError("Database is not empty. Review migrations before initializing.")
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        connection.execute(text("INSERT INTO schema_version (id) VALUES (1)"))
        if engine.dialect.name == "postgresql":
            connection.execute(text("CREATE FUNCTION mes_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable MES record'; END; $$"))
            for table in ("audit_events", "routes"):
                connection.execute(text(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION mes_immutable()"))
        elif engine.dialect.name == "sqlite":
            for table in ("audit_events", "routes"):
                for action in ("UPDATE", "DELETE"):
                    connection.execute(text(f"CREATE TRIGGER {table}_{action.lower()} BEFORE {action} ON {table} BEGIN SELECT RAISE(ABORT, 'Immutable MES record'); END"))

def seed_demo(engine, password):
    with Session(engine) as db, db.begin():
        if db.scalar(select(User).where(User.username == "demo")):
            raise RuntimeError("Demo already exists; refusing to overwrite")
        user = User(username="demo", password_hash=hash_password(password), is_admin=True)
        db.add(user)
        db.flush()
        for code, name in [("HN", "Nhà máy Hà Nội"), ("BD", "Nhà máy Bình Dương")]:
            plant = Plant(code=code, name=name, timezone="Asia/Ho_Chi_Minh")
            db.add(plant)
            db.flush()
            db.add(Route(plant_id=plant.id, product="ASM-100", revision=1, name="Cụm truyền động tiêu chuẩn", created_by=user.id,
                         steps=[{"name": "Gia công", "work_center": "CNC-01"}, {"name": "Lắp ráp", "work_center": "ASSY-01"}, {"name": "Kiểm tra chức năng", "work_center": "TEST-01"}],
                         bom=[{"material": "HOUSING", "per_unit": 1, "unit": "pcs"}, {"material": "BOLT", "per_unit": 4, "unit": "pcs"}]))
            for material, quantity in [("HOUSING", 10000), ("BOLT", 40000)]:
                db.add(Lot(plant_id=plant.id, code=f"{code}-{material}-001", material=material, received=quantity, available=quantity, quality="released"))

def main():
    parser = argparse.ArgumentParser(description="MES database administration")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db")
    sub.add_parser("demo")
    create = sub.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("--admin", action="store_true")
    plant = sub.add_parser("create-plant")
    plant.add_argument("code")
    plant.add_argument("name")
    plant.add_argument("--timezone", default="Asia/Ho_Chi_Minh")
    grant = sub.add_parser("grant")
    grant.add_argument("username")
    grant.add_argument("plant_code")
    grant.add_argument("role", choices=["planner", "operator", "quality", "viewer"])
    args = parser.parse_args()
    engine = make_engine(database_url())
    if args.command == "init-db":
        initialize(engine)
        print("Schema version 1 ready")
        return
    if args.command == "demo":
        import os
        if os.getenv("MES_ENV") == "production":
            raise RuntimeError("Demo seed is disabled in production")
        password = secrets.token_urlsafe(18)
        seed_demo(engine, password)
        print(f"Local demo only. Username: demo\nPassword: {password}")
        return
    with Session(engine) as db, db.begin():
        if args.command == "create-user":
            password = getpass.getpass("Password (minimum 14 characters): ")
            if len(password) < 14 or password != getpass.getpass("Confirm password: "):
                raise ValueError("Password is too short or confirmation does not match")
            db.add(User(username=args.username, password_hash=hash_password(password), is_admin=args.admin))
        elif args.command == "create-plant":
            ZoneInfo(args.timezone)
            db.add(Plant(code=args.code, name=args.name, timezone=args.timezone))
        elif args.command == "grant":
            user = db.scalar(select(User).where(User.username == args.username))
            plant = db.scalar(select(Plant).where(Plant.code == args.plant_code))
            if user is None or plant is None:
                raise ValueError("User or plant does not exist")
            existing = db.scalar(select(Grant).where(Grant.user_id == user.id, Grant.plant_id == plant.id))
            if existing:
                existing.role = args.role
            else:
                db.add(Grant(user_id=user.id, plant_id=plant.id, role=args.role))
    print("Done. Record this privileged provisioning change in your infrastructure change log.")

if __name__ == "__main__":
    main()
