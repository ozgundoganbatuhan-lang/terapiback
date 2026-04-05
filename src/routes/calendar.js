// src/routes/calendar.js
const router = require('express').Router();
const db   = require('../db/database');
const auth = require('../middleware/auth');
const { _audit } = require('./auth');
const gcal = require('../services/googleCalendar');

// GET /api/calendar/connect
router.get('/connect', auth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID)
    return res.status(501).json({
      error: 'Google Calendar yapilandirilmamis.',
      setup: 'Railway\'de GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ve GOOGLE_REDIRECT_URI degiskenlerini ekleyin.',
    });
  try {
    const url = gcal.getAuthUrl(req.user.id);
    res.json({ url });
  } catch(e) {
    res.status(500).json({ error: 'OAuth URL uretilemedi: ' + e.message });
  }
});

// GET /api/calendar/callback
router.get('/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  const FRONTEND = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000';

  if (error || !code || !userId) {
    const msg = encodeURIComponent(error || 'Izin reddedildi veya kod eksik');
    return res.redirect(`${FRONTEND}/app.html?gcal=error&msg=${msg}`);
  }

  try {
    await gcal.handleCallback(code, userId);
    await _audit(userId, 'GOOGLE CALENDAR BAGLANDI', req);
    res.redirect(`${FRONTEND}/app.html?gcal=success`);
  } catch(e) {
    console.error('GCal callback error:', e.message);
    const msg = encodeURIComponent(e.message || 'OAuth hatasi');
    res.redirect(`${FRONTEND}/app.html?gcal=error&msg=${msg}`);
  }
});

// GET /api/calendar/status
router.get('/status', auth, async (req, res) => {
  try {
    const u = await db.oneOrNone('SELECT gcal_tokens, gcal_id FROM users WHERE id=$1', [req.user.id]);
    res.json({
      connected: !!u?.gcal_tokens,
      calendarId: u?.gcal_id || null,
      configured: !!process.env.GOOGLE_CLIENT_ID,
    });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// GET /api/calendar/upcoming
router.get('/upcoming', auth, async (req, res) => {
  try {
    const u = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!u.gcal_tokens) return res.status(400).json({ error: 'Google Calendar bagli degil.' });
    try {
      const events = await gcal.fetchUpcoming(u, parseInt(req.query.days) || 30);
      res.json(events);
    } catch(e) {
      console.error('GCal fetch error:', e.message);
      if (e.message?.includes('invalid_grant') || e.message?.includes('Token')) {
        await db.none('UPDATE users SET gcal_tokens=NULL, gcal_id=NULL WHERE id=$1', [u.id]);
        return res.status(401).json({ error: 'Google Calendar baglantisi suresi doldu. Lutfen yeniden baglayin.', reconnect: true });
      }
      res.status(500).json({ error: 'Takvim verileri alinamadi: ' + e.message });
    }
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

// DELETE /api/calendar/disconnect
router.delete('/disconnect', auth, async (req, res) => {
  try {
    const u = await db.oneOrNone('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (!u.gcal_tokens) return res.json({ ok: true });
    try { await gcal.revokeAccess(u); } catch(_) {}
    await _audit(req.user.id, 'GOOGLE CALENDAR BAGLANTISI KESILDI', req);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Sunucu hatasi.' }); }
});

module.exports = router;
