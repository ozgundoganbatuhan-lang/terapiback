require('dotenv').config();
const db = require('./database');

// This migrate script is kept for manual one-off migrations.
// The main schema is auto-applied by database.js on startup.
// Add any additional ALTER TABLE statements here as needed.

const migrations = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS kvkk_accepted_at TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_at_acceptance TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TEXT DEFAULT NULL`,
];

async function runMigrations() {
  for (const sql of migrations) {
    try {
      await db.none(sql);
      console.log('✅', sql.slice(0, 60));
    } catch (e) {
      console.error('⚠️', e.message);
    }
  }
  console.log('Migration tamamlandı.');
  process.exit(0);
}

runMigrations().catch(e => { console.error(e); process.exit(1); });
