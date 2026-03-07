// src/routes/ai.js  — Anthropic API proxy (anahtar sunucuda kalır)
const router = require('express').Router();
const fetch  = require('node-fetch');
const db     = require('../db/database');
const auth   = require('../middleware/auth');

router.use(auth);

const MODEL    = 'claude-opus-4-6';
const MAX_TOKENS = 1500;
const SYS_BASE = 'Sen deneyimli bir klinik psikolog asistanısın. Türkçe, profesyonel klinik dil kullan. DSM-5 terminolojisi kullan. Yanıtların kısa, net ve klinik açıdan uygulanabilir olsun.';

// POST /api/ai/complete
router.post('/complete', async (req, res) => {
  const { prompt, systemPrompt, tool } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt gerekli.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI entegrasyonu yapılandırılmamış.' });

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
        error: err.error?.message || 'AI servisi geçici olarak kullanılamıyor.',
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Araç kullanımını logla
    if (tool) {
      try {
        db.prepare('INSERT INTO audit_log (user_id,action) VALUES (?,?)')
          .run(req.user.id, `AI ARAÇ — ${tool}`);
      } catch(_) {}
    }

    res.json({ text, usage: data.usage });
  } catch(e) {
    console.error('AI proxy error:', e);
    res.status(500).json({ error: 'AI servisi şu an erişilemiyor.' });
  }
});

// POST /api/ai/summarize  — Özel: seans özeti (şifreli notu çözmeden özetler)
router.post('/summarize', async (req, res) => {
  const { patientId, noteId } = req.body;
  if (!patientId || !noteId) return res.status(400).json({ error: 'Eksik parametre.' });

  // Hastanın bu kullanıcıya ait olduğunu doğrula
  const note = db.prepare(`
    SELECT n.*, p.first_name, p.last_name, p.therapy
    FROM session_notes n JOIN patients p ON p.id=n.patient_id
    WHERE n.id=? AND n.user_id=?
  `).get(noteId, req.user.id);
  if (!note) return res.status(403).json({ error: 'Erişim reddedildi.' });

  // Not içeriği frontend'de şifrelendi — burada şifreli gelecek
  // Frontend şifreyi çözüp bu endpoint'e gönderir (cleartext olarak)
  const { decryptedContent } = req.body;
  if (!decryptedContent) return res.status(400).json({ error: 'İçerik gerekli.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapılandırılmamış.' });

  const prompt = `Hasta: ${note.first_name} ${note.last_name}. Terapi: ${note.therapy}. Seans #${note.session_no}.\n\nSeans içeriği:\n${decryptedContent}\n\nDSM-5 uyumlu SOAP formatında klinik özet yaz (S/O/A/P).`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:MODEL, max_tokens:MAX_TOKENS, system:SYS_BASE, messages:[{role:'user',content:prompt}] }),
    });
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    db.prepare('INSERT INTO audit_log (user_id,action) VALUES (?,?)').run(req.user.id, `AI ÖZET — Seans #${note.session_no}`);
    res.json({ text });
  } catch(e) { res.status(500).json({ error: 'AI hatası.' }); }
});

// POST /api/ai/risk  — Risk değerlendirmesi (hasta verisini sunucu okur)
router.post('/risk', async (req, res) => {
  const { patientId, extra } = req.body;
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli.' });

  const p = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?')
    .get(patientId, req.user.id);
  if (!p) return res.status(403).json({ error: 'Erişim reddedildi.' });

  const scores = db.prepare("SELECT scale,score,date FROM scores WHERE patient_id=? ORDER BY date ASC").all(patientId);
  const phq9   = scores.filter(s=>s.scale==='PHQ9');
  const gad7   = scores.filter(s=>s.scale==='GAD7');
  const noteCount = db.prepare('SELECT COUNT(*) cnt FROM session_notes WHERE patient_id=?').get(patientId).cnt;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapılandırılmamış.' });

  const prompt = `Klinik risk değerlendirmesi yap.
Hasta: ${p.first_name} ${p.last_name}, ${_age(p.dob)} yaş, ${p.gender==='F'?'Kadın':'Erkek'}.
Başvuru: ${p.complaint||'—'}.
Terapi: ${p.therapy}. Tamamlanan seans: ${noteCount}.
PHQ-9 (tarihe göre): ${phq9.map(s=>s.date+':'+s.score).join(', ')||'Ölçüm yok'}.
GAD-7 (tarihe göre): ${gad7.map(s=>s.date+':'+s.score).join(', ')||'Ölçüm yok'}.
Ek klinik bilgi: ${extra||'—'}.

Şunları içeren Türkçe klinik rapor yaz:
1. Risk Faktörleri
2. Koruyucu Faktörler
3. Klinik Risk Düzeyi (Düşük/Orta/Yüksek)
4. Öneriler`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,system:SYS_BASE,messages:[{role:'user',content:prompt}]}),
    });
    const data = await response.json();
    db.prepare('INSERT INTO audit_log (user_id,action) VALUES (?,?)').run(req.user.id, `AI RİSK DEĞERLENDİRME — ${p.first_name} ${p.last_name}`);
    res.json({ text: data.content?.[0]?.text || '' });
  } catch(e) { res.status(500).json({ error: 'AI hatası.' }); }
});

// POST /api/ai/progress  — İlerleme raporu
router.post('/progress', async (req, res) => {
  const { patientId } = req.body;
  if (!patientId) return res.status(400).json({ error: 'patientId gerekli.' });

  const p = db.prepare('SELECT * FROM patients WHERE id=? AND user_id=?').get(patientId, req.user.id);
  if (!p) return res.status(403).json({ error: 'Erişim reddedildi.' });

  const scores = db.prepare("SELECT scale,score,date FROM scores WHERE patient_id=? ORDER BY date ASC").all(patientId);
  const sessions = db.prepare("SELECT COUNT(*) cnt FROM appointments WHERE patient_id=? AND status='COMPLETED'").get(patientId).cnt;
  const notes = db.prepare("SELECT session_no, date, mood FROM session_notes WHERE patient_id=? ORDER BY session_no ASC").all(patientId);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'AI yapılandırılmamış.' });

  const prompt = `Klinik ilerleme raporu oluştur.
Hasta: ${p.first_name} ${p.last_name}, ${_age(p.dob)} yaş.
Başvuru: ${p.complaint||'—'} | Terapi: ${p.therapy}.
Tamamlanan seans sayısı: ${sessions}.
PHQ-9: ${scores.filter(s=>s.scale==='PHQ9').map(s=>s.date+':'+s.score).join(', ')||'Yok'}.
GAD-7: ${scores.filter(s=>s.scale==='GAD7').map(s=>s.date+':'+s.score).join(', ')||'Yok'}.
Seans genel durumu: ${notes.map(n=>`#${n.session_no}(${n.mood})`).join(', ')||'Yok'}.

Türkçe klinik ilerleme raporu yaz: genel değerlendirme, güçlü yönler, zorluklar, skor analizi, öneriler.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:MAX_TOKENS,system:SYS_BASE,messages:[{role:'user',content:prompt}]}),
    });
    const data = await response.json();
    res.json({ text: data.content?.[0]?.text || '' });
  } catch(e) { res.status(500).json({ error: 'AI hatası.' }); }
});

function _age(dob) {
  if (!dob) return '?';
  return Math.floor((Date.now()-new Date(dob))/(365.25*24*3600*1000));
}

module.exports = router;
