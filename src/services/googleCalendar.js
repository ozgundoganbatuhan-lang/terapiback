// src/services/googleCalendar.js
const { google } = require('googleapis');
const db = require('../db/database');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// OAuth2 yetkilendirme URL'i üret
function getAuthUrl(state) {
  const oAuth2 = getOAuthClient();
  return oAuth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state: state || '',
  });
}

// Callback — code → tokens kaydet
async function handleCallback(code, userId) {
  const oAuth2 = getOAuthClient();
  const { tokens } = await oAuth2.getToken(code);
  oAuth2.setCredentials(tokens);

  // Birincil takvim ID'sini al
  const cal = google.calendar({ version: 'v3', auth: oAuth2 });
  const calList = await cal.calendarList.get({ calendarId: 'primary' });
  const gcalId = calList.data.id;

  await db.none(
    'UPDATE users SET gcal_tokens=$1, gcal_id=$2, updated_at=NOW() WHERE id=$3',
    [JSON.stringify(tokens), gcalId, userId]
  );

  return { gcalId };
}

// Kimlik doğrulama istemcisi hazırla (token yenileme dahil)
async function getAuthForUser(user) {
  const oAuth2 = getOAuthClient();
  const tokens = JSON.parse(user.gcal_tokens);
  oAuth2.setCredentials(tokens);

  // Token yenileme event'i — DB'ye kaydet
  oAuth2.on('tokens', async (newTokens) => {
    if (newTokens.refresh_token) tokens.refresh_token = newTokens.refresh_token;
    tokens.access_token = newTokens.access_token;
    tokens.expiry_date  = newTokens.expiry_date;
    await db.none('UPDATE users SET gcal_tokens=$1 WHERE id=$2', [JSON.stringify(tokens), user.id])
      .catch(e => console.error('[GCal] Token save error:', e.message));
  });

  return oAuth2;
}

// Randevuyu Google Calendar'a ekle veya güncelle
async function syncToGcal(user, apt) {
  const auth  = await getAuthForUser(user);
  const cal   = google.calendar({ version: 'v3', auth });
  const calId = user.gcal_id || 'primary';

  const endTime = new Date(new Date(apt.atTime).getTime() + apt.duration * 60000).toISOString();
  const medMap  = { face: 'Yuz Yuze', online: 'Online', phone: 'Telefon' };

  const event = {
    summary: `${apt.patientName} — ${apt.therapy}`,
    description: [
      `Terapi: ${apt.therapy}`,
      `Ortam: ${medMap[apt.medium] || apt.medium}`,
      `Sure: ${apt.duration} dakika`,
      apt.note ? `Not: ${apt.note}` : '',
      '',
      '—— TerapiSeansim ——',
    ].filter(Boolean).join('\n'),
    start: { dateTime: apt.atTime, timeZone: 'Europe/Istanbul' },
    end:   { dateTime: endTime,    timeZone: 'Europe/Istanbul' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
    colorId: '9', // Blueberry
  };

  if (apt.eventId) {
    // Güncelle
    const res = await cal.events.update({
      calendarId: calId, eventId: apt.eventId, resource: event,
    });
    return res.data;
  } else {
    // Yeni oluştur
    const res = await cal.events.insert({
      calendarId: calId, resource: event,
    });
    return res.data;
  }
}

// Randevuyu Google Calendar'dan sil
async function deleteFromGcal(user, eventId) {
  const auth = await getAuthForUser(user);
  const cal  = google.calendar({ version: 'v3', auth });
  await cal.events.delete({
    calendarId: user.gcal_id || 'primary',
    eventId,
  });
}

// Yaklaşan randevuları GCal'dan çek (senkronizasyon kontrolü)
async function fetchUpcoming(user, days = 30) {
  const auth = await getAuthForUser(user);
  const cal  = google.calendar({ version: 'v3', auth });
  const maxTime = new Date(Date.now() + days * 86400000).toISOString();
  const res = await cal.events.list({
    calendarId: user.gcal_id || 'primary',
    timeMin: new Date().toISOString(),
    timeMax: maxTime,
    singleEvents: true,
    orderBy: 'startTime',
    q: 'TerapiSeansim',
    maxResults: 50,
  });
  return res.data.items || [];
}

// Bağlantıyı kes
async function revokeAccess(user) {
  try {
    const auth = await getAuthForUser(user);
    await auth.revokeCredentials();
  } catch(_) {}
  await db.none('UPDATE users SET gcal_tokens=NULL, gcal_id=NULL WHERE id=$1', [user.id]);
}

module.exports = { getAuthUrl, handleCallback, syncToGcal, deleteFromGcal, fetchUpcoming, revokeAccess };
