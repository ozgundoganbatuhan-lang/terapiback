// src/routes/settings.js
// Dashboard: frontend okur: dash.totalPatients, dash.todayCount, dash.monthSessions, dash.riskPatients, dash.monthRevenue
const router = require('express').Router();
const db     = require('../db/database');
const auth   = require('../middleware/auth');
const { _audit, _safeUser } = require('./auth');

router.use(auth);

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const u = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json(_safeUser(u));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// PUT /api/settings
router.put('/', async (req, res) => {
  try {
    const { name, clinicName, clinicAddr, clinicPhone, therapies, prices } = req.body;
    await db.none(
      `UPDATE users SET
        name         = COALESCE($1, name),
        clinic_name  = COALESCE($2, clinic_name),
        clinic_addr  = COALESCE($3, clinic_addr),
        clinic_phone = COALESCE($4, clinic_phone),
        therapies    = COALESCE($5, therapies),
        prices       = COALESCE($6, prices),
        updated_at   = NOW()
       WHERE id=$7`,
      [
        name||null, clinicName||null, clinicAddr||null, clinicPhone||null,
        therapies ? JSON.stringify(therapies) : null,
        prices    ? JSON.stringify(prices)    : null,
        req.user.id
      ]
    );
    await _audit(req.user.id, 'AYARLAR GUNCELLENDI', req);
    const u = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json(_safeUser(u));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/settings/audit  — KVKK denetim izi
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const logs  = await db.any(
      'SELECT action, created_at, ip FROM audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [req.user.id, limit]
    );
    res.json(logs);
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/settings/dashboard
// frontend okur: totalPatients, todayCount, monthSessions, monthRevenue, riskPatients, trend, thyDist
router.get('/dashboard', async (req, res) => {
  try {
    const uid   = req.user.id;
    const today = new Date().toISOString().slice(0,10);
    const month = today.slice(0,7);

    const totalPatientsRow = await db.one(
      'SELECT COUNT(*) v FROM patients WHERE user_id=$1', [uid]
    );
    const todayCountRow = await db.one(
      'SELECT COUNT(*) v FROM appointments WHERE user_id=$1 AND at_time::date = $2',
      [uid, today]
    );
    const monthSessionsRow = await db.one(
      `SELECT COUNT(*) v FROM appointments WHERE user_id=$1 AND lower(status)='completed' AND at_time LIKE $2`,
      [uid, month+'%']
    );
    const monthRevenueRow = await db.one(
      `SELECT COALESCE(SUM(amount), 0) v FROM invoices WHERE user_id=$1 AND lower(status)='paid' AND date LIKE $2`,
      [uid, month+'%']
    );

    // PHQ9 >= 15 → yüksek risk
    const riskPatients = await db.any(`
      SELECT p.id, p.first_name fn, p.last_name ln, s.score last_phq9
      FROM patients p
      JOIN scores s ON s.patient_id=p.id AND s.scale='PHQ9'
      WHERE p.user_id=$1
        AND s.created_at = (SELECT MAX(created_at) FROM scores WHERE patient_id=p.id AND scale='PHQ9')
        AND s.score >= 15
      ORDER BY s.score DESC
    `, [uid]);

    // Son 6 aylık tamamlanan seans trendi
    const trend = await db.any(`
      SELECT TO_CHAR(at_time::date, 'YYYY-MM') m, COUNT(*) cnt
      FROM appointments WHERE user_id=$1 AND lower(status)='completed'
      GROUP BY m ORDER BY m DESC LIMIT 6
    `, [uid]);

    // Terapi türü dağılımı
    const thyDist = await db.any(`
      SELECT therapy, COUNT(*) cnt FROM appointments
      WHERE user_id=$1 AND lower(status)='completed'
      GROUP BY therapy ORDER BY cnt DESC
    `, [uid]);

    res.json({
      totalPatients: parseInt(totalPatientsRow.v),
      todayCount:    parseInt(todayCountRow.v),
      monthSessions: parseInt(monthSessionsRow.v),
      monthRevenue:  parseFloat(monthRevenueRow.v),
      riskPatients,
      trend: trend.reverse(),
      thyDist,
    });
  } catch (e) { console.error('[Settings] dashboard:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
