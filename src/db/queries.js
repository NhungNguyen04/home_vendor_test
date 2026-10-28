/**
 * Every SQL statement the application runs, prepared once per connection.
 *
 * Keeping them in one place means no query is built by string concatenation
 * anywhere, and no statement is recompiled per request.
 */
export function createStatements(db) {
  return {
    listCoordinators: db.prepare(`
      SELECT id, name, email FROM coordinators ORDER BY name`),

    getCoordinator: db.prepare(`
      SELECT * FROM coordinators WHERE id = ?`),

    getCoordinatorByEmail: db.prepare(`
      SELECT * FROM coordinators WHERE email = ?`),

    listVendors: db.prepare(`
      SELECT v.*, c.name AS owner_name
      FROM vendors v
      LEFT JOIN coordinators c ON c.id = v.owner_id
      ORDER BY v.name`),

    getVendor: db.prepare(`
      SELECT v.*, c.name AS owner_name
      FROM vendors v
      LEFT JOIN coordinators c ON c.id = v.owner_id
      WHERE v.id = ?`),

    // The concurrency guard: the version is part of the WHERE clause, so a
    // write built on a stale view affects zero rows instead of overwriting.
    updateVendorStage: db.prepare(`
      UPDATE vendors
      SET stage = ?, stage_entered_at = ?, version = version + 1
      WHERE id = ? AND version = ?`),

    insertHistory: db.prepare(`
      INSERT INTO stage_history
        (vendor_id, changed_by, previous_stage, new_stage, changed_at)
      VALUES
        (@vendorId, @changedBy, @previousStage, @newStage, @changedAt)`),

    listHistory: db.prepare(`
      SELECT h.*, c.name AS changed_by_name
      FROM stage_history h
      JOIN coordinators c ON c.id = h.changed_by
      WHERE h.vendor_id = ?
      ORDER BY h.changed_at DESC, h.id DESC`),

    lastHistoryForVendor: db.prepare(`
      SELECT * FROM stage_history
      WHERE vendor_id = ? AND new_stage = ?
      ORDER BY changed_at DESC, id DESC
      LIMIT 1`),

    countVendors: db.prepare(`SELECT COUNT(*) AS count FROM vendors`),

    countHistory: db.prepare(`SELECT COUNT(*) AS count FROM stage_history`),

    deleteVendors: db.prepare(`DELETE FROM stage_history`),
    deleteVendorsOnly: db.prepare(`DELETE FROM vendors`),
    deleteCoordinators: db.prepare(`DELETE FROM coordinators`),

    insertCoordinator: db.prepare(`
      INSERT INTO coordinators (id, name, email, password_hash, password_salt)
      VALUES (@id, @name, @email, @passwordHash, @passwordSalt)`),

    insertVendor: db.prepare(`
      INSERT INTO vendors
        (id, name, region, stage, stage_entered_at, owner_id, notes, version)
      VALUES (@id, @name, @region, @stage, @stageEnteredAt, @ownerId, @notes, @version)`),

    insertSeededHistory: db.prepare(`
      INSERT INTO stage_history
        (vendor_id, changed_by, previous_stage, new_stage, changed_at)
      VALUES (@vendorId, @changedBy, @previousStage, @newStage, @changedAt)`),
  };
}
