// src/routes/auth.js
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuid } = require('uuid');
const db      = require('../db/database');
const auth    = require('../middleware/auth');
const {
  sendWelcome,
  sendPasswordReset,
  sendPasswordChanged,
  sendEmailVerification,
} = require('../services/email');

const ROUNDS        = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const TERMS_VERSION = '1.0';

const sign = (id, email) =>
  jwt.sign({ id, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name, clinicName, phone,
      termsAccepted, kvkkAccepted, aiConsentGiven
    } = req.body;

    if (!email || !password || !name)
      return res.status(400).json({ error: 'E-posta, sifre ve ad zorunludur.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Sifre en az 8 karakter olmali.' });
    if (!termsAccepted)
      return res.status(400).json({ error: 'Kullanici Hizmet Sozlesmesi kabul edilmeden kayit tamamlanamaz.', field: 'termsAccepted' });
    if (!kvkkAccepted)
      return res.status(400).json({ error: 'KVKK Aydinlatma Metni onayi olmadan kayit tamamlanamaz.', field: 'kvkkAccepted' });

    const existing = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing)
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kayitli.' });

    const cleanPhone = (phone || '').replace(/\s/g, '');
    if (cleanPhone && !/^(\+?90|0)?5\d{9}$/.test(cleanPhone))
      return res.status(400).json({ error: 'Gecerli bir Turkiye telefon numarasi girin (05xx xxx xx xx).' });

    const hashed    = await bcrypt.hash(password, ROUNDS);
    const id        = uuid();
    const now       = new Date().toISOString();
    const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const ip        = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const settings  = JSON.stringify({ aiConsentGiven: !!aiConsentGiven, aiConsentAt: now });

    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 3600000).toISOString();

    await db.none(
      `INSERT INTO users
        (id, email, password, name, clinic_name, phone, plan, trial_ends, settings,
         terms_accepted_at, terms_version, kvkk_accepted_at, ip_at_acceptance,
         email_verified, email_verify_token, email_verify_expires)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15)`,
      [
        id, email.toLowerCase(), hashed, name, clinicName || '',
        cleanPhone, 'trial', trialEnds, settings,
        now, TERMS_VERSION, now, ip,
        verifyToken, verifyExpires
      ]
    );

    await _audit(id, `HESAP OLUSTURULDU — ${email} — Sozlesme v${TERMS_VERSION} — IP:${ip}`, req);
    if (aiConsentGiven) await _audit(id, 'AI YURT DISI AKTARIM RIZASI VERILDI', req);

    sendEmailVerification({ name, email, verifyToken }).catch(e =>
      console.error('[Email] Verify:', e.message)
    );

    res.status(201).json({
      needsVerification: true,
      email: email.toLowerCase(),
      message: 'Hesabiniz olusturuldu. Lutfen e-posta adresinizi dogrulayin.'
    });
  } catch (e) {
    console.error('[Auth] Register:', e);
    res.status(500).json({ error: 'Sunucu hatasi.' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token gerekli.' });

    const user = await db.oneOrNone(`
      SELECT * FROM users
      WHERE email_verify_token = $1
        AND email_verify_expires > NOW()
        AND email_verified = 0
    `, [token]);

    if (!user) {
      const expired = await db.oneOrNone(
        'SELECT id FROM users WHERE email_verify_token = $1 AND email_verified = 0',
        [token]
      );
      if (expired)
        return res.status(400).json({
          error: 'Dogrulama baglantisi suresi dolmus. Yeni baglanti isteyin.',
          code: 'TOKEN_EXPIRED'
        });

      const alreadyVerified = await db.oneOrNone(
        'SELECT id FROM users WHERE email_verify_token = $1',
        [token]
      );
      if (!alreadyVerified)
        return res.status(400).json({ error: 'Gecersiz dogrulama baglantisi.', code: 'TOKEN_INVALID' });

      const vUser = await db.oneOrNone('SELECT * FROM users WHERE email_verify_token = $1', [token]);
      if (vUser && vUser.email_verified) {
        await db.none('UPDATE users SET email_verify_token = NULL WHERE id = $1', [vUser.id]);
        const fresh = await db.oneOrNone('SELECT * FROM users WHERE id = $1', [vUser.id]);
        return res.json({ token: sign(vUser.id, vUser.email), user: _safeUser(fresh) });
      }
      return res.status(400).json({ error: 'Gecersiz dogrulama baglantisi.', code: 'TOKEN_INVALID' });
    }

    await db.none(`
      UPDATE users SET
        email_verified = 1,
        email_verify_token = NULL,
        email_verify_expires = NULL,
        updated_at = NOW()
      WHERE id = $1
    `, [user.id]);

    await _audit(user.id, `E-POSTA DOGRULANDI — ${user.email}`, req);

    sendWelcome({ name: user.name, email: user.email, trialEnds: user.trial_ends })
      .catch(e => console.error('[Email] Welcome:', e.message));

    const freshUser = await db.oneOrNone('SELECT * FROM users WHERE id = $1', [user.id]);
    res.json({ token: sign(user.id, user.email), user: _safeUser(freshUser) });
  } catch (e) {
    console.error('[Auth] Verify email:', e);
    res.status(500).json({ error: 'Sunucu hatasi.' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-posta zorunludur.' });

    const user = await db.oneOrNone('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user || user.email_verified)
      return res.json({ message: 'Dogrulama e-postasi gonderildi.' });

    const verifyToken   = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 3600000).toISOString();

    await db.none(
      `UPDATE users SET email_verify_token = $1, email_verify_expires = $2, updated_at = NOW() WHERE id = $3`,
      [verifyToken, verifyExpires, user.id]
    );

    await sendEmailVerification({ name: user.name, email: user.email, verifyToken });
    await _audit(user.id, 'DOGRULAMA E-POSTASI YENIDEN GONDERILDI', req);
    res.json({ message: 'Dogrulama e-postasi gonderildi.' });
  } catch (e) {
    console.error('[Auth] Resend verification:', e);
    res.status(500).json({ error: 'Sunucu hatasi.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'E-posta ve sifre gerekli.' });

    const u = await db.oneOrNone('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!u || !(await bcrypt.compare(password, u.password)))
      return res.status(401).json({ error: 'E-posta veya sifre hatali.' });

    if (!u.email_verified)
      return res.status(403).json({
        error: 'E-posta adresiniz henuzdogrulanmamis. Lutfen gelen kutunuzu kontrol edin.',
        code: 'EMAIL_NOT_VERIFIED',
        email: u.email
      });

    if (!u.terms_accepted_at)
      return res.status(403).json({ error: 'Guncellennis sozlesme onayi gerekiyor.', code: 'TERMS_REQUIRED' });

    await _audit(u.id, `GIRIS — ${email}`, req);
    res.json({ token: sign(u.id, u.email), user: _safeUser(u) });
  } catch (e) {
    console.error('[Auth] Login:', e);
    res.status(500).json({ error: 'Sunucu hatasi.' });
  }
});

// POST /api/auth/accept-terms
router.post('/accept-terms', auth, async (req, res) => {
  try {
    const { termsAccepted, kvkkAccepted, aiConsentGiven } = req.body;
    if (!termsAccepted || !kvkkAccepted)
      return res.status(400).json({ error: 'Tum zorunlu sozlesmeler kabul edilmeli.' });

    const now = new Date().toISOString();
    const ip  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';

    await db.none(
      `UPDATE users SET
        terms_accepted_at = $1, terms_version = $2, kvkk_accepted_at = $3,
        ip_at_acceptance = $4, updated_at = NOW()
       WHERE id = $5`,
      [now, TERMS_VERSION, now, ip, req.user.id]
    );
    await db.none(
      'UPDATE users SET settings = $1 WHERE id = $2',
      [JSON.stringify({ aiConsentGiven: !!aiConsentGiven, aiConsentAt: now }), req.user.id]
    );

    await _audit(req.user.id, `SOZLESME GUNCELLENDI v${TERMS_VERSION} — IP:${ip}`, req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
  await _audit(req.user.id, 'CIKIS', req);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const u = await db.oneOrNone('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!u) return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  res.json(_safeUser(u));
});

// PUT /api/auth/password
router.put('/password', auth, async (req, res) => {
  try {
    const { current, next: newPass } = req.body;
    if (!current || !newPass || newPass.length < 8)
      return res.status(400).json({ error: 'Gecersiz sifre. En az 8 karakter olmali.' });
    const u = await db.oneOrNone('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(current, u.password)))
      return res.status(401).json({ error: 'Mevcut sifre yanlis.' });
    await db.none(
      'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2',
      [await bcrypt.hash(newPass, ROUNDS), req.user.id]
    );
    await _audit(req.user.id, 'SIFRE DEGISTIRILDI', req);
    sendPasswordChanged({ name: u.name, email: u.email }).catch(e => console.error('[Email] PwChanged:', e.message));
    res.json({ ok: true });
  } catch (e) { console.error('[Auth] Password change:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/auth/legal-proof
router.get('/legal-proof', auth, async (req, res) => {
  const u = await db.oneOrNone(
    'SELECT email, name, phone, terms_accepted_at, terms_version, kvkk_accepted_at, ip_at_acceptance FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ userId: req.user.id, ...u, generatedAt: new Date().toISOString(),
    note: 'KVKK Madde 11 kapsamindasozlesme kabulunun teknik ispat belgesidir.' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-posta zorunludur.' });
    const user = await db.oneOrNone(
      'SELECT id, name, email FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (!user) return res.json({ message: 'E-posta gonderildi.' });
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000).toISOString();
    await db.none(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );
    await sendPasswordReset({ name: user.name, email: user.email, resetToken: token });
    res.json({ message: 'E-posta gonderildi.' });
  } catch (e) { console.error('[Auth] Forgot password:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token ve sifre zorunludur.' });
    if (password.length < 8) return res.status(400).json({ error: 'Sifre en az 8 karakter olmalidir.' });
    const user = await db.oneOrNone(
      `SELECT id, name, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()`,
      [token]
    );
    if (!user) return res.status(400).json({ error: 'Gecersiz veya suresi dolmus baglanti.' });
    const hash = await bcrypt.hash(password, ROUNDS);
    await db.none(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL, updated_at = NOW() WHERE id = $2',
      [hash, user.id]
    );
    await _audit(user.id, 'SIFRE SIFIRLANDI', { headers: {}, socket: {} });
    sendPasswordChanged({ name: user.name, email: user.email }).catch(e => console.error('[Email] PwReset:', e.message));
    res.json({ message: 'Sifre basariyla guncellendi.' });
  } catch (e) { console.error('[Auth] Reset password:', e); res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

function _safeUser(u) {
  if (!u) return null;
  let settings  = {}; try { settings  = JSON.parse(u.settings  || '{}'); } catch (_) {}
  let therapies = []; try { therapies = JSON.parse(u.therapies || '[]'); } catch (_) {}
  let prices    = {}; try { prices    = JSON.parse(u.prices    || '{}'); } catch (_) {}
  return {
    id: u.id, email: u.email, name: u.name, phone: u.phone || '',
    clinicName: u.clinic_name, clinicAddr: u.clinic_addr, clinicPhone: u.clinic_phone,
    therapies, prices, plan: u.plan, trialEnds: u.trial_ends,
    hasGcal: !!u.gcal_tokens, gcalId: u.gcal_id || null, invCounter: u.inv_counter || 1,
    emailVerified: !!u.email_verified,
    termsAcceptedAt: u.terms_accepted_at, termsVersion: u.terms_version,
    aiConsentGiven: settings.aiConsentGiven === true,
  };
}

async function _audit(uid, action, req) {
  try {
    const ip = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
    await db.none('INSERT INTO audit_log (user_id, action, ip) VALUES ($1, $2, $3)', [uid, action, ip]);
  } catch (_) {}
}

module.exports = router;
module.exports._audit    = _audit;
module.exports._safeUser = _safeUser;
module.exports.TERMS_VERSION = TERMS_VERSION;
