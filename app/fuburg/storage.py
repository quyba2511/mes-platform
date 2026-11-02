"""Small parameterized SQL facade for the supplied action domain, on the MES engine.

Only known table identifiers in SQL table positions are namespaced. Parameters
always use SQLAlchemy bind values. No SQLite database or schema is opened at runtime.
"""
import re
from contextlib import contextmanager
from sqlalchemy import text
from .schema import tables


class Record(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


class Result:
    def __init__(self, result):
        self.rowcount = result.rowcount
        self.data = [Record(r) for r in result.mappings()] if result.returns_rows else []
    def fetchone(self):
        return self.data.pop(0) if self.data else None
    def fetchall(self):
        return self.data


def statement(sql, args):
    sql = re.sub(r'\b(FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)\b',
                 lambda m: m[1] + ' ' + ('fb_' if m[2] in tables else '') + m[2], sql, flags=re.I)
    chunks = sql.split('?')
    if len(chunks) != len(args) + 1:
        raise ValueError('SQL parameter mismatch')
    return text(''.join(part + (f':p{i}' if i < len(args) else '') for i, part in enumerate(chunks))), {
        f'p{i}': value for i, value in enumerate(args)}


class Database:
    def __init__(self, engine):
        self.engine = engine
        self.connection = None

    @contextmanager
    def transaction(self, plant, write=True):
        if self.connection is not None:
            raise RuntimeError('Nested Fuburg transaction')
        with self.engine.begin() as connection:
            self.connection = connection
            try:
                if write:
                    connection.execute(text('UPDATE fb_config SET revision=revision+1 WHERE plant=:plant'), {'plant': plant})
                yield self
            finally:
                self.connection = None

    def execute(self, sql, args=()):
        stmt, params = statement(sql, args)
        if self.connection is not None:
            return Result(self.connection.execute(stmt, params))
        with self.engine.begin() as connection:
            return Result(connection.execute(stmt, params))

    def executemany(self, sql, seq):
        for args in seq:
            self.execute(sql, args)
