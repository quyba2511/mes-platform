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

For large PostgreSQL tables that must continue accepting writes, use the following
alternative **instead of** the transactional upgrade above. Execute each statement
in its own `psql` invocation, without `--single-transaction` or an explicit `BEGIN`:

```sh
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_audit_events_plant_entity_entity_id ON audit_events (plant_id, entity, entity_id);'
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_consumptions_lot_id ON consumptions (lot_id);'
```

Concurrent builds take more work and may wait for existing transactions. They can
also leave an invalid index after a failure. Before retrying or considering the
upgrade complete, check that **both** indexes exist and are valid:

```sql
SELECT indexes.relname, pg_index.indisvalid
FROM pg_index
JOIN pg_class AS indexes ON indexes.oid = pg_index.indexrelid
JOIN pg_namespace AS namespaces ON namespaces.oid = indexes.relnamespace
WHERE namespaces.nspname = current_schema()
  AND indexes.relname IN (
      'ix_audit_events_plant_entity_entity_id',
      'ix_consumptions_lot_id'
  );
```

The result must contain two rows, both with `indisvalid = true`. `IF NOT EXISTS`
does not repair an invalid existing index. If a build failed, investigate the
cause, drop only the affected invalid index with `DROP INDEX CONCURRENTLY`, then
retry its creation command. Concurrent rollback also uses one invocation per index:

```sh
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP INDEX CONCURRENTLY IF EXISTS ix_consumptions_lot_id;'
psql "$MES_MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP INDEX CONCURRENTLY IF EXISTS ix_audit_events_plant_entity_entity_id;'
```

These concurrent commands are PostgreSQL-only; the portable SQL scripts and their
SQLite support remain unchanged. See PostgreSQL's
[concurrent index build documentation](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

Keep the existing `ix_audit_events_plant_id` index. The new composite index serves
the entity trace lookup and does not replace the plant-only audit-list access path.
Both upgrade and downgrade leave that existing index in place; a future
`(plant_id, id)` index for audit pagination is outside this migration's scope.

SQLite development database:

```sh
sqlite3 -bail mes-dev.db < migrations/001_query_indexes.up.sql
# Roll back this migration:
sqlite3 -bail mes-dev.db < migrations/001_query_indexes.down.sql
```

Schedule the PostgreSQL upgrade for a maintenance window: regular `CREATE INDEX`
can block writes while building indexes on large tables. The migration does not
run automatically when the API starts. No table data is rewritten.
