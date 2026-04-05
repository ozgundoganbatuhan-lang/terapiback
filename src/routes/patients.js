// src/routes/patients.js
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');

router.use(auth);

const COLORS = ['#7C6FAE','#3D8C82','#B85C6E','#C4853A','#4A7FA5','#6B8E5A','#7A5C8E'];

// DB satırını frontend formatına normalize et
function fmt(p) {
  if (!p) return null;
  return {
    id:               p.id,
    fn:               p.first_name,
    ln:               p.last_name,
    dob:              p.dob,
    gender:           p.gender,
    phone:            p.phone,
    email:            p.email,
    complaint:        p.complaint,
    therapy_type:     p.therapy,
    price:            p.price || 0,
    emergency_contact: p.emergency,
    color:            p.color,
    session_count:    p.total_sessions || 0,
    last_phq9:        p.last_phq9 ?? null,
    last_gad7:        p.last_gad7 ?? null,
    pkg_total:        p.pkg_total ?? null,
    pkg_used:         p.pkg_used ?? null,
    created_at:       p.created_at,
  };
}

// GET /api/patients
router.get('/', async (req, res) => {
  try {
    const rows = await db.any(`
      SELECT p.*,
        (SELECT score FROM scores WHERE patient_id=p.id AND scale='PHQ9' ORDER BY date DESC LIMIT 1) last_phq9,
        (SELECT score FROM scores WHERE patient_id=p.id AND scale='GAD7'  ORDER BY date DESC LIMIT 1) last_gad7,
        (SELECT sessions FROM packages WHERE patient_id=p.id ORDER BY created_at DESC LIMIT 1) pkg_total,
        (SELECT used     FROM packages WHERE patient_id=p.id ORDER BY created_at DESC LIMIT 1) pkg_used,
        (SELECT COUNT(*) FROM appointments WHERE patient_id=p.id AND status='COMPLETED') total_sessions
      FROM patients p WHERE p.user_id=$1
      ORDER BY p.first_name ASC
    `, [req.user.id]);
    res.json(rows.map(fmt));
  } catch (e) { console.error('[Patients] GET /:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/patients/:id
router.get('/:id', async (req, res) => {
  try {
    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p) return res.status(404).json({ error: 'Hasta bulunamadi.' });
    res.json(fmt(p));
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/patients  — frontend: {fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact}
router.post('/', async (req, res) => {
  try {
    const { fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact } = req.body;
    if (!fn?.trim() || !ln?.trim()) return res.status(400).json({ error: 'Ad ve soyad zorunludur.' });

    const cntRow = await db.one('SELECT COUNT(*) c FROM patients WHERE user_id=$1', [req.user.id]);
    const cnt    = parseInt(cntRow.c);
    const color  = COLORS[cnt % COLORS.length];
    const id     = uuid();

    await db.none(
      `INSERT INTO patients (id,user_id,first_name,last_name,dob,gender,phone,email,complaint,therapy,price,emergency,color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, req.user.id, fn.trim(), ln.trim(), dob||null, gender||null,
       phone||null, email||null, complaint||null,
       therapy_type||'BDT', parseFloat(price)||0, emergency_contact||null, color]
    );

    await _audit(req.user.id, `YENI HASTA — ${fn} ${ln}`, req);
    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1', [id]);
    res.status(201).json(fmt(p));
  } catch (e) { console.error('[Patients] POST:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// PUT /api/patients/:id
router.put('/:id', async (req, res) => {
  try {
    const existing = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Bulunamadi.' });

    const { fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact } = req.body;
    await db.none(
      `UPDATE patients SET
        first_name = COALESCE($1, first_name),
        last_name  = COALESCE($2, last_name),
        dob        = $3,
        gender     = COALESCE($4, gender),
        phone      = $5,
        email      = $6,
        complaint  = $7,
        therapy    = COALESCE($8, therapy),
        price      = COALESCE($9, price),
        emergency  = $10,
        updated_at = NOW()
       WHERE id=$11 AND user_id=$12`,
      [fn||null, ln||null, dob||null, gender||null, phone||null, email||null,
       complaint||null, therapy_type||null, parseFloat(price)||null,
       emergency_contact||null, req.params.id, req.user.id]
    );

    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1', [req.params.id]);
    res.json(fmt(p));
  } catch (e) { console.error('[Patients] PUT:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/patients/:id
router.delete('/:id', async (req, res) => {
  try {
    const p = await db.oneOrNone(
      'SELECT first_name, last_name FROM patients WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!p) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none('DELETE FROM patients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    await _audit(req.user.id, `HASTA SILINDI — ${p.first_name} ${p.last_name}`, req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/patients/:id/anonymize  (KVKK Madde 11)
router.post('/:id/anonymize', async (req, res) => {
  try {
    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p) return res.status(404).json({ error: 'Bulunamadi.' });
    await db.none(
      `UPDATE patients SET
        first_name = 'ANONIM', last_name = 'VERI-SILINDI',
        phone = NULL, email = NULL, emergency = NULL, dob = NULL,
        complaint = '[KVKK kapsaminda anonimlestirildi]',
        updated_at = NOW()
       WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    await _audit(req.user.id, `KVKK ANONIMLESTIRILDI — ${p.first_name} ${p.last_name}`, req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/patients/:id/export  (KVKK Madde 11)
router.get('/:id/export', async (req, res) => {
  try {
    const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!p) return res.status(404).json({ error: 'Bulunamadi.' });
    const notes  = await db.any('SELECT session_no, date, duration FROM session_notes WHERE patient_id=$1 ORDER BY date DESC', [req.params.id]);
    const scores = await db.any('SELECT scale, score, date FROM scores WHERE patient_id=$1 ORDER BY date DESC', [req.params.id]);
    const apts   = await db.any('SELECT at_time, therapy, duration, status FROM appointments WHERE patient_id=$1 ORDER BY at_time DESC', [req.params.id]);
    await _audit(req.user.id, `KVKK VERI IHRACI — ${p.first_name} ${p.last_name}`, req);
    res.json({
      exportedAt: new Date().toISOString(),
      regulation: 'KVKK 6698 Sayili Kanun Madde 11',
      patient: fmt(p),
      notes: notes.map(n => ({ ...n, content: '[SIFRELI — psikolog erisimi gerektirir]' })),
      scores, appointments: apts,
    });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
