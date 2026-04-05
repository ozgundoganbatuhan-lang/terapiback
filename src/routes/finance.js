// src/routes/finance.js — Gelişmiş finans özet endpoint'i
const router  = require('express').Router();
const db      = require('../db/database');
const auth    = require('../middleware/auth');

// GET /api/finance/summary?year=2025
router.get('/summary', auth, async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    // Aylık gelir (son 12 ay)
    const monthly = await db.any(`
      SELECT TO_CHAR(date::date, 'YYYY-MM') AS month,
             COUNT(*)                        AS count,
             SUM(amount)                     AS revenue,
             SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paid,
             SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END) AS pending
      FROM invoices
      WHERE user_id=$1
        AND date::date >= DATE_TRUNC('month', NOW() - INTERVAL '11 months')
      GROUP BY month ORDER BY month
    `, [req.user.id]);

    // Bu yıl toplam
    const yearStats = await db.one(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(amount), 0) AS revenue,
             COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END), 0) AS paid,
             COALESCE(SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END), 0) AS pending
      FROM invoices WHERE user_id=$1 AND EXTRACT(YEAR FROM date::date) = $2
    `, [req.user.id, String(year)]);

    // Bu ay
    const thisMonth = await db.one(`
      SELECT COUNT(*) AS count,
             COALESCE(SUM(amount), 0) AS revenue,
             COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END), 0) AS paid,
             COALESCE(SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END), 0) AS pending
      FROM invoices
      WHERE user_id=$1
        AND TO_CHAR(date::date, 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')
    `, [req.user.id]);

    // Geçen ay
    const lastMonth = await db.one(`
      SELECT COALESCE(SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END), 0) AS paid
      FROM invoices
      WHERE user_id=$1
        AND TO_CHAR(date::date, 'YYYY-MM') = TO_CHAR(NOW() - INTERVAL '1 month', 'YYYY-MM')
    `, [req.user.id]);

    // Hasta başına gelir (ilk 10)
    const byPatient = await db.any(`
      SELECT p.first_name || ' ' || p.last_name AS name,
             COUNT(i.id) AS count,
             SUM(i.amount) AS total,
             SUM(CASE WHEN i.status='PAID' THEN i.amount ELSE 0 END) AS paid
      FROM invoices i
      JOIN patients p ON p.id=i.patient_id
      WHERE i.user_id=$1 AND EXTRACT(YEAR FROM i.date::date) = $2
      GROUP BY i.patient_id, p.first_name, p.last_name ORDER BY total DESC LIMIT 10
    `, [req.user.id, String(year)]);

    // Bekleyen faturalar (detay)
    const pending = await db.any(`
      SELECT i.id, i.number, i.amount, i.date, i.note,
             p.first_name || ' ' || p.last_name AS patient_name,
             p.email AS patient_email, p.phone AS patient_phone
      FROM invoices i JOIN patients p ON p.id=i.patient_id
      WHERE i.user_id=$1 AND i.status!='PAID'
      ORDER BY i.date DESC LIMIT 20
    `, [req.user.id]);

    const growth = lastMonth?.paid > 0
      ? Math.round(((thisMonth?.paid||0) - lastMonth.paid) / lastMonth.paid * 100)
      : null;

    res.json({ monthly, yearStats, thisMonth, lastMonth, byPatient, pending, growth });
  } catch (e) { console.error('[Finance] summary:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
