"use strict";
// Logic tests for flyt-approvals.js against a THROWAWAY copy of tracking.db.
// Never touches the real DB or any live row. Run: node tests/test_approvals.js
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const Database = require(path.join(ROOT, "node_modules", "better-sqlite3"));
const ap = require(path.join(ROOT, "agents", "flyt-approvals.js"));

const REAL = path.join(ROOT, "db", "tracking.db");
const COPY = path.join(os.tmpdir(), `tracking_test_${process.pid}.db`);
fs.copyFileSync(REAL, COPY);
const db = new Database(COPY);
process.on("exit", () => { try { fs.unlinkSync(COPY); } catch (_) {} });

let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log("  PASS", name)) : (fail++, console.log("  FAIL", name)); }

// ---- parseCommand: approve ----
console.log("parseCommand approve:");
ok("bare approve -> scope all", (() => { const c = ap.parseCommand("approve"); return c.action === "approve" && c.scope === "all"; })());
ok("approve all", ap.parseCommand("approve all").scope === "all");
ok("Approve All (case)", ap.parseCommand("Approve All").scope === "all");
ok("approve long", ap.parseCommand("approve long").scope === "long");
ok("approve short_2", (() => { const c = ap.parseCommand("approve short_2"); return c.scope === "short" && c.index === 2; })());
ok("approve short2 (no underscore)", (() => { const c = ap.parseCommand("approve short2"); return c.scope === "short" && c.index === 2; })());
ok("approve garbage -> null", ap.parseCommand("approve maybe") === null);
ok("approve short_0 -> null", ap.parseCommand("approve short_0") === null);
ok("approve extra tokens -> null", ap.parseCommand("approve long now") === null);

// ---- parseCommand: reject ----
console.log("parseCommand reject:");
ok("bare reject -> scope all, placeholder reason", (() => { const c = ap.parseCommand("reject"); return c.scope === "all" && c.reason === "(no reason given)"; })());
ok("reject with reason only", (() => { const c = ap.parseCommand("reject wrong tone"); return c.scope === "all" && c.reason === "wrong tone"; })());
ok("reject long + reason", (() => { const c = ap.parseCommand("reject long bad hook"); return c.scope === "long" && c.reason === "bad hook"; })());
ok("reject short_3 + reason", (() => { const c = ap.parseCommand("reject short_3 cut too fast"); return c.scope === "short" && c.index === 3 && c.reason === "cut too fast"; })());
ok("reject short_1 no reason -> placeholder", (() => { const c = ap.parseCommand("reject short_1"); return c.scope === "short" && c.index === 1 && c.reason === "(no reason given)"; })());
ok("reject all + reason", (() => { const c = ap.parseCommand("reject all nope"); return c.scope === "all" && c.reason === "nope"; })());

// ---- garbage ----
ok("garbage -> null", ap.parseCommand("hey what's up") === null);
ok("empty -> null", ap.parseCommand("") === null);

// ---- seed a bundle: one long-form parent + two shorts ----
const CHAT = "555000";
const insLong = db.prepare(`INSERT INTO videos (channel, entity, situation, title, status, video_type, tg_message_id, tg_chat_id) VALUES ('channel_a','E','s',?, 'pending_approval','long_form', ?, ?)`);
const insShort = db.prepare(`INSERT INTO videos (channel, entity, situation, title, status, video_type, parent_video_id) VALUES ('channel_a','E','s',?, 'pending_approval','short', ?)`);
const longId = insLong.run("Long Title", 900100, CHAT).lastInsertRowid;
const s1 = insShort.run("Short One", longId).lastInsertRowid;
const s2 = insShort.run("Short Two", longId).lastInsertRowid;
const longRow = db.prepare("SELECT * FROM videos WHERE id=?").get(longId);

// ---- resolveBundle ----
console.log("resolveBundle:");
const bundle = ap.resolveBundle(db, longRow);
ok("resolves long", bundle.long.id === longId);
ok("resolves two shorts in order", bundle.shorts.length === 2 && bundle.shorts[0].id === s1 && bundle.shorts[1].id === s2);
ok("resolves from a short up to parent", ap.resolveBundle(db, db.prepare("SELECT * FROM videos WHERE id=?").get(s2)).long.id === longId);

// ---- targetsForCommand ----
console.log("targetsForCommand:");
ok("all -> long + shorts", ap.targetsForCommand({ scope: "all" }, bundle).rows.length === 3);
ok("long -> just long", (() => { const t = ap.targetsForCommand({ scope: "long" }, bundle); return t.rows.length === 1 && t.rows[0].id === longId; })());
ok("short_2 -> the 2nd short", (() => { const t = ap.targetsForCommand({ scope: "short", index: 2 }, bundle); return t.rows[0].id === s2; })());
ok("short_5 -> error (nonexistent)", !!ap.targetsForCommand({ scope: "short", index: 5 }, bundle).error);
ok("short on shorts-less bundle -> error", !!ap.targetsForCommand({ scope: "short", index: 1 }, { long: longRow, shorts: [] }).error);

// ---- applyDecision writes (real writes to the COPY; DRY off, replies stubbed) ----
console.log("applyDecision (writes to copy):");
ap.__setDryRun(false);
const env = { FLYT_BOT_TOKEN: "x", FLYT_CHAT_ID: CHAT };
const msg = { chat: { id: CHAT }, message_id: 1 };
// replyTo hits Telegram; monkeypatch the module's telegramSend via require cache is
// awkward, so instead exercise the DB effect through applyDecision with a msg whose
// send will fail-soft (replyTo swallows network errors). Point token at nothing.
const badEnv = { FLYT_BOT_TOKEN: "0:0", FLYT_CHAT_ID: CHAT };

(async () => {
  // approve short_1 -> only s1 flips
  await ap.applyDecision(badEnv, db, longRow, { action: "approve", scope: "short", index: 1 }, msg);
  ok("approve short_1 flips only s1", db.prepare("SELECT status FROM videos WHERE id=?").get(s1).status === "approved"
     && db.prepare("SELECT status FROM videos WHERE id=?").get(s2).status === "pending_approval"
     && db.prepare("SELECT status FROM videos WHERE id=?").get(longId).status === "pending_approval");

  // approve short_1 again -> nothing left awaiting (no-op, stays approved)
  await ap.applyDecision(badEnv, db, longRow, { action: "approve", scope: "short", index: 1 }, msg);
  ok("re-approve short_1 is a no-op", db.prepare("SELECT status FROM videos WHERE id=?").get(s1).status === "approved");

  // reject long -> only long flips, reason saved
  await ap.applyDecision(badEnv, db, longRow, { action: "reject", scope: "long", index: null, reason: "bad hook" }, msg);
  const lr = db.prepare("SELECT status, reject_reason FROM videos WHERE id=?").get(longId);
  ok("reject long flips only long + reason", lr.status === "rejected" && lr.reject_reason === "bad hook"
     && db.prepare("SELECT status FROM videos WHERE id=?").get(s2).status === "pending_approval");

  // approve all -> only remaining pending (s2) flips; already-decided rows untouched
  await ap.applyDecision(badEnv, db, longRow, { action: "approve", scope: "all", index: null }, msg);
  ok("approve all only touches remaining pending s2", db.prepare("SELECT status FROM videos WHERE id=?").get(s2).status === "approved"
     && db.prepare("SELECT status FROM videos WHERE id=?").get(longId).status === "rejected");

  // approve short_9 on this bundle -> error path, no write/throw
  await ap.applyDecision(badEnv, db, longRow, { action: "approve", scope: "short", index: 9, }, msg);
  ok("approve short_9 is a clean no-op (no throw)", true);

  db.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
