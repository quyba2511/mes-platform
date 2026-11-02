from datetime import datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from .db import Base

def now():
    return datetime.now(timezone.utc)

class SchemaVersion(Base):
    __tablename__ = "schema_version"
    id = Column(Integer, primary_key=True)

class Plant(Base):
    __tablename__ = "plants"
    id = Column(Integer, primary_key=True)
    code = Column(String(30), nullable=False, unique=True)
    name = Column(String(160), nullable=False)
    timezone = Column(String(80), nullable=False, default="Asia/Ho_Chi_Minh")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(80), unique=True, nullable=False)
    password_hash = Column(String(300), nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    is_admin = Column(Boolean, nullable=False, default=False)

class Grant(Base):
    __tablename__ = "plant_grants"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id"), nullable=False)
    plant_id = Column(ForeignKey("plants.id"), nullable=False)
    role = Column(String(30), nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "plant_id"), CheckConstraint("role IN ('planner','operator','quality','viewer')"))

class Session(Base):
    __tablename__ = "sessions"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    key = Column(String(64), primary_key=True)
    count = Column(Integer, nullable=False, default=0)
    window_start = Column(DateTime(timezone=True), nullable=False)

class Route(Base):
    __tablename__ = "routes"
    id = Column(Integer, primary_key=True)
    plant_id = Column(ForeignKey("plants.id"), nullable=False, index=True)
    product = Column(String(80), nullable=False)
    revision = Column(Integer, nullable=False)
    name = Column(String(160), nullable=False)
    steps = Column(JSON, nullable=False)
    bom = Column(JSON, nullable=False)
    created_by = Column(ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now, nullable=False)
    __table_args__ = (UniqueConstraint("plant_id", "product", "revision"), CheckConstraint("revision > 0"))

class WorkOrder(Base):
    __tablename__ = "work_orders"
    id = Column(Integer, primary_key=True)
    plant_id = Column(ForeignKey("plants.id"), nullable=False, index=True)
    code = Column(String(80), nullable=False)
    route_id = Column(ForeignKey("routes.id"), nullable=False)
    product = Column(String(80), nullable=False)
    revision = Column(Integer, nullable=False)
    planned_qty = Column(Integer, nullable=False)
    state = Column(String(30), nullable=False, default="draft")
    quality = Column(String(30), nullable=False, default="pending")
    hold_reason = Column(String(500))
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("plant_id", "code"), CheckConstraint("planned_qty > 0"), CheckConstraint("state IN ('draft','released','in_progress','on_hold','completed')"), CheckConstraint("quality IN ('pending','pass','fail')"))

class Operation(Base):
    __tablename__ = "operations"
    id = Column(Integer, primary_key=True)
    order_id = Column(ForeignKey("work_orders.id"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False)
    name = Column(String(160), nullable=False)
    work_center = Column(String(100), nullable=False)
    good = Column(Integer, nullable=False, default=0)
    scrap = Column(Integer, nullable=False, default=0)
    done = Column(Boolean, nullable=False, default=False)
    __table_args__ = (UniqueConstraint("order_id", "sequence"), CheckConstraint("good >= 0 AND scrap >= 0"))

class Lot(Base):
    __tablename__ = "material_lots"
    id = Column(Integer, primary_key=True)
    plant_id = Column(ForeignKey("plants.id"), nullable=False, index=True)
    code = Column(String(80), nullable=False)
    material = Column(String(80), nullable=False)
    received = Column(Integer, nullable=False)
    available = Column(Integer, nullable=False)
    unit = Column(String(20), nullable=False, default="pcs")
    quality = Column(String(20), nullable=False, default="quarantine")
    __table_args__ = (UniqueConstraint("plant_id", "code"), CheckConstraint("received > 0 AND available >= 0 AND available <= received"), CheckConstraint("quality IN ('quarantine','released','rejected')"))

class Consumption(Base):
    __tablename__ = "consumptions"
    id = Column(Integer, primary_key=True)
    order_id = Column(ForeignKey("work_orders.id"), nullable=False, index=True)
    lot_id = Column(ForeignKey("material_lots.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("order_id", "lot_id"), CheckConstraint("quantity > 0"))

class Audit(Base):
    __tablename__ = "audit_events"
    id = Column(Integer, primary_key=True)
    plant_id = Column(ForeignKey("plants.id"), nullable=False, index=True)
    actor_id = Column(ForeignKey("users.id"), nullable=False)
    action = Column(String(80), nullable=False)
    entity = Column(String(80), nullable=False)
    entity_id = Column(Integer, nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (Index("ix_audit_events_plant_entity_entity_id", "plant_id", "entity", "entity_id"),)

class Command(Base):
    __tablename__ = "commands"
    id = Column(Integer, primary_key=True)
    user_id = Column(ForeignKey("users.id"), nullable=False)
    key = Column(String(80), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    response = Column(JSON, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "key"),)

class Outbox(Base):
    __tablename__ = "outbox"
    id = Column(Integer, primary_key=True)
    plant_id = Column(ForeignKey("plants.id"), nullable=False)
    topic = Column(String(80), nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    delivered_at = Column(DateTime(timezone=True))
