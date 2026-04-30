const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db;

function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || './data/realtourpilot.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(dbPath);
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS editors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      slack_user_id TEXT UNIQUE,
      email         TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      aryeo_order_id    TEXT UNIQUE,
      aryeo_listing_id  TEXT,
      client_name       TEXT,
      client_email      TEXT,
      service_type      TEXT,
      property_address  TEXT,
      scheduled_at      TEXT,
      assigned_editor_id INTEGER REFERENCES editors(id),
      status            TEXT NOT NULL DEFAULT 'new',
      notes             TEXT,
      rejection_reason  TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at      TEXT,
      approved_at       TEXT,
      delivered_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS job_assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id),
      editor_id   INTEGER NOT NULL REFERENCES editors(id),
      assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assignment_cursor (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      editor_idx INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO assignment_cursor (id, editor_idx) VALUES (1, 0);
  `);
}

module.exports = { getDb };
