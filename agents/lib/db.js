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
// v2.7 (Section 00c): supports the multi-shorts data model. `parent_video_id`
// is NULL for a long-form video and points at the parent row for a short cut
// from it; `video_type` is 'long_form' | 'short', defaulting to 'long_form'.
function insertVideo(db, video) {
  const video_type = video.video_type ?? "long_form";
  if (video_type !== "long_form" && video_type !== "short") {
    throw new Error(
      `invalid video_type "${video_type}" - must be 'long_form' or 'short'`
    );
  }

  // New object, never mutate the caller's input.
  const row = {
    ...video,
    parent_video_id: video.parent_video_id ?? null,
    video_type,
  };

  const stmt = db.prepare(
    `INSERT INTO videos (channel, entity, situation, title, status, script_path, manifest_path, parent_video_id, video_type)
     VALUES (@channel, @entity, @situation, @title, 'scripting', @script_path, @manifest_path, @parent_video_id, @video_type)`
  );
  const info = stmt.run(row);
  return info.lastInsertRowid;
}

// Mark a combo as used once a script has been generated for it.
// v2.7: entity_situation_bank has no new columns. Combos are consumed at the
// long-form level only — a short cut from a long-form (video_type = 'short')
// reuses the parent's combo, so this must NOT be called again for the short,
// or used_count would double-count a single piece of source content.
function markComboUsed(db, channel, entity, situation) {
  db.prepare(
    `UPDATE entity_situation_bank
        SET used_count = used_count + 1,
            last_used_at = datetime('now')
      WHERE channel = ? AND entity = ? AND situation = ?`
  ).run(channel, entity, situation);
}

module.exports = { openDb, pickCombo, insertVideo, markComboUsed };
