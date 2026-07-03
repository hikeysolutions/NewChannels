"use strict";

const Database = require("better-sqlite3");
const { expandHome } = require("./env");

// Thin repository over the SQLite tracking database (Section 00c). All access
// to tracking.db from the script generator goes through here.
function openDb(dbPath) {
  const resolved = expandHome(dbPath);
  const db = new Database(resolved, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  return db;
}

// Pick an entity/situation combo for a channel. An explicit entity+situation
// override wins; otherwise the least-used, oldest combo is chosen so content
// rotates instead of repeating (Section 01 rotation axes).
function pickCombo(db, channel, entityOverride, situationOverride) {
  if (entityOverride && situationOverride) {
    const row = db
      .prepare(
        `SELECT id, channel, entity, situation, used_count
           FROM entity_situation_bank
          WHERE channel = ? AND entity = ? AND situation = ?`
      )
      .get(channel, entityOverride, situationOverride);
    if (!row) {
      throw new Error(
        `combo not found in bank: ${channel} / ${entityOverride} / ${situationOverride}`
      );
    }
    return row;
  }

  const row = db
    .prepare(
      `SELECT id, channel, entity, situation, used_count
         FROM entity_situation_bank
        WHERE channel = ?
        ORDER BY used_count ASC, (last_used_at IS NULL) DESC, id ASC
        LIMIT 1`
    )
    .get(channel);

  if (!row) {
    throw new Error(
      `entity_situation_bank has no rows for channel "${channel}" - seed it first`
    );
  }
  return row;
}

// Insert a new videos row in the 'scripting' state and return its id.
function insertVideo(db, video) {
  const stmt = db.prepare(
    `INSERT INTO videos (channel, entity, situation, title, status, script_path, manifest_path)
     VALUES (@channel, @entity, @situation, @title, 'scripting', @script_path, @manifest_path)`
  );
  const info = stmt.run(video);
  return info.lastInsertRowid;
}

// Mark a combo as used once a script has been generated for it.
function markComboUsed(db, channel, entity, situation) {
  db.prepare(
    `UPDATE entity_situation_bank
        SET used_count = used_count + 1,
            last_used_at = datetime('now')
      WHERE channel = ? AND entity = ? AND situation = ?`
  ).run(channel, entity, situation);
}

module.exports = { openDb, pickCombo, insertVideo, markComboUsed };
