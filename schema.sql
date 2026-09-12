-- D1 schema for yunzhongge-forms
-- Run locally:  npx wrangler d1 execute yunzhongge-forms --local --file=./schema.sql
-- Run remote:    npx wrangler d1 execute yunzhongge-forms --file=./schema.sql

DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS forms;

CREATE TABLE forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  kv_image_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  id_card TEXT NOT NULL,
  bank_card TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  id_front_key TEXT,
  id_back_key TEXT,
  cert_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_submissions_form_id ON submissions(form_id);
