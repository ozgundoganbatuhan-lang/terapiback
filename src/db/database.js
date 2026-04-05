// src/db/database.js
const pgp = require('pg-promise')({});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[DB] FATAL: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const db = pgp(connectionString);

// ── ŞEMA ─────────────────────────────────────────────
async function initSchema() {
  await db.none(`
    CREATE TABLE IF NOT EXISTS users (
      id                   TEXT PRIMARY KEY,
      email                TEXT UNIQUE NOT NULL,
      password             TEXT NOT NULL,
      name                 TEXT NOT NULL,
      clinic_name          TEXT DEFAULT '',
      clinic_addr          TEXT DEFAULT '',
      clinic_phone         TEXT DEFAULT '',
      therapies            TEXT DEFAULT '["BDT","PSI","EMDR","SCHEMA","ÇİFT","GRUP","İLK","ONLİNE"]',
      prices               TEXT DEFAULT '{}',
      settings             TEXT DEFAULT '{}',
      gcal_tokens          TEXT DEFAULT NULL,
      gcal_id              TEXT DEFAULT NULL,
      inv_counter          INTEGER DEFAULT 1,
      plan                 TEXT DEFAULT 'trial',
      trial_ends           TEXT DEFAULT NULL,
      trial_warning_sent   INTEGER DEFAULT 0,
      terms_accepted_at    TEXT DEFAULT NULL,
      terms_version        TEXT DEFAULT NULL,
      kvkk_accepted_at     TEXT DEFAULT NULL,
      ip_at_acceptance     TEXT DEFAULT '',
      reset_token          TEXT DEFAULT NULL,
      reset_token_expires  TEXT DEFAULT NULL,
      phone                TEXT DEFAULT '',
      email_verified       INTEGER DEFAULT 0,
      email_verify_token   TEXT DEFAULT NULL,
      email_verify_expires TEXT DEFAULT NULL,
      created_at           TIMESTAMP DEFAULT NOW(),
      updated_at           TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS patients (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      dob         TEXT,
      gender      TEXT DEFAULT 'F',
      phone       TEXT,
      email       TEXT,
      complaint   TEXT,
      therapy     TEXT DEFAULT 'BDT',
      price       REAL DEFAULT 0,
      insurance   TEXT DEFAULT 'none',
      emergency   TEXT,
      color       TEXT DEFAULT '#7C6FAE',
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS appointments (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id         TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      therapy            TEXT DEFAULT 'BDT',
      at_time            TEXT NOT NULL,
      duration           INTEGER DEFAULT 50,
      status             TEXT DEFAULT 'SCHEDULED',
      medium             TEXT DEFAULT 'face',
      note               TEXT DEFAULT '',
      gcal_event_id      TEXT DEFAULT NULL,
      email_reminder     INTEGER DEFAULT 0,
      email_reminder_min INTEGER DEFAULT 1440,
      sms_reminder       INTEGER DEFAULT 0,
      sms_reminder_min   INTEGER DEFAULT 120,
      created_at         TIMESTAMP DEFAULT NOW(),
      updated_at         TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS session_notes (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      session_no  INTEGER NOT NULL,
      date        TEXT NOT NULL,
      therapy     TEXT DEFAULT 'BDT',
      content_enc TEXT NOT NULL,
      mood        TEXT DEFAULT 'neutral',
      homework    TEXT DEFAULT '',
      duration    INTEGER DEFAULT 50,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS scores (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      scale       TEXT NOT NULL,
      score       INTEGER NOT NULL,
      answers     TEXT DEFAULT '[]',
      date        TEXT NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS packages (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id   TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      name         TEXT DEFAULT '',
      sessions     INTEGER NOT NULL,
      used         INTEGER DEFAULT 0,
      price        REAL DEFAULT 0,
      start_date   TEXT,
      payment_note TEXT DEFAULT '',
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS invoices (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      number      TEXT NOT NULL,
      service     TEXT DEFAULT 'Terapi Seansı',
      amount      REAL NOT NULL,
      tax_rate    REAL DEFAULT 0,
      method      TEXT DEFAULT 'cash',
      status      TEXT DEFAULT 'PAID',
      date        TEXT NOT NULL,
      note        TEXT DEFAULT '',
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  await db.none(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action      TEXT NOT NULL,
      ip          TEXT DEFAULT '',
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);

  // Indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_pat_user   ON patients(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_apt_user   ON appointments(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_apt_time   ON appointments(at_time)',
    'CREATE INDEX IF NOT EXISTS idx_apt_pat    ON appointments(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_notes_pat  ON session_notes(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_scores_pat ON scores(patient_id)',
    'CREATE INDEX IF NOT EXISTS idx_inv_user   ON invoices(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)',
  ];
  for (const sql of indexes) {
    await db.none(sql).catch(() => {});
  }

  // Mevcut kullanıcıları doğrulanmış say (geriye dönük uyumluluk)
  await db.none(`
    UPDATE users SET email_verified = 1
    WHERE email_verified = 0 AND created_at < NOW() - INTERVAL '1 second'
  `).catch(() => {});

  console.log('[DB] Schema initialized.');
}

// Run schema init on startup (non-blocking — errors are logged, not fatal)
initSchema().catch(e => console.error('[DB] Schema init error:', e.message));

module.exports = db;
