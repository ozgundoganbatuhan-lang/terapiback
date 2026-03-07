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
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT score FROM scores WHERE patient_id=p.id AND scale='PHQ9' ORDER BY date DESC LIMIT 1) last_phq9,
      (SELECT score FROM scores WHERE patient_id=p.id AND scale='GAD7'  ORDER BY date DESC LIMIT 1) last_gad7,
      (SELECT sessions FROM packages WHERE patient_id=p.id ORDER BY created_at DESC LIMIT 1) pkg_total,
      (SELECT used     FROM packages WHERE patient_id=p.id ORDER BY created_at DESC LIMIT 1) pkg_used,
      (SELECT COUNT(*) FROM appointments WHERE patient_id=p.id AND status='COMPLETED') total_sessions
    FROM patients p WHERE p.user_id=?
    ORDER BY p.first_name ASC
  `).all(req.user.id);
  res.json(rows.map(fmt));
});

// GET /api/patients/:id
router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Hasta bulunamadı.' });
  res.json(fmt(p));
});

// POST /api/patients  — frontend: {fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact}
router.post('/', (req, res) => {
  const { fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact } = req.body;
  if (!fn?.trim() || !ln?.trim()) return res.status(400).json({ error: 'Ad ve soyad zorunludur.' });

  const cnt   = db.prepare('SELECT COUNT(*) c FROM patients WHERE user_id=?').get(req.user.id).c;
  const color = COLORS[cnt % COLORS.length];
  const id    = uuid();

  db.prepare(`INSERT INTO patients (id,user_id,first_name,last_name,dob,gender,phone,email,complaint,therapy,price,emergency,color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, fn.trim(), ln.trim(), dob||null, gender||null,
         phone||null, email||null, complaint||null,
         therapy_type||'BDT', parseFloat(price)||0, emergency_contact||null, color);

  _audit(req.user.id, `YENİ HASTA — ${fn} ${ln}`, req);
  res.status(201).json(fmt(db.prepare('SELECT * FROM patients WHERE id=?').get(id)));
});

// PUT /api/patients/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Bulunamadı.' });

  const { fn, ln, dob, gender, phone, email, complaint, therapy_type, price, emergency_contact } = req.body;
  db.prepare(`UPDATE patients SET
    first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name),
    dob=?, gender=COALESCE(?,gender), phone=?, email=?, complaint=?,
    therapy=COALESCE(?,therapy), price=COALESCE(?,price), emergency=?,
    updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(fn||null, ln||null, dob||null, gender||null, phone||null, email||null,
         complaint||null, therapy_type||null, parseFloat(price)||null,
         emergency_contact||null, req.params.id, req.user.id);

  res.json(fmt(db.prepare('SELECT * FROM patients WHERE id=?').get(req.params.id)));
});

// DELETE /api/patients/:id
router.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT first_name,last_name FROM patients WHERE id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Bulunamadı.' });
  db.prepare('DELETE FROM patients WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  _audit(req.user.id, `HASTA SİLİNDİ — ${p.first_name} ${p.last_name}`, req);
  res.json({ ok: true });
});

// POST /api/patients/:id/anonymize  (KVKK Madde 11)
router.post('/:id/anonymize', (req, res) => {
  const p = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Bulunamadı.' });
  db.prepare(`UPDATE patients SET
    first_name='ANONİM', last_name='VERİ-SİLİNDİ',
    phone=NULL, email=NULL, emergency=NULL, dob=NULL,
    complaint='[KVKK kapsamında anonimleştirildi]',
    updated_at=datetime('now') WHERE id=? AND user_id=?`).run(req.params.id, req.user.id);
  _audit(req.user.id, `KVKK ANONİMLEŞTİRME — ${p.first_name} ${p.last_name}`, req);
  res.json({ ok: true });
});

// GET /api/patients/:id/export  (KVKK Madde 11)
router.get('/:id/export', (req, res) => {
  const p = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) return res.status(404).json({ error: 'Bulunamadı.' });
  const notes  = db.prepare('SELECT session_no,date,duration FROM session_notes WHERE patient_id=? ORDER BY date DESC').all(req.params.id);
  const scores = db.prepare('SELECT scale,score,date FROM scores WHERE patient_id=? ORDER BY date DESC').all(req.params.id);
  const apts   = db.prepare('SELECT at_time,therapy,duration,status FROM appointments WHERE patient_id=? ORDER BY at_time DESC').all(req.params.id);
  _audit(req.user.id, `KVKK VERİ İHRACI — ${p.first_name} ${p.last_name}`, req);
  res.json({
    exportedAt: new Date().toISOString(),
    regulation: 'KVKK 6698 Sayılı Kanun Madde 11',
    patient: fmt(p),
    notes: notes.map(n => ({ ...n, content: '[ŞİFRELİ — psikolog erişimi gerektirir]' })),
    scores, appointments: apts,
  });
});

module.exports = router;
