// src/routes/finance.js — Gelişmiş finans özet endpoint'i
const router  = require('express').Router();
const db      = require('../db/database');
const auth    = require('../middleware/auth');

// GET /api/finance/summary?year=2025
router.get('/summary', auth, (req, res) => {
  const year = req.query.year || new Date().getFullYear();

  // Aylık gelir (son 12 ay)
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) AS month,
           COUNT(*)                AS count,
           SUM(amount)             AS revenue,
           SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paid,
           SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END) AS pending
    FROM invoices
    WHERE user_id=? AND date >= date('now','-11 months','start of month')
    GROUP BY month ORDER BY month
  `).all(req.user.id);

  // Bu yıl toplam
  const yearStats = db.prepare(`
    SELECT COUNT(*) AS count,
           SUM(amount) AS revenue,
           SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paid,
           SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END) AS pending
    FROM invoices WHERE user_id=? AND strftime('%Y',date)=?
  `).get(req.user.id, String(year));

  // Bu ay
  const thisMonth = db.prepare(`
    SELECT COUNT(*) AS count, SUM(amount) AS revenue,
           SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paid,
           SUM(CASE WHEN status!='PAID' THEN amount ELSE 0 END) AS pending
    FROM invoices WHERE user_id=? AND strftime('%Y-%m',date)=strftime('%Y-%m','now')
  `).get(req.user.id);

  // Geçen ay
  const lastMonth = db.prepare(`
    SELECT SUM(CASE WHEN status='PAID' THEN amount ELSE 0 END) AS paid
    FROM invoices WHERE user_id=?
    AND strftime('%Y-%m',date)=strftime('%Y-%m',date('now','-1 month'))
  `).get(req.user.id);

  // Hasta başına gelir (ilk 10)
  const byPatient = db.prepare(`
    SELECT p.first_name||' '||p.last_name AS name,
           COUNT(i.id) AS count,
           SUM(i.amount) AS total,
           SUM(CASE WHEN i.status='PAID' THEN i.amount ELSE 0 END) AS paid
    FROM invoices i
    JOIN patients p ON p.id=i.patient_id
    WHERE i.user_id=? AND strftime('%Y',i.date)=?
    GROUP BY i.patient_id ORDER BY total DESC LIMIT 10
  `).all(req.user.id, String(year));

  // Bekleyen faturalar (detay)
  const pending = db.prepare(`
    SELECT i.id, i.number, i.amount, i.date, i.note,
           p.first_name||' '||p.last_name AS patient_name,
           p.email AS patient_email, p.phone AS patient_phone
    FROM invoices i JOIN patients p ON p.id=i.patient_id
    WHERE i.user_id=? AND i.status!='PAID'
    ORDER BY i.date DESC LIMIT 20
  `).all(req.user.id);

  const growth = lastMonth?.paid > 0
    ? Math.round(((thisMonth?.paid||0) - lastMonth.paid) / lastMonth.paid * 100)
    : null;

  res.json({ monthly, yearStats, thisMonth, lastMonth, byPatient, pending, growth });
});

module.exports = router;
