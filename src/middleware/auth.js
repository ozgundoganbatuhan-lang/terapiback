// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db  = require('../db/database');

module.exports = function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token gerekli.' });

  try {
    const payload = jwt.verify(hdr.slice(7), process.env.JWT_SECRET);
    const user = db.prepare(
      'SELECT id, email, name, clinic_name, plan, trial_ends FROM users WHERE id = ?'
    ).get(payload.id);
    if (!user) return res.status(401).json({ error: 'Geçersiz token.' });

    // Trial süresi kontrolü
    if (user.plan === 'trial' && user.trial_ends) {
      const exp = new Date(user.trial_ends);
      if (exp < new Date()) {
        return res.status(402).json({
          error: 'Deneme süreniz doldu. Lütfen bir plana abone olun.',
          code: 'TRIAL_EXPIRED'
        });
      }
    }

    req.user = user;
    req.ip_addr = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token geçersiz veya süresi dolmuş.' });
  }
};
