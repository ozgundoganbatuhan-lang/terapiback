// src/routes/packages.js
// Frontend gönderir: {patient_id, name, sessions_total, price}
// Frontend okur: p.sessions_total, p.used
// Frontend çağırır: PUT /packages/:id/use
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');

router.use(auth);

function fmt(pk) {
  return {
    id:             pk.id,
    patient_id:     pk.patient_id,
    name:           pk.name || `${pk.sessions} Seans Paketi`,
    sessions_total: pk.sessions,   // frontend sessions_total bekler
    used:           pk.used || 0,
    remaining:      (pk.sessions || 0) - (pk.used || 0),
    price:          pk.price || 0,
    start_date:     pk.start_date,
    payment_note:   pk.payment_note,
    // JOIN'den
    fn:             pk.first_name,
    ln:             pk.last_name,
    color:          pk.color,
    created_at:     pk.created_at,
  };
}

// GET /api/packages
router.get('/', async (req, res) => {
  try {
    const rows = await db.any(`
      SELECT pk.*, p.first_name, p.last_name, p.color
      FROM packages pk JOIN patients p ON p.id=pk.patient_id
      WHERE pk.user_id=$1 ORDER BY pk.created_at DESC
    `, [req.user.id]);
    res.json(rows.map(fmt));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/packages
// frontend: {patient_id, name, sessions_total, price}
router.post('/', async (req, res) => {
  try {
    const { patient_id, name, sessions_total, price } = req.body;
    if (!patient_id || !sessions_total)
      return res.status(400).json({ error: 'Hasta ve seans sayisi zorunludur.' });

    const p = await db.oneOrNone(
      'SELECT first_name, last_name FROM patients WHERE id=$1 AND user_id=$2',
      [patient_id, req.user.id]
    );
    if (!p) return res.status(403).json({ error: 'Hasta bulunamadi.' });

    const id = uuid();
    await db.none(
      `INSERT INTO packages (id,user_id,patient_id,name,sessions,used,price,start_date,payment_note)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
      [id, req.user.id, patient_id,
       name || `${sessions_total} Seans Paketi`,
       parseInt(sessions_total),
       parseFloat(price) || 0,
       new Date().toISOString().slice(0,10), '']
    );

    await _audit(req.user.id, `PAKET OLUSTURULDU — ${p.first_name} ${p.last_name} ${sessions_total} Seans`, req);
    const pk = await db.oneOrNone(
      `SELECT pk.*, p.first_name, p.last_name, p.color FROM packages pk
       JOIN patients p ON p.id=pk.patient_id WHERE pk.id=$1`,
      [id]
    );
    res.status(201).json(fmt(pk));
  } catch (e) { console.error('[Packages] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// PUT /api/packages/:id/use  — seans kullan (+1)
router.put('/:id/use', async (req, res) => {
  try {
    const pk = await db.oneOrNone('SELECT * FROM packages WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!pk) return res.status(404).json({ error: 'Paket bulunamadi.' });
    if (pk.used >= pk.sessions) return res.status(400).json({ error: 'Paketin tum seansları kullanildi.' });
    await db.none('UPDATE packages SET used=used+1, updated_at=NOW() WHERE id=$1', [req.params.id]);
    const updated = await db.oneOrNone(
      `SELECT pk.*, p.first_name, p.last_name, p.color FROM packages pk
       JOIN patients p ON p.id=pk.patient_id WHERE pk.id=$1`,
      [req.params.id]
    );
    res.json(fmt(updated));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/packages/:id
router.delete('/:id', async (req, res) => {
  try {
    const pk = await db.oneOrNone('SELECT id FROM packages WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!pk) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none('DELETE FROM packages WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
