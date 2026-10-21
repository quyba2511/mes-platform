import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

def make_engine(url):
    engine = create_engine(url, pool_pre_ping=True, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def pragmas(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=10000")
    return engine

def database_url():
    url = os.getenv("DATABASE_URL", "sqlite:///./mes-dev.db")
    if os.getenv("MES_ENV") == "production" and not url.startswith("postgresql+psycopg://"):
        raise RuntimeError("Production requires PostgreSQL and DATABASE_URL")
    return url
