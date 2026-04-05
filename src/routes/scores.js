// src/routes/scores.js
// Frontend gönderir: {patient_id, scale, total_score, answers}
// Frontend okur: s.total_score
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');

router.use(auth);

function fmt(s) {
  return {
    id:          s.id,
    patient_id:  s.patient_id,
    scale:       s.scale,
    total_score: s.score,   // frontend total_score bekler
    answers:     s.answers,
    date:        s.date,
    created_at:  s.created_at,
  };
}

// GET /api/scores?patient_id=xxx&scale=PHQ9
router.get('/', async (req, res) => {
  try {
    const { patient_id, scale } = req.query;
    if (!patient_id) return res.status(400).json({ error: 'patient_id zorunludur.' });
    const owns = await db.oneOrNone('SELECT id FROM patients WHERE id=$1 AND user_id=$2', [patient_id, req.user.id]);
    if (!owns) return res.status(403).json({ error: 'Erisim reddedildi.' });
    let sql = 'SELECT * FROM scores WHERE patient_id=$1';
    const params = [patient_id];
    if (scale) { sql += ' AND scale=$2'; params.push(scale); }
    sql += ' ORDER BY date ASC, created_at ASC';
    const rows = await db.any(sql, params);
    res.json(rows.map(fmt));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/scores
// frontend: {patient_id, scale, total_score, answers}
router.post('/', async (req, res) => {
  try {
    const { patient_id, scale, total_score, answers } = req.body;
    if (!patient_id || !scale || total_score == null)
      return res.status(400).json({ error: 'Hasta, olcek ve toplam puan zorunludur.' });

    const p = await db.oneOrNone(
      'SELECT first_name, last_name FROM patients WHERE id=$1 AND user_id=$2',
      [patient_id, req.user.id]
    );
    if (!p) return res.status(403).json({ error: 'Erisim reddedildi.' });

    const id = uuid();
    await db.none(
      'INSERT INTO scores (id,user_id,patient_id,scale,score,answers,date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, req.user.id, patient_id, scale, total_score,
       typeof answers === 'string' ? answers : JSON.stringify(answers||[]),
       new Date().toISOString().slice(0,10)]
    );

    await _audit(req.user.id, `OLCEK — ${p.first_name} ${p.last_name} ${scale}=${total_score}`, req);
    const s = await db.oneOrNone('SELECT * FROM scores WHERE id=$1', [id]);
    res.status(201).json(fmt(s));
  } catch (e) { console.error('[Scores] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/scores/:id
router.delete('/:id', async (req, res) => {
  try {
    const s = await db.oneOrNone('SELECT id FROM scores WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!s) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none('DELETE FROM scores WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
