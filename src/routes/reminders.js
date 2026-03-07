// src/routes/reminders.js
const router = require('express').Router();
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { sendAppointmentReminder } = require('../services/reminderService');

// POST /api/reminders/appointment/:id  — anında hatırlatıcı gönder
router.post('/appointment/:id', auth, async (req, res) => {
  const apt = db.prepare(`
    SELECT a.*, p.first_name, p.last_name, p.email, p.phone,
           u.name, u.clinic_name, u.clinic_addr, u.clinic_phone
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN users   u ON u.id = a.user_id
    WHERE a.id = ? AND a.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!apt) return res.status(404).json({ error: 'Randevu bulunamadı.' });
  if (!apt.email) return res.status(400).json({ error: 'Hasta e-posta adresi kayıtlı değil.' });

  const result = await sendAppointmentReminder(
    apt,
    { first_name: apt.first_name, last_name: apt.last_name, email: apt.email },
    { name: apt.name, clinic_name: apt.clinic_name, clinic_addr: apt.clinic_addr },
  );

  if (!result.ok) return res.status(500).json({ error: result.reason || 'E-posta gönderilemedi.' });
  res.json({ ok: true, message: 'Hatırlatıcı gönderildi.' });
});

// POST /api/reminders/bulk  — {appointment_ids:[...]} — toplu hatırlatıcı
router.post('/bulk', auth, async (req, res) => {
  const ids = req.body.appointment_ids;
  if (!ids || !ids.length) return res.status(400).json({ error: 'appointment_ids boş.' });

  const results = [];
  for (const id of ids.slice(0, 20)) { // Max 20
    const apt = db.prepare(`
      SELECT a.*, p.first_name, p.last_name, p.email,
             u.name, u.clinic_name, u.clinic_addr
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN users   u ON u.id = a.user_id
      WHERE a.id = ? AND a.user_id = ?
    `).get(id, req.user.id);

    if (!apt || !apt.email) {
      results.push({ id, ok: false, reason: apt ? 'E-posta yok' : 'Bulunamadı' });
      continue;
    }
    const r = await sendAppointmentReminder(
      apt,
      { first_name: apt.first_name, last_name: apt.last_name, email: apt.email },
      { name: apt.name, clinic_name: apt.clinic_name, clinic_addr: apt.clinic_addr },
    );
    results.push({ id, ...r });
  }
  res.json({ results, sent: results.filter(r => r.ok).length });
});

module.exports = router;
