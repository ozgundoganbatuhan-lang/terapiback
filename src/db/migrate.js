require('dotenv').config();
const db = require('./database');

// Mevcut tabloya sözleşme kabul kolonları ekle
const migrations = [
  `ALTER TABLE users ADD COLUMN terms_accepted_at TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN terms_version TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN kvkk_accepted_at TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN ip_at_acceptance TEXT DEFAULT NULL`,
];

migrations.forEach(sql => {
  try { db.prepare(sql).run(); console.log('✅', sql.slice(0,60)); }
  catch(e) { if (!e.message.includes('duplicate column')) console.error('⚠️', e.message); }
});

console.log('Migration tamamlandı.');

// E-posta şifre sıfırlama kolonları
try {
  db.exec(`ALTER TABLE users ADD COLUMN reset_token TEXT DEFAULT NULL`);
  db.exec(`ALTER TABLE users ADD COLUMN reset_token_expires TEXT DEFAULT NULL`);
  console.log('✅ reset_token kolonları eklendi');
} catch(e) { /* zaten var */ }
