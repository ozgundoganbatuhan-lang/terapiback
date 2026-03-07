// src/services/email.js — TerapiSeansım E-posta Servisi (Resend)
// resend.com → ücretsiz 3000 mail/ay → kart gerekmez
// Kurulum: RESEND_API_KEY ortam değişkenini Railway'e ekleyin

const { Resend } = require('resend');

const resend   = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM     = process.env.EMAIL_FROM || 'TerapiSeansım <noreply@terapiseansim.com>';
const APP_URL  = process.env.FRONTEND_URL || 'https://terapiseansim.vercel.app';

// ── HTML Şablonu ──────────────────────────────────────────
function wrap(content) {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TerapiSeansım</title>
</head>
<body style="margin:0;padding:0;background:#F5F3EE;font-family:'Georgia',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EE;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

  <!-- Logo -->
  <tr><td style="padding-bottom:24px;text-align:left;">
    <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:linear-gradient(135deg,#7C6FAE,#3D8C82);border-radius:8px;
                 width:32px;height:32px;text-align:center;vertical-align:middle;">
        <span style="font-family:Georgia,serif;font-size:15px;font-weight:bold;color:#fff;line-height:32px;">T</span>
      </td>
      <td style="padding-left:10px;vertical-align:middle;">
        <span style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#0F1623;letter-spacing:-.3px;">TerapiSeansım</span>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Ana içerik -->
  <tr><td style="background:#FFFFFF;border-radius:16px;border:1px solid rgba(15,22,35,.07);
                 padding:40px;box-shadow:0 2px 20px rgba(15,22,35,.05);">
    ${content}
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding-top:24px;text-align:center;font-family:'DM Sans',sans-serif;font-size:12px;color:#9AA3B8;line-height:1.8;">
    <p style="margin:0 0 6px;">© 2025 TerapiSeansım</p>
    <p style="margin:0 0 6px;">Sorularınız için
      <a href="mailto:destek@terapiseansim.com" style="color:#7C6FAE;text-decoration:none;">destek@terapiseansim.com</a>
    </p>
    <p style="margin:0;font-size:11px;color:#C4C9D6;">🔒 KVKK Uyumlu · AES-256-GCM Şifreli</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Yardımcı bileşenler ───────────────────────────────────
const h1 = (t) =>
  `<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;color:#0F1623;
    margin:0 0 14px;letter-spacing:-.03em;line-height:1.15;">${t}</h1>`;

const p = (t, extra = '') =>
  `<p style="font-family:'DM Sans',sans-serif;font-size:14.5px;color:#5A6882;
    line-height:1.78;margin:10px 0;${extra}">${t}</p>`;

const btn = (href, label, bg = '#0F1623') =>
  `<div style="margin:24px 0 18px;">
    <a href="${href}" style="display:inline-block;background:${bg};color:#fff;
      padding:13px 28px;border-radius:10px;font-family:Georgia,serif;font-size:15px;
      font-weight:600;text-decoration:none;letter-spacing:-.01em;
      box-shadow:0 4px 14px rgba(15,22,35,.18);">${label}</a>
  </div>`;

const divider = () =>
  `<hr style="border:none;border-top:1px solid rgba(15,22,35,.06);margin:24px 0;">`;

const infoRow = (icon, label, value, highlight = false) =>
  `<tr>
    <td style="padding:9px 12px;font-family:'DM Sans',sans-serif;font-size:13px;color:#8896B0;border-bottom:1px solid #F0ECE6;">
      ${icon} ${label}
    </td>
    <td style="padding:9px 12px;text-align:right;font-family:'DM Sans',sans-serif;font-size:13px;
      font-weight:600;color:${highlight ? '#3D8C82' : '#0F1623'};border-bottom:1px solid #F0ECE6;">
      ${value}
    </td>
  </tr>`;

function infoTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0"
    style="background:#F8F5F0;border-radius:10px;overflow:hidden;margin:18px 0;">
    ${rows}
  </table>`;
}

// ── Gönder fonksiyonu ─────────────────────────────────────
async function send(to, subject, html) {
  if (!resend) {
    console.log(`[Email SKIP — RESEND_API_KEY yok] → ${to} | ${subject}`);
    return;
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) console.error('[Email] Hata:', error);
    else console.log(`[Email] Gönderildi: ${data?.id} → ${to}`);
  } catch (e) {
    console.error('[Email] Exception:', e.message);
  }
}

// ════════════════════════════════════════════════════════
//  1. HOŞ GELDİN
// ════════════════════════════════════════════════════════
async function sendWelcome({ name, email, trialEnds }) {
  const ad = name ? name.split(' ')[0] : 'Psikolog';
  const trialStr = trialEnds
    ? new Date(trialEnds).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
    : '14 gün içinde';

  const html = wrap(`
    ${h1(`Hoş geldiniz, ${ad}! 🌿`)}
    ${p('TerapiSeansım hesabınız başarıyla oluşturuldu. 14 günlük ücretsiz deneme süreniz bugünden itibaren başladı.')}
    ${btn(`${APP_URL}/app.html`, 'Uygulamayı Açın →')}
    ${divider()}
    <p style="font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;color:#0F1623;margin:0 0 10px;">
      Deneme süreniz boyunca erişebileceğiniz özellikler:
    </p>
    ${infoTable(`
      ${infoRow('📅', 'Randevu Yönetimi', 'Sınırsız', true)}
      ${infoRow('🔒', 'AES-256-GCM Şifreli Notlar', 'Aktif', true)}
      ${infoRow('🌿', 'Hasta Kaydı', 'Sınırsız', true)}
      ${infoRow('📈', 'PHQ-9 & GAD-7 Takibi', 'Aktif', true)}
      ${infoRow('✨', 'AI Klinik Araçları', '6 araç', true)}
      ${infoRow('🧾', 'Fatura & Paket', 'Aktif', true)}
      ${infoRow('⏳', 'Deneme Bitiş Tarihi', trialStr, false)}
    `)}
    ${divider()}
    ${p('Başlarken öneri: İlk hastanızı ekleyin, ardından AI araçlarını deneyin. Herhangi bir sorunuzda '
      + `<a href="mailto:destek@terapiseansim.com" style="color:#7C6FAE;">destek@terapiseansim.com</a> adresine yazabilirsiniz.`,
      'font-size:13.5px;')}
  `);

  await send(email, `TerapiSeansım'a hoş geldiniz — 14 günlük denemeniz başladı 🌿`, html);
}

// ════════════════════════════════════════════════════════
//  2. TRİAL BİTİYOR UYARISI
// ════════════════════════════════════════════════════════
async function sendTrialEnding({ name, email, daysLeft, trialEnds }) {
  const ad = name ? name.split(' ')[0] : 'Psikolog';
  const trialStr = trialEnds
    ? new Date(trialEnds).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
    : '';
  const urgency = daysLeft === 1
    ? '🔴 Son gün'
    : daysLeft <= 3
    ? '🟡 Son 3 gün'
    : '⏳ Hatırlatma';

  const html = wrap(`
    ${h1(`${urgency}: Deneme süreniz bitiyor`)}
    ${p(`Merhaba ${ad}, TerapiSeansım ücretsiz deneme sürenizin bitmesine <strong style="color:#B85C6E;">${daysLeft} gün</strong> kaldı${trialStr ? ` (${trialStr})` : ''}.`)}
    ${p('Aboneliğinizi başlatarak tüm hasta verileriniz, şifreli notlarınız ve randevularınızla kaldığınız yerden devam edebilirsiniz.')}
    ${btn(`${APP_URL}/landing.html#fiyatlar`, 'Planları İncele →', '#7C6FAE')}
    ${divider()}
    ${infoTable(`
      ${infoRow('✅', 'Verileriniz güvende', 'AES-256-GCM korumalı', true)}
      ${infoRow('✅', 'KVKK tam uyum', 'Yasal güvence aktif', true)}
      ${infoRow('✅', 'AI araçları', 'Erişim devam ediyor', true)}
      ${infoRow('⚠️', 'Süre bitince', '30 gün veri koruma', false)}
    `)}
    ${p('Sorularınız için <a href="mailto:destek@terapiseansim.com" style="color:#7C6FAE;">destek@terapiseansim.com</a> adresine yazabilirsiniz.', 'font-size:13px;')}
  `);

  await send(email, `${urgency}: TerapiSeansım deneme süreniz ${daysLeft} gün içinde bitiyor`, html);
}

// ════════════════════════════════════════════════════════
//  3. TRİAL BİTTİ
// ════════════════════════════════════════════════════════
async function sendTrialExpired({ name, email }) {
  const ad = name ? name.split(' ')[0] : 'Psikolog';

  const html = wrap(`
    ${h1('Deneme süreniz sona erdi')}
    ${p(`Merhaba ${ad}, TerapiSeansım ücretsiz deneme süreniz tamamlandı. Hesabınız geçici olarak askıya alındı.`)}
    ${p('<strong>Verileriniz 30 gün boyunca güvende tutulmaktadır.</strong> Bu süre içinde bir plan seçerek kaldığınız yerden devam edebilir, ya da verilerinizi dışa aktarabilirsiniz.')}
    ${btn(`${APP_URL}/landing.html#fiyatlar`, 'Planları İncele ve Devam Et →', '#0F1623')}
    ${divider()}
    ${p('30 gün içinde plan seçilmezse hesap ve tüm veriler KVKK uyumlu şekilde kalıcı olarak silinir. Yardım için <a href="mailto:destek@terapiseansim.com" style="color:#7C6FAE;">destek@terapiseansim.com</a>.', 'font-size:13px;')}
  `);

  await send(email, 'TerapiSeansım deneme süreniz sona erdi', html);
}

// ════════════════════════════════════════════════════════
//  4. ŞİFRE SIFIRLAMA
// ════════════════════════════════════════════════════════
async function sendPasswordReset({ name, email, resetToken }) {
  const ad = name ? name.split(' ')[0] : '';
  const resetUrl = `${APP_URL}/giris.html?reset=${resetToken}`;

  const html = wrap(`
    ${h1('Şifre sıfırlama bağlantısı')}
    ${p(`Merhaba${ad ? ` ${ad}` : ''}, hesabınız için şifre sıfırlama talebi aldık. Aşağıdaki butona tıklayarak yeni şifrenizi belirleyebilirsiniz.`)}
    ${btn(resetUrl, 'Şifremi Sıfırla →', '#0F1623')}
    ${divider()}
    ${infoTable(`
      ${infoRow('⏱️', 'Geçerlilik süresi', '1 saat')}
      ${infoRow('🔒', 'Tek kullanımlık', 'Yalnızca siz kullanabilirsiniz')}
    `)}
    ${p('Bu talebi siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz — hesabınızda herhangi bir değişiklik yapılmamıştır.', 'font-size:13px;')}
    ${divider()}
    <p style="font-family:'DM Sans',sans-serif;font-size:11.5px;color:#9AA3B8;word-break:break-all;margin:0;">
      Buton çalışmıyorsa bu bağlantıyı tarayıcınıza yapıştırın:<br>
      <a href="${resetUrl}" style="color:#7C6FAE;">${resetUrl}</a>
    </p>
  `);

  await send(email, 'TerapiSeansım — Şifre sıfırlama bağlantısı', html);
}

// ════════════════════════════════════════════════════════
//  5. ŞİFRE DEĞİŞTİRİLDİ BİLDİRİMİ
// ════════════════════════════════════════════════════════
async function sendPasswordChanged({ name, email }) {
  const ad = name ? name.split(' ')[0] : '';
  const now = new Date().toLocaleString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const html = wrap(`
    ${h1('Şifreniz değiştirildi ✅')}
    ${p(`Merhaba${ad ? ` ${ad}` : ''}, TerapiSeansım hesabınızın şifresi başarıyla güncellendi.`)}
    ${infoTable(`
      ${infoRow('🕐', 'Değiştirilme zamanı', now)}
      ${infoRow('📧', 'Hesap e-postası', email)}
    `)}
    ${p('Bu değişikliği <strong>siz yapmadıysanız</strong> hemen '
      + '<a href="mailto:destek@terapiseansim.com" style="color:#B85C6E;">destek@terapiseansim.com</a>'
      + ' adresine yazın, hesabınızı koruma altına alalım.', 'font-size:13.5px;')}
    ${divider()}
    ${btn(`${APP_URL}/index.html`, 'Hesabıma Giriş Yap →')}
  `);

  await send(email, 'TerapiSeansım — Şifreniz değiştirildi', html);
}


// ════════════════════════════════════════════════════════
//  6. E-POSTA DOĞRULAMA
// ════════════════════════════════════════════════════════
async function sendEmailVerification({ name, email, verifyToken }) {
  const ad = name ? name.split(' ')[0] : 'Psikolog';
  const verifyUrl = `${APP_URL}/giris.html?verify=${verifyToken}`;

  const html = wrap(`
    ${h1(`E-posta adresinizi doğrulayın 📧`)}
    ${p(`Merhaba ${ad}, TerapiSeansım hesabınızı aktifleştirmek için aşağıdaki butona tıklayın.`)}
    ${btn(verifyUrl, 'E-postamı Doğrula →', '#317A4A')}
    ${divider()}
    ${infoTable(`
      ${infoRow('⏱️', 'Geçerlilik süresi', '24 saat')}
      ${infoRow('🔒', 'Güvenli bağlantı', 'HTTPS şifreli')}
      ${infoRow('📅', '14 gün ücretsiz', 'Doğrulama sonrası başlar')}
    `)}
    ${p('Bu hesabı siz oluşturmadıysanız bu e-postayı görmezden gelebilirsiniz.', 'font-size:13px;')}
    ${divider()}
    <p style="font-family:'DM Sans',sans-serif;font-size:11.5px;color:#9AA3B8;word-break:break-all;margin:0;">
      Buton çalışmıyorsa bu bağlantıyı tarayıcınıza yapıştırın:<br>
      <a href="${verifyUrl}" style="color:#317A4A;">${verifyUrl}</a>
    </p>
  `);

  await send(email, 'TerapiSeansım — E-posta adresinizi doğrulayın 📧', html);
}

module.exports = {
  sendWelcome,
  sendTrialEnding,
  sendTrialExpired,
  sendPasswordReset,
  sendPasswordChanged,
  sendEmailVerification,
};
