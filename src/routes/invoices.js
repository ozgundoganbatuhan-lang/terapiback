// src/routes/invoices.js
// Frontend gönderir: {patient_id, amount, tax_rate, description, status}
// Frontend okur: inv.patient_id, stats.monthRevenue, stats.monthCount, stats.unpaidCount
// Frontend çağırır: PUT /invoices/:id {status:'paid'}
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');

router.use(auth);

function fmt(inv) {
  return {
    id:           inv.id,
    patient_id:   inv.patient_id,
    number:       inv.number,
    description:  inv.service,   // frontend description okur
    amount:       inv.amount,
    tax_rate:     inv.tax_rate || 0,
    status:       (inv.status||'paid').toLowerCase(),
    date:         inv.date,
    note:         inv.note,
    fn:           inv.first_name,
    ln:           inv.last_name,
    created_at:   inv.created_at,
  };
}

// GET /api/invoices
router.get('/', async (req, res) => {
  try {
    const { from, to, status } = req.query;
    let sql = `SELECT i.*, p.first_name, p.last_name FROM invoices i
      JOIN patients p ON p.id=i.patient_id WHERE i.user_id=$1`;
    const params = [req.user.id];
    let idx = 2;
    if (from)   { sql += ` AND i.date >= $${idx++}`; params.push(from); }
    if (to)     { sql += ` AND i.date <= $${idx++}`; params.push(to); }
    if (status) { sql += ` AND lower(i.status) = $${idx++}`; params.push(status.toLowerCase()); }
    sql += ' ORDER BY i.created_at DESC';
    const rows = await db.any(sql, params);
    res.json(rows.map(fmt));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/invoices/stats  — frontend: stats.monthRevenue / stats.monthCount / stats.unpaidCount
router.get('/stats', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0,7);
    const monthPattern = month + '%';

    const revRow = await db.one(
      `SELECT COALESCE(SUM(amount), 0) v FROM invoices WHERE user_id=$1 AND lower(status)='paid' AND date LIKE $2`,
      [req.user.id, monthPattern]
    );
    const cntRow = await db.one(
      `SELECT COUNT(*) v FROM invoices WHERE user_id=$1 AND date LIKE $2`,
      [req.user.id, monthPattern]
    );
    const unpaidRow = await db.one(
      `SELECT COUNT(*) v FROM invoices WHERE user_id=$1 AND lower(status)='pending'`,
      [req.user.id]
    );

    res.json({
      monthRevenue: parseFloat(revRow.v),
      monthCount:   parseInt(cntRow.v),
      unpaidCount:  parseInt(unpaidRow.v),
      month,
    });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/invoices
// frontend: {patient_id, amount, tax_rate, description, status}
router.post('/', async (req, res) => {
  try {
    const { patient_id, amount, tax_rate, description, status } = req.body;
    if (!patient_id || amount == null)
      return res.status(400).json({ error: 'Hasta ve tutar zorunludur.' });

    const p = await db.oneOrNone(
      'SELECT first_name, last_name FROM patients WHERE id=$1 AND user_id=$2',
      [patient_id, req.user.id]
    );
    if (!p) return res.status(403).json({ error: 'Hasta bulunamadi.' });

    const u   = await db.oneOrNone('SELECT inv_counter FROM users WHERE id=$1', [req.user.id]);
    const num = 'INV-' + String(u.inv_counter || 1).padStart(4, '0');
    await db.none('UPDATE users SET inv_counter=inv_counter+1 WHERE id=$1', [req.user.id]);

    const id = uuid();
    const dbStatus = status ? status.toUpperCase() : 'PAID';
    await db.none(
      `INSERT INTO invoices (id,user_id,patient_id,number,service,amount,tax_rate,method,status,date,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, req.user.id, patient_id, num,
       description || 'Terapi Seansı',
       parseFloat(amount),
       parseFloat(tax_rate) || 0,
       'cash', dbStatus,
       new Date().toISOString().slice(0,10), '']
    );

    await _audit(req.user.id, `FATURA ${num} — ${p.first_name} ${p.last_name} ${amount}`, req);
    const inv = await db.oneOrNone(
      `SELECT i.*, p.first_name, p.last_name FROM invoices i
       JOIN patients p ON p.id=i.patient_id WHERE i.id=$1`,
      [id]
    );
    res.status(201).json(fmt(inv));
  } catch (e) { console.error('[Invoices] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// PUT /api/invoices/:id  — frontend: {status:'paid'} body ile gönderir
router.put('/:id', async (req, res) => {
  try {
    const inv = await db.oneOrNone('SELECT * FROM invoices WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!inv) return res.status(404).json({ error: 'Fatura bulunamadi.' });
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status zorunludur.' });
    await db.none('UPDATE invoices SET status=$1 WHERE id=$2', [status.toUpperCase(), req.params.id]);
    await _audit(req.user.id, `FATURA GUNCELLENDI ${inv.number} → ${status}`, req);
    const updated = await db.oneOrNone(
      `SELECT i.*, p.first_name, p.last_name FROM invoices i
       JOIN patients p ON p.id=i.patient_id WHERE i.id=$1`,
      [req.params.id]
    );
    res.json(fmt(updated));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res) => {
  try {
    const inv = await db.oneOrNone('SELECT id FROM invoices WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!inv) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none('DELETE FROM invoices WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
