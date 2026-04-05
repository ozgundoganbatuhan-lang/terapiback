// src/routes/ai.js  — Anthropic API proxy (anahtar sunucuda kalır)
const router = require('express').Router();
const fetch  = require('node-fetch');
const db     = require('../db/database');
const auth   = require('../middleware/auth');

router.use(auth);

const MODEL    = 'claude-opus-4-6';
const MAX_TOKENS = 1500;
const SYS_BASE = 'Sen deneyimli bir klinik psikolog asistanisın. Türkçe, profesyonel klinik dil kullan. DSM-5 terminolojisi kullan. Yanitlarin kisa, net ve klinik acidan uygulanabilir olsun.';

// POST /api/ai/complete
router.post('/complete', async (req, res) => {
  const { prompt, systemPrompt, tool } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt gerekli.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI entegrasyonu yapilandirilmamis.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt || SYS_BASE,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return res.status(response.status).json({
        error: err.error?.message || 'AI servisi gecici olarak kullanilamiyor.',
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Araç kullanımını logla
    if (tool) {
      try {
        await db.none('INSERT INTO audit_log (user_id, action) VALUES ($1, $2)', [req.user.id, `AI ARAC — ${tool}`]);
      } catch(_) {}
    }

    res.json({ text, usage: data.usage });
  } catch(e) {
    console.error('AI proxy error:', e);
    res.status(500).json({ error: 'AI servisi su an erisilemez.' });
  }
});

// POST /api/ai/summarize  — Özel: seans özeti (şifreli notu çözmeden özetler)
router.post('/summarize', async (req, res) => {
  const { patientId, noteId } = req.body;
  if (!patientId || !noteId) return res.status(400).json({ error: 'Eksik parametre.' });

  // Hastanın bu kullanıcıya ait olduğunu doğrula
  const note = await db.oneOrNone(`
    SELECT n.*, p.first_name, p.last_name, p.therapy
    FROM session_notes n JOIN patients p ON p.id=n.patient_id
    WHERE n.id=$1 AND n.user_id=$2
  `, [noteId, req.user.id]);
  if (!note) return res.status(403).json({ error: 'Erisim reddedildi.' });

  const { decryptedContent } = req.body;
  if (!decryptedContent) return res.status(400).json({ error: 'Icerik gerekli.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapilandirilmamis.' });

  const prompt = `Hasta: ${note.first_name} ${note.last_name}. Terapi: ${note.therapy}. Seans #${note.session_no}.\n\nSeans icerigi:\n${decryptedContent}\n\nDSM-5 uyumlu SOAP formatinda klinik ozet yaz (S/O/A/P).`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:MODEL, max_tokens:MAX_TOKENS, system:SYS_BASE, messages:[{role:'user',content:prompt}] }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    await db.none('INSERT INTO audit_log (user_id, action) VALUES ($1, $2)', [req.user.id, `AI OZET — Seans #${note.session_no}`]);
    res.json({ text });
  } catch(e) { res.status(500).json({ error: 'AI hatasi.' }); }
});

// POST /api/ai/risk  — Risk değerlendirmesi (hasta verisini sunucu okur)
router.post('/risk', async (req, res) => {
  const { patientId, extra } = req.body;
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli.' });

  const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [patientId, req.user.id]);
  if (!p) return res.status(403).json({ error: 'Erisim reddedildi.' });

  const scores = await db.any('SELECT scale, score, date FROM scores WHERE patient_id=$1 ORDER BY date ASC', [patientId]);
  const phq9   = scores.filter(s=>s.scale==='PHQ9');
  const gad7   = scores.filter(s=>s.scale==='GAD7');
  const noteRow = await db.one('SELECT COUNT(*) cnt FROM session_notes WHERE patient_id=$1', [patientId]);
  const noteCount = parseInt(noteRow.cnt);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapilandirilmamis.' });

  const prompt = `Klinik risk degerlendirmesi yap.\nHasta: ${p.first_name} ${p.last_name}, ${_age(p.dob)} yas, ${p.gender==='F'?'Kadin':'Erkek'}.\nBasvuru: ${p.complaint||'—'}.\nTerapi: ${p.therapy}. Tamamlanan seans: ${noteCount}.\nPHQ-9 (tarihe gore): ${phq9.map(s=>s.date+':'+s.score).join(', ')||'Olcum yok'}.\nGAD-7 (tarihe gore): ${gad7.map(s=>s.date+':'+s.score).join(', ')||'Olcum yok'}.\nEk klinik bilgi: ${extra||'—'}.\n\nSunlari iceren Turkce klinik rapor yaz:\n1. Risk Faktorleri\n2. Koruyucu Faktorler\n3. Klinik Risk Duzeyi (Dusuk/Orta/Yuksek)\n4. Oneriler`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,system:SYS_BASE,messages:[{role:'user',content:prompt}]}),
    });
    const data = await response.json();
    await db.none('INSERT INTO audit_log (user_id, action) VALUES ($1, $2)', [req.user.id, `AI RISK DEGERLENDIRME — ${p.first_name} ${p.last_name}`]);
    res.json({ text: data.content?.[0]?.text || '' });
  } catch(e) { res.status(500).json({ error: 'AI hatasi.' }); }
});

// POST /api/ai/progress  — İlerleme raporu
router.post('/progress', async (req, res) => {
  const { patientId } = req.body;
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli.' });

  const p = await db.oneOrNone('SELECT * FROM patients WHERE id=$1 AND user_id=$2', [patientId, req.user.id]);
  if (!p) return res.status(403).json({ error: 'Erisim reddedildi.' });

  const scores   = await db.any('SELECT scale, score, date FROM scores WHERE patient_id=$1 ORDER BY date ASC', [patientId]);
  const sessRow  = await db.one("SELECT COUNT(*) cnt FROM appointments WHERE patient_id=$1 AND status='COMPLETED'", [patientId]);
  const sessions = parseInt(sessRow.cnt);
  const notes    = await db.any('SELECT session_no, date, mood FROM session_notes WHERE patient_id=$1 ORDER BY session_no ASC', [patientId]);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapilandirilmamis.' });

  const prompt = `Klinik ilerleme raporu olustur.\nHasta: ${p.first_name} ${p.last_name}, ${_age(p.dob)} yas.\nBasvuru: ${p.complaint||'—'} | Terapi: ${p.therapy}.\nTamamlanan seans sayisi: ${sessions}.\nPHQ-9: ${scores.filter(s=>s.scale==='PHQ9').map(s=>s.date+':'+s.score).join(', ')||'Yok'}.\nGAD-7: ${scores.filter(s=>s.scale==='GAD7').map(s=>s.date+':'+s.score).join(', ')||'Yok'}.\nSeans genel durumu: ${notes.map(n=>`#${n.session_no}(${n.mood})`).join(', ')||'Yok'}.\n\nTurkce klinik ilerleme raporu yaz: genel degerlendirme, guclu yonler, zorluklar, skor analizi, oneriler.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,system:SYS_BASE,messages:[{role:'user',content:prompt}]}),
    });
    const data = await response.json();
    res.json({ text: data.content?.[0]?.text || '' });
  } catch(e) { res.status(500).json({ error: 'AI hatasi.' }); }
});

function _age(dob) {
  if (!dob) return '?';
  return Math.floor((Date.now()-new Date(dob))/(365.25*24*3600*1000));
}

module.exports = router;
