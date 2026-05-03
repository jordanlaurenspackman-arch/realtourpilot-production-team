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

    -- Dropbox file tracking (added in v2)
    CREATE TABLE IF NOT EXISTS job_dropbox (
      job_id      INTEGER PRIMARY KEY REFERENCES jobs(id),
      folder_path TEXT,
      file_count  INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT
    );
  `);

  // Fix existing jobs where property_address was stored as raw JSON
  db.exec(`
    UPDATE jobs
    SET property_address = (
      COALESCE(
        NULLIF(TRIM(
          TRIM(COALESCE(json_extract(property_address, '$.street_number'), '') || ' ' ||
          COALESCE(json_extract(property_address, '$.street_name'), '')) || ', ' ||
          COALESCE(
            json_extract(property_address, '$.unparsed_address_part_two'),
            TRIM(COALESCE(json_extract(property_address, '$.city'), '') || ', ' ||
              COALESCE(json_extract(property_address, '$.state_or_province'), '') || ' ' ||
              COALESCE(json_extract(property_address, '$.postal_code'), ''))
          )
        , ''),
        property_address
      )
    )
    WHERE property_address LIKE '{%';
  `);
}

module.exports = { getDb };
