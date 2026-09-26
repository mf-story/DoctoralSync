/**
 * Gateway WhatsApp E-Disertasi
 * -------------------------------------------------------------
 * Login sekali via scan QR (buka /qr di browser), lalu server E-Disertasi
 * memanggil POST /send { number, message } untuk mengirim notifikasi WA.
 *
 * Env:
 *   WA_PORT    (default 3011)   - port gateway ini
 *   WA_API_KEY (opsional)       - jika diisi, /send wajib header
 *                                 Authorization: Bearer <key>
 *   PUPPETEER_EXECUTABLE_PATH (opsional) - path Chromium (Docker/VPS)
 *
 * CATATAN: memakai WhatsApp Web tidak resmi. Kirim seperlunya
 *          (event nyata + jeda) agar nomor tidak diblokir.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = Number(process.env.WA_PORT) || 3011;
const API_KEY = process.env.WA_API_KEY || '';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

process.on('unhandledRejection', r => console.error('[WA] unhandledRejection:', r && r.message ? r.message : r));
process.on('uncaughtException', e => console.error('[WA] uncaughtException:', e && e.message ? e.message : e));

let lastQr = null;
let ready = false;
let meNumber = null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

client.on('qr', qr => { lastQr = qr; ready = false; console.log('[WA] Scan QR di http://localhost:' + PORT + '/qr'); });
client.on('ready', () => { ready = true; lastQr = null; meNumber = client.info && client.info.wid ? client.info.wid.user : null; console.log('[WA] Terhubung sebagai', meNumber); });
client.on('authenticated', () => console.log('[WA] Autentikasi berhasil'));
client.on('auth_failure', m => { ready = false; console.error('[WA] Autentikasi gagal:', m); });
client.on('disconnected', r => { ready = false; meNumber = null; console.warn('[WA] Terputus:', r); });
client.initialize().catch(e => console.error('[WA] Gagal init:', e && e.message ? e.message : e));

// Normalisasi nomor Indonesia -> format internasional tanpa tanda.
function normalizeNumber(n) {
  let s = String(n || '').replace(/[^0-9]/g, '');
  if (!s) return '';
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (s.startsWith('620')) s = '62' + s.slice(3);
  if (!s.startsWith('62')) s = '62' + s;
  return s;
}

function requireKey(req, res) {
  if (!API_KEY) return true;
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

app.get('/', (req, res) => {
  res.type('html').send('<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">' +
    '<h2>E-Disertasi &middot; WA Gateway</h2>' +
    '<p>Status: <b>' + (ready ? 'Terhubung (' + meNumber + ')' : (lastQr ? 'Menunggu scan QR' : 'Inisialisasi&hellip;')) + '</b></p>' +
    (ready ? '' : '<p><a href="/qr">Buka halaman QR untuk menautkan WhatsApp</a></p>') +
    '</body>');
});

app.get('/status', (req, res) => res.json({ ready, me: meNumber, hasQr: !!lastQr }));

app.get('/qr', async (req, res) => {
  if (ready) return res.type('html').send('<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem"><h3>&#9989; Sudah terhubung sebagai ' + meNumber + '</h3></body>');
  if (!lastQr) return res.type('html').send('<meta http-equiv="refresh" content="2"><body style="font-family:system-ui;padding:2rem">Menyiapkan QR&hellip; halaman akan menyegar otomatis.</body>');
  try {
    const dataUrl = await qrcode.toDataURL(lastQr, { width: 320, margin: 1 });
    res.type('html').send('<meta charset="utf-8"><meta http-equiv="refresh" content="15"><body style="font-family:system-ui;text-align:center;padding:2rem">' +
      '<h3>Scan dengan WhatsApp &rsaquo; Perangkat Tertaut</h3><img src="' + dataUrl + '" alt="QR"><p>Halaman menyegar tiap 15 detik.</p></body>');
  } catch (e) { res.status(500).send('Gagal membuat QR: ' + e.message); }
});

app.post('/send', async (req, res) => {
  if (!requireKey(req, res)) return;
  if (!ready) return res.status(409).json({ error: 'WhatsApp belum terhubung' });
  const number = normalizeNumber(req.body.number);
  const message = String(req.body.message || '');
  const image = req.body.image ? String(req.body.image) : '';
  if (!number) return res.status(400).json({ error: 'Nomor tidak valid' });
  if (!message.trim() && !image) return res.status(400).json({ error: 'Pesan kosong' });
  try {
    const numberId = await client.getNumberId(number);
    if (!numberId) return res.status(400).json({ error: 'Nomor tidak terdaftar di WhatsApp' });
    if (image) {
      try {
        const media = /^https?:\/\//i.test(image)
          ? await MessageMedia.fromUrl(image, { unsafeMime: true })
          : MessageMedia.fromFilePath(image);
        await client.sendMessage(numberId._serialized, media, { caption: message });
        return res.json({ ok: true, to: number, withImage: true });
      } catch (imgErr) {
        console.error('[WA] gambar gagal, fallback teks:', imgErr && imgErr.message ? imgErr.message : imgErr);
      }
    }
    await client.sendMessage(numberId._serialized, message);
    res.json({ ok: true, to: number });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.listen(PORT, () => console.log('[WA] Gateway aktif di http://localhost:' + PORT + (API_KEY ? ' (API key aktif)' : '')));
