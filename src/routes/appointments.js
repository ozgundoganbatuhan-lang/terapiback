// src/routes/appointments.js
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');
const { syncToGcal, deleteFromGcal } = require('../services/googleCalendar');

router.use(auth);

// Frontend'den gelen appointment satırını normalize et
function fmt(a) {
  if (!a) return null;
  return {
    id:           a.id,
    patient_id:   a.patient_id,
    at_time:      a.at_time,
    duration:     a.duration,
    therapy_type: a.therapy,
    status:       (a.status||'scheduled').toLowerCase(),
    medium:       a.medium,
    notes:        a.note,
    gcal_synced:  !!a.gcal_event_id,
    // JOIN'den gelen hasta bilgileri
    fn:           a.first_name,
    ln:           a.last_name,
    color:        a.color,
    created_at:   a.created_at,
  };
}

// GET /api/appointments
router.get('/', async (req, res) => {
  try {
    const { date, status, patient_id, from, to } = req.query;
    let sql = `SELECT a.*, p.first_name, p.last_name, p.color
      FROM appointments a JOIN patients p ON p.id=a.patient_id
      WHERE a.user_id=$1`;
    const params = [req.user.id];
    let idx = 2;
    if (date)       { sql += ` AND a.at_time::date = $${idx++}`; params.push(date); }
    if (status)     { sql += ` AND lower(a.status) = $${idx++}`; params.push(status.toLowerCase()); }
    if (patient_id) { sql += ` AND a.patient_id = $${idx++}`; params.push(patient_id); }
    if (from)       { sql += ` AND a.at_time >= $${idx++}`; params.push(from); }
    if (to)         { sql += ` AND a.at_time <= $${idx++}`; params.push(to); }
    sql += ' ORDER BY a.at_time DESC';
    const rows = await db.any(sql, params);
    res.json(rows.map(fmt));
  } catch (e) { console.error('[Appointments] GET /:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/appointments/today  — dashboard için
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const rows = await db.any(`
      SELECT a.*, p.first_name, p.last_name, p.color
      FROM appointments a JOIN patients p ON p.id=a.patient_id
      WHERE a.user_id=$1 AND a.at_time::date = $2
      ORDER BY a.at_time ASC
    `, [req.user.id, today]);
    res.json(rows.map(fmt));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/appointments
// frontend: {patient_id, at_time, duration, therapy_type, notes}
router.post('/', async (req, res) => {
  try {
    const { patient_id, at_time, duration, therapy_type, notes } = req.body;
    if (!patient_id || !at_time)
      return res.status(400).json({ error: 'Hasta ve randevu saati zorunludur.' });

    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [patient_id, req.user.id]);
    if (!p) return res.status(403).json({ error: 'Hasta bulunamadi.' });

    const id = uuid();
    await db.none(
      `INSERT INTO appointments (id,user_id,patient_id,therapy,at_time,duration,status,medium,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.user.id, patient_id, therapy_type||p.therapy||'BDT',
       at_time, duration||50, 'SCHEDULED', 'face', notes||'']
    );

    // Google Calendar senkronizasyonu
    const user = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (user.gcal_tokens) {
      try {
        const evt = await syncToGcal(user, {
          id, patientName: `${p.first_name} ${p.last_name}`,
          therapy: therapy_type||'BDT', atTime: at_time,
          duration: duration||50, medium: 'face', note: notes||''
        });
        if (evt?.id) await db.none('UPDATE appointments SET gcal_event_id=$1 WHERE id=$2', [evt.id, id]);
      } catch(e) { console.error('GCal sync:', e.message); }
    }

    await _audit(req.user.id, `RANDEVU OLUSTURULDU — ${p.first_name} ${p.last_name} ${at_time.slice(0,16)}`, req);
    const apt = await db.oneOrNone(
      `SELECT a.*, p.first_name, p.last_name, p.color FROM appointments a
       JOIN patients p ON p.id=a.patient_id WHERE a.id=$1`,
      [id]
    );
    res.status(201).json(fmt(apt));
  } catch (e) { console.error('[Appointments] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// PUT /api/appointments/:id
// frontend: {at_time, duration, therapy_type, notes, status}
router.put('/:id', async (req, res) => {
  try {
    const a = await db.oneOrNone('SELECT * FROM appointments WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!a) return res.status(404).json({ error: 'Randevu bulunamadi.' });

    const { at_time, duration, therapy_type, notes, status } = req.body;
    // status: frontend 'completed'/'scheduled'/'cancelled' → DB uppercase
    const dbStatus = status ? status.toUpperCase() : a.status;

    await db.none(
      `UPDATE appointments SET
        at_time   = COALESCE($1, at_time),
        duration  = COALESCE($2, duration),
        therapy   = COALESCE($3, therapy),
        note      = COALESCE($4, note),
        status    = $5,
        updated_at = NOW()
       WHERE id=$6`,
      [at_time||null, duration||null, therapy_type||null, notes||null, dbStatus, req.params.id]
    );

    // Tamamlandıysa → paket sayacı artır
    if (dbStatus === 'COMPLETED' && a.status !== 'COMPLETED') {
      await db.none(
        `UPDATE packages SET used = LEAST(used+1, sessions), updated_at = NOW()
         WHERE patient_id=$1 AND user_id=$2 AND used < sessions`,
        [a.patient_id, req.user.id]
      );
      await _audit(req.user.id, `SEANS TAMAMLANDI — ${req.params.id}`, req);
    }

    // GCal güncelle
    if (at_time || therapy_type) {
      const user = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
      if (user.gcal_tokens && a.gcal_event_id) {
        const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1', [a.patient_id]);
        try {
          await syncToGcal(user, {
            id: req.params.id, eventId: a.gcal_event_id,
            patientName: `${p.first_name} ${p.last_name}`,
            therapy: therapy_type||a.therapy, atTime: at_time||a.at_time,
            duration: duration||a.duration, medium: a.medium, note: notes||a.note
          });
        } catch(e) { console.error('GCal update:', e.message); }
      }
    }

    const updated = await db.oneOrNone(
      `SELECT a.*, p.first_name, p.last_name, p.color FROM appointments a
       JOIN patients p ON p.id=a.patient_id WHERE a.id=$1`,
      [req.params.id]
    );
    res.json(fmt(updated));
  } catch (e) { console.error('[Appointments] PUT:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  try {
    const a = await db.oneOrNone('SELECT * FROM appointments WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!a) return res.status(404).json({ error: 'Bulunamadi.' });
    if (a.gcal_event_id) {
      const user = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
      if (user.gcal_tokens) { try { await deleteFromGcal(user, a.gcal_event_id); } catch(_) {} }
    }
    await db.none('DELETE FROM appointments WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
