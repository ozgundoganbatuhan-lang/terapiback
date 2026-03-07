// src/services/reminderService.js — Hasta Hatırlatıcı Servisi
const db = require('../db/database');

let Resend = null;
try {
  Resend = require('resend').Resend;
} catch(_) {}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !Resend) return { ok: false, reason: 'RESEND yapılandırılmamış' };
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM || 'TerapiSeansım <noreply@terapiseansim.com>';
    const r = await resend.emails.send({ from, to, subject, html });
    return { ok: true, id: r.id };
  } catch(e) {
    console.error('[Reminder] E-posta hatası:', e.message);
    return { ok: false, reason: e.message };
  }
}

// Randevu hatırlatıcısı gönder
async function sendAppointmentReminder(apt, patient, psychologist) {
  if (!patient.email) return { ok: false, reason: 'Hasta e-postası yok' };

  const dt = new Date(apt.at_time);
  const dateStr = dt.toLocaleDateString('tr-TR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Europe/Istanbul',
  });
  const timeStr = dt.toLocaleTimeString('tr-TR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });

  const medMap = { face: 'Yüz Yüze', online: 'Online (Video)', phone: 'Telefon' };
  const clinicName = psychologist.clinic_name || psychologist.name;
  const clinicAddr = psychologist.clinic_addr || '';

  const html = `
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:"Helvetica Neue",Arial,sans-serif;background:#F4F1EB;margin:0;padding:20px}
  .wrap{max-width:520px;margin:0 auto}
  .header{background:#0C1F14;border-radius:12px 12px 0 0;padding:28px 32px;text-align:center}
  .logo{font-family:Georgia,serif;font-size:22px;font-style:italic;color:#fff;font-weight:600}
  .body{background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e0dcd3;border-top:none}
  .greeting{font-size:16px;color:#111B15;font-weight:500;margin-bottom:20px}
  .card{background:#F4F1EB;border-radius:10px;padding:20px 24px;margin:20px 0}
  .row{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px}
  .ic{font-size:18px;width:24px;flex-shrink:0;margin-top:1px}
  .val{font-size:14px;color:#111B15;font-weight:500}
  .lbl{font-size:11px;color:#7A9280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
  .note{background:#E8F5EC;border:1px solid rgba(42,96,64,.2);border-radius:8px;padding:14px 16px;font-size:13px;color:#2A6040;margin-top:16px}
  .footer{text-align:center;font-size:11px;color:#7A9280;margin-top:20px;line-height:1.8}
  .btn{display:inline-block;background:#0C1F14;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500;margin-top:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header"><div class="logo">TerapiSeansım</div></div>
  <div class="body">
    <p class="greeting">Merhaba ${patient.first_name || 'Değerli Hastamız'},</p>
    <p style="font-size:14px;color:#4E6A55;line-height:1.7">Aşağıdaki randevunuzu hatırlatmak isteriz.</p>
    <div class="card">
      <div class="row"><div class="ic">📅</div><div><div class="lbl">Tarih</div><div class="val">${dateStr}</div></div></div>
      <div class="row"><div class="ic">🕐</div><div><div class="lbl">Saat</div><div class="val">${timeStr}</div></div></div>
      <div class="row"><div class="ic">👤</div><div><div class="lbl">Terapist</div><div class="val">${psychologist.name}${clinicName && clinicName !== psychologist.name ? ' · ' + clinicName : ''}</div></div></div>
      <div class="row" style="margin-bottom:0"><div class="ic">📍</div><div><div class="lbl">Seans Türü</div><div class="val">${medMap[apt.medium] || apt.medium}${apt.medium === 'face' && clinicAddr ? '<br><span style="font-size:12px;color:#7A9280">'+clinicAddr+'</span>' : ''}</div></div></div>
    </div>
    ${apt.note ? '<div class="note">📝 <strong>Terapist Notu:</strong> ' + apt.note + '</div>' : ''}
    <p style="font-size:13px;color:#7A9280;margin-top:20px;line-height:1.7">
      Randevunuzu iptal etmeniz ya da ertelemeniz gerekiyorsa lütfen önceden bildiriniz.
    </p>
    <div class="footer">
      Bu e-posta TerapiSeansım platformu aracılığıyla gönderilmiştir.<br>
      Sorularınız için terapistinizle iletişime geçiniz.
    </div>
  </div>
</div>
</body>
</html>`;

  return sendEmail(
    patient.email,
    `📅 Randevu Hatırlatıcı — ${dateStr} ${timeStr}`,
    html,
  );
}

module.exports = { sendAppointmentReminder, sendEmail };
