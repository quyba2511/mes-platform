CREATE INDEX IF NOT EXISTS ix_audit_events_plant_entity_entity_id
    ON audit_events (plant_id, entity, entity_id);

CREATE INDEX IF NOT EXISTS ix_consumptions_lot_id
    ON consumptions (lot_id);
