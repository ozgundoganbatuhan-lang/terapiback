// src/routes/notes.js
// Frontend gönderir: {patient_id, content_enc, session_date, therapy_type, mood, homework, duration}
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');

router.use(auth);

function fmt(n) {
  return {
    id:           n.id,
    patient_id:   n.patient_id,
    session_no:   n.session_no,
    session_date: n.date,
    therapy_type: n.therapy,
    content_enc:  n.content_enc,
    mood:         n.mood,
    homework:     n.homework,
    duration:     n.duration,
    created_at:   n.created_at,
  };
}

// GET /api/notes?patient_id=xxx
router.get('/', async (req, res) => {
  try {
    const { patient_id } = req.query;
    if (!patient_id) return res.status(400).json({ error: 'patient_id zorunludur.' });
    const owns = await db.oneOrNone('SELECT id FROM patients WHERE id=$1 AND user_id=$2', [patient_id, req.user.id]);
    if (!owns) return res.status(403).json({ error: 'Erisim reddedildi.' });
    const rows = await db.any('SELECT * FROM session_notes WHERE patient_id=$1 ORDER BY session_no DESC', [patient_id]);
    res.json(rows.map(fmt));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/notes/:id  — tek not detayı
router.get('/:id', async (req, res) => {
  try {
    const n = await db.oneOrNone('SELECT * FROM session_notes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!n) return res.status(404).json({ error: 'Not bulunamadi.' });
    res.json(fmt(n));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/notes
// frontend: {patient_id, content_enc, session_date, therapy_type, mood, homework, duration}
router.post('/', async (req, res) => {
  try {
    const { patient_id, content_enc, session_date, therapy_type, mood, homework, duration } = req.body;
    if (!patient_id || !content_enc)
      return res.status(400).json({ error: 'Hasta ve sifreli icerik zorunludur.' });

    const p = await db.oneOrNone(
      'SELECT first_name, last_name FROM patients WHERE id=$1 AND user_id=$2',
      [patient_id, req.user.id]
    );
    if (!p) return res.status(403).json({ error: 'Erisim reddedildi.' });

    const last = await db.oneOrNone('SELECT MAX(session_no) mx FROM session_notes WHERE patient_id=$1', [patient_id]);
    const sno  = (last?.mx || 0) + 1;
    const id   = uuid();

    await db.none(
      `INSERT INTO session_notes (id,user_id,patient_id,session_no,date,therapy,content_enc,mood,homework,duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, req.user.id, patient_id, sno,
       session_date || new Date().toISOString().slice(0,10),
       therapy_type || 'BDT', content_enc,
       mood || 'neutral', homework || '', duration || 50]
    );

    await _audit(req.user.id, `SEANS NOTU — ${p.first_name} ${p.last_name} Seans #${sno}`, req);
    const n = await db.oneOrNone('SELECT * FROM session_notes WHERE id=$1', [id]);
    res.status(201).json(fmt(n));
  } catch (e) { console.error('[Notes] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  try {
    const n = await db.oneOrNone('SELECT id FROM session_notes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!n) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none('DELETE FROM session_notes WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
