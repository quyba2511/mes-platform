# Query index migration

New databases receive both indexes through SQLAlchemy metadata in `app/models.py`.
Existing databases require the SQL migration: `init-db` returns early for an
initialized schema and does not apply index changes.

The repository has no Alembic runner. These upgrade/downgrade scripts are compatible
with PostgreSQL and SQLite. Both directions are idempotent. They only create/drop
the two named indexes; schema version 1 and application data stay unchanged.

PostgreSQL (use the migration/owner role and a native PostgreSQL connection URL,
without SQLAlchemy's `+psycopg` driver suffix):

```sh
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f migrations/001_query_indexes.up.sql
# Roll back this migration:
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f migrations/001_query_indexes.down.sql
```

SQLite development database:

```sh
sqlite3 -bail mes-dev.db < migrations/001_query_indexes.up.sql
# Roll back this migration:
sqlite3 -bail mes-dev.db < migrations/001_query_indexes.down.sql
```

Schedule the PostgreSQL upgrade for a maintenance window: regular `CREATE INDEX`
can block writes while building indexes on large tables. The migration does not
run automatically when the API starts. No table data is rewritten.
