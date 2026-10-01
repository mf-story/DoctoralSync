// Server aplikasi Bimbingan Disertasi
// Hanya modul bawaan Node.js (npm diblokir execution policy di lingkungan ini).
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Catat error tak tertangani agar terlihat di log (mis. Coolify) alih-alih diam keluar
process.on('uncaughtException', e => console.error('[uncaughtException]', e));
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));

const PORT = parseInt(process.env.PORT, 10) || 5520;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_FILE = 12 * 1024 * 1024; // 12 MB (ukuran file asli)
const MAX_BODY = 20 * 1024 * 1024; // 20 MB (body JSON, base64 ~1.37x lebih besar dari file)

// --- Notifikasi WhatsApp (opsional; lewat WA gateway di wa-server/) ---
const WA_API_URL = process.env.WA_API_URL || '';   // mis. http://127.0.0.1:3011/send
const WA_API_KEY = process.env.WA_API_KEY || '';
const APP_URL = process.env.APP_URL || ('http://localhost:' + PORT);
// Banner gambar untuk notifikasi WA. Default: teks saja (seperti LeaDi-PDS).
// Isi env WA_BANNER dengan URL gambar HANYA bila ingin memakai kartu gambar.
const WA_BANNER = process.env.WA_BANNER || '';
function normalizeWa(n) {
  let s = String(n || '').replace(/[^0-9]/g, '');
  if (!s) return '';
  if (s.startsWith('0')) s = '62' + s.slice(1);
  if (s.startsWith('620')) s = '62' + s.slice(3);
  if (!s.startsWith('62')) s = '62' + s;
  return s;
}
function sendWhatsApp(number, message) {
  const num = normalizeWa(number);
  if (!WA_API_URL || !num) return;
  try {
    const u = new URL(WA_API_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({ number: num, message: String(message), image: WA_BANNER || undefined });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (WA_API_KEY) headers['Authorization'] = 'Bearer ' + WA_API_KEY;
    const rq = lib.request({ method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers, timeout: 15000 }, r => r.resume());
    rq.on('error', e => console.error('[WA] gagal kirim:', e.message));
    rq.on('timeout', () => rq.destroy());
    rq.write(payload); rq.end();
  } catch (e) { console.error('[WA] error:', e.message); }
}
// Kirim WA ke user berdasarkan id (pakai nomor user.wa).
function waUser(userId, message) {
  const u = DB.users.find(x => x.id === userId);
  if (u && u.wa) sendWhatsApp(u.wa, message);
}
function namaUser(userId) { const u = DB.users.find(x => x.id === userId); return u ? u.nama : '-'; }
// Format pesan notifikasi WA agar konsisten, bersalam, dan menarik.
function waFormat(namaPenerima, isi, opts) {
  opts = opts || {};
  const garis = '━━━━━━━━━━━━━━━';
  let msg = 'Assalamualaikum Wr. Wb.\n\n';
  msg += '*🎓 DOCTORALSYNC*\n';
  msg += '_Sistem Bimbingan Disertasi_\n';
  msg += garis + '\n';
  if (namaPenerima) msg += `Yth. *${namaPenerima}*,\n\n`;
  msg += isi;
  if (opts.catatan && String(opts.catatan).trim()) msg += `\n\n📝 *Catatan:*\n${String(opts.catatan).trim()}`;
  msg += `\n\n🔗 *Buka aplikasi:*\n${APP_URL}`;
  msg += '\n' + garis + '\n';
  msg += 'Terima kasih 🙏\n_Wassalamualaikum Wr. Wb._';
  return msg;
}
function waNotify(userId, isi, opts) {
  const u = DB.users.find(x => x.id === userId);
  if (u && u.wa) sendWhatsApp(u.wa, waFormat(u.nama, isi, opts));
}
// Set fase yang sudah ACC untuk satu jalur (dosen).
function trackAccFasesSrv(entries) {
  const sorted = entries.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const hasMhs = sorted.some(b => b.dibuatOleh === 'mahasiswa');
  const firstNoMarker = sorted.find(b => !b.dibuatOleh);
  const isPeng = b => b.dibuatOleh === 'mahasiswa' || (!hasMhs && b === firstNoMarker);
  let fase = 'Proposal', seen = 0; const acc = new Set();
  sorted.forEach(b => {
    if (isPeng(b)) { fase = b.fase || (seen === 0 ? 'Proposal' : fase); seen++; }
    if (b.status === 'acc') acc.add(fase);
  });
  return acc;
}
// Jadwal ujian boleh diisi bila SEMUA pembimbing sudah ACC di fase tsb.
function faseAccReady(mid, fase) {
  const s = DB.skripsi.find(x => x.mahasiswaId === mid);
  if (!s) return false;
  const pembs = [s.pembimbing1, s.pembimbing2].filter(Boolean);
  if (!pembs.length) return false;
  return pembs.every(pid => trackAccFasesSrv(DB.bimbingan.filter(b => b.mahasiswaId === mid && b.dosenId === pid)).has(fase));
}

// Onboarding mahasiswa lama: tandai fase-fase yang SUDAH dilewati (bimbingan berjalan
// manual sebelum aplikasi). Membuat entri bimbingan sintetis (ditandai sistem:true)
// agar ACC tiap fase terpenuhi + mengisi tanggal ujian tiap fase yang sudah lulus.
const FASE_ORDER = ['Proposal', 'Instrumen', 'Hasil', 'Tutup', 'Promosi'];
const FASE_JENIS = { Proposal: 'proposal', Hasil: 'hasil', Tutup: 'tutup', Promosi: 'promosi' };
function applyStartingStage(mid, lastFase, dates, sessions, doneFases, pengajuan) {
  const s = DB.skripsi.find(x => x.mahasiswaId === mid);
  if (!s) return { ok: false, error: 'Data skripsi tidak ditemukan' };
  const pembs = [s.pembimbing1, s.pembimbing2].filter(Boolean);
  if (!pembs.length) return { ok: false, error: 'Tetapkan Promotor/Co-Promotor terlebih dahulu' };
  // Bersihkan entri sintetis lama agar bisa dijalankan ulang (idempoten)
  DB.bimbingan = DB.bimbingan.filter(b => !(b.sistem && b.mahasiswaId === mid));
  dates = dates || {}; sessions = sessions || {};
  const done = Array.isArray(doneFases) ? doneFases : [];
  const peng = pengajuan || {};
  const idx = FASE_ORDER.indexOf(lastFase);
  if (idx < 0) { s.updatedAt = new Date().toISOString(); return { ok: true, completed: [] }; }
  const completed = FASE_ORDER.slice(0, idx + 1);
  let seq = 0;
  const stamp = () => new Date(Date.UTC(2000, 0, 1) + (seq++) * 1000).toISOString();
  s.ujian = s.ujian || {};
  const pembKey = { p1: s.pembimbing1, p2: s.pembimbing2 };
  completed.forEach(fase => {
    const isDone = done.includes(fase); // sudah lulus ujian fase ini (ACC + ujian)
    const examTgl = isDone ? String(dates[fase] || '').trim() : '';
    const faseSess = sessions[fase] || {};
    ['p1', 'p2'].forEach(pk => {
      const pid = pembKey[pk];
      if (!pid) return;
      const sess = (Array.isArray(faseSess[pk]) ? faseSess[pk] : []).map(x => String(x || '').trim()).filter(Boolean);
      const pengTgl = String(((peng[fase] || {})[pk]) || '').trim() || sess[0] || examTgl || '';
      // Entri pengajuan (menandai fase pada jalur dosen ini)
      DB.bimbingan.push({
        id: uid('bmb'), mahasiswaId: mid, dosenId: pid,
        tanggal: pengTgl, topik: 'Pengajuan bimbingan ' + fase, metode: '',
        status: 'disetujui', dibuatOleh: 'mahasiswa', fase,
        catatanMhs: '', catatanDosen: '', dokumen: [], sistem: true, createdAt: stamp()
      });
      if (sess.length) {
        sess.forEach((d, j) => {
          const last = j === sess.length - 1;
          DB.bimbingan.push({
            id: uid('bmb'), mahasiswaId: mid, dosenId: pid,
            tanggal: d, topik: 'Bimbingan ' + fase + ' ke-' + (j + 1), metode: 'Tatap muka',
            status: (last && isDone) ? 'acc' : 'selesai', dibuatOleh: 'dosen',
            catatanMhs: '', catatanDosen: (last && isDone) ? 'ACC — siap diujikan (data awal).' : 'Bimbingan berjalan (data awal).',
            dokumen: [], sistem: true, createdAt: stamp()
          });
        });
      } else if (isDone) {
        // Tanpa rincian pertemuan tapi sudah lulus: satu entri ACC agar syarat ujian terpenuhi
        DB.bimbingan.push({
          id: uid('bmb'), mahasiswaId: mid, dosenId: pid,
          tanggal: examTgl || '', topik: 'ACC ' + fase + ' (data awal)', metode: 'Tatap muka',
          status: 'acc', dibuatOleh: 'dosen',
          catatanMhs: '', catatanDosen: 'Data migrasi manual (bimbingan berjalan sebelum aplikasi).',
          dokumen: [], sistem: true, createdAt: stamp()
        });
      }
    });
    const jns = FASE_JENIS[fase];
    if (fase === 'Instrumen') {
      if (isDone) {
        s.instrumen = Object.assign({}, s.instrumen, { tanggal: examTgl, status: 'valid', catatan: (s.instrumen && s.instrumen.catatan) || '', validatorId: s.validatorId || (s.instrumen && s.instrumen.validatorId) || '', updatedAt: new Date().toISOString() });
      } else if (s.instrumen && s.instrumen.status) {
        s.instrumen = Object.assign({}, s.instrumen, { status: '', updatedAt: new Date().toISOString() });
      }
    } else if (isDone) {
      const prev = s.ujian[jns] || {};
      s.ujian[jns] = { tanggal: examTgl, penguji: prev.penguji || [], metode: prev.metode || 'luring', link: prev.link || '', tempat: prev.tempat || '' };
    } else if (s.ujian[jns]) {
      delete s.ujian[jns]; // belum lulus ujian -> jangan tampilkan jadwal
    }
  });
  s.updatedAt = new Date().toISOString();
  return { ok: true, completed };
}

// ------------------------------------------------------------------
// Utilitas penyimpanan (satu file JSON, tulis atomik)
// ------------------------------------------------------------------
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), s, 64).toString('hex');
  return `${s}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt] = stored.split(':');
  const check = hashPassword(password, salt);
  const a = Buffer.from(check);
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

const DEFAULT_TAHAPAN = [
  'Pengajuan Judul',
  'Penyusunan Proposal (Bab 1-3)',
  'Seminar Proposal',
  'Penelitian / Pengambilan Data',
  'Penyusunan Hasil (Bab 4-5)',
  'Seminar Hasil',
  'Ujian Sidang Disertasi',
  'Revisi Akhir & Pengumpulan'
];

let DB = null;

// Penyimpanan: PostgreSQL bila DATABASE_URL diisi (mis. di Coolify), selain itu
// memakai file data/db.json (mode default untuk pengembangan lokal).
let USE_PG = !!process.env.DATABASE_URL;
let pgStore = null;

async function loadDB() {
  ensureDirs();
  if (USE_PG) {
    try {
      pgStore = require('./db-pg');
      await pgStore.init();
      const { db, empty } = await pgStore.loadAll();
      if (!empty) {
        DB = db;
      } else if (fs.existsSync(DB_FILE)) {
        // Migrasi sekali: pindahkan isi db.json lama ke PostgreSQL
        try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
        catch (e) { console.error('Gagal membaca db.json untuk migrasi:', e.message); DB = null; }
        if (DB) { console.log('Migrasi data db.json -> PostgreSQL...'); }
      }
    } catch (e) {
      // Jangan matikan aplikasi bila DB gagal — kembali ke mode file agar tetap hidup
      console.error('⚠ PostgreSQL tidak dapat diakses (' + e.message + '). Fallback ke file data/db.json.');
      USE_PG = false;
      pgStore = null;
      DB = null;
    }
  }
  if (!DB && !USE_PG && fs.existsSync(DB_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('Gagal membaca db.json, membuat baru:', e.message);
      DB = null;
    }
  }
  if (!DB) {
    DB = {
      users: [],
      skripsi: [],   // { mahasiswaId, judul, pembimbing1, pembimbing2, tahapan:[{nama,selesai,tanggal}], updatedAt }
      bimbingan: [], // { id, mahasiswaId, dosenId, tanggal, topik, metode, status, catatanMhs, catatanDosen, dokumen:[docId], createdAt }
      documents: [], // { id, mahasiswaId, bimbinganId, nama, file, ukuran, uploadedBy, createdAt }
      timeline: [],  // { id, mahasiswaId, judul, tanggal, selesai, createdBy }
      prodi: [],     // { id, kode, nama, ketua, createdAt }
      meta: { tahapanTemplate: DEFAULT_TAHAPAN, createdAt: new Date().toISOString() }
    };
    // Buat admin default
    DB.users.push({
      id: uid('usr'),
      username: 'admin',
      nama: 'Administrator Prodi',
      role: 'admin',
      prodi: '',
      wa: '',
      password: hashPassword('admin123'),
      createdAt: new Date().toISOString()
    });
    try { await saveDB(); } catch (e) { console.error('Gagal menulis DB awal:', e.message); }
    console.log('DB baru dibuat. Login admin default: admin / admin123');
  }
  // migrasi ringan
  if (!DB.meta.tahapanTemplate) DB.meta.tahapanTemplate = DEFAULT_TAHAPAN;
  if (!DB.prodi) DB.prodi = [];
  if (DB.meta.defaultValidator === undefined) DB.meta.defaultValidator = '';
  (DB.skripsi || []).forEach(s => { if (s.validatorId === undefined) s.validatorId = DB.meta.defaultValidator || ''; });
  // Pindahkan foto profil base64 lama menjadi file agar db.json tetap ringan
  let avatarMigrated = false;
  (DB.users || []).forEach(u => {
    if (typeof u.foto === 'string' && u.foto.startsWith('data:image')) {
      const m = u.foto.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
      if (m) {
        try {
          const e = m[1].toLowerCase(); const ext = (e === 'jpg' || e === 'jpeg') ? 'jpg' : e;
          const fname = 'avatar-' + u.id + '.' + ext;
          fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(m[2], 'base64'));
          u.foto = '/uploads/' + fname; avatarMigrated = true;
        } catch (err) { u.foto = ''; avatarMigrated = true; }
      } else { u.foto = ''; avatarMigrated = true; }
    }
  });
  if (avatarMigrated) { try { await saveDB(); } catch (e) { console.error('Gagal menyimpan migrasi foto:', e.message); } }
  // Pastikan state tersimpan di PostgreSQL saat mode DB aktif (termasuk migrasi db.json -> PG)
  if (USE_PG) { try { await saveDB(); } catch (e) { console.error('Gagal persist awal ke PostgreSQL:', e.message); } }
}

let saveTimer = null;
function saveDB() {
  if (USE_PG) return pgStore.persist(DB);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}
function saveDBDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { const r = saveDB(); if (r && r.catch) r.catch(e => console.error(e)); } catch (e) { console.error(e); } }, 150);
}

// ------------------------------------------------------------------
// Sesi (token in-memory, 12 jam)
// ------------------------------------------------------------------
const sessions = new Map(); // token -> { userId, exp }
const SESSION_MS = 12 * 60 * 60 * 1000;

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, exp: Date.now() + SESSION_MS });
  return token;
}
function getSessionUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) { sessions.delete(token); return null; }
  const user = DB.users.find(u => u.id === s.userId);
  return user || null;
}

// ------------------------------------------------------------------
// Helper HTTP
// ------------------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Payload terlalu besar')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
// Sandi default: dosen = NUPTK, mahasiswa = NIM (keduanya = username); lainnya 'disertasi123'.
function defaultPassword(role, username) {
  return (role === 'dosen' || role === 'mahasiswa' || role === 'validator') ? String(username || '') : 'disertasi123';
}

// ------------------------------------------------------------------
// Static file serving
// ------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// Pembatasan penyajian statis: hanya aset publik, blokir berkas/direktori sensitif
const STATIC_BLOCK_DIRS = ['data', 'certs', 'wa-server', 'node_modules', '.git'];
const STATIC_BLOCK_FILES = new Set(['server.js', 'package.json', 'package-lock.json', '.gitignore']);
const STATIC_ALLOW_EXT = new Set([
  '.html', '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.svg', '.ico', '.webmanifest', '.woff', '.woff2', '.map'
]);

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  // cegah path traversal
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  let filePath, isUpload = false;
  if (safe.startsWith('/uploads/') || safe.startsWith('\\uploads\\')) {
    filePath = path.join(UPLOAD_DIR, safe.replace(/^[\/\\]uploads[\/\\]/, ''));
    if (!filePath.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    isUpload = true;
  } else {
    filePath = path.join(ROOT, safe);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    // Hanya izinkan aset publik; blokir sumber, database, sertifikat, dsb.
    const relFromRoot = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const topDir = (relFromRoot.split('/')[0] || '').toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    if (STATIC_BLOCK_DIRS.includes(topDir) || STATIC_BLOCK_FILES.has(base) || !STATIC_ALLOW_EXT.has(ext)) {
      res.writeHead(404); return res.end('Not found');
    }
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    // Berkas dari uploads: hanya pdf/gambar boleh tampil inline; sisanya dipaksa unduh (cegah XSS/HTML/SVG aktif)
    if (isUpload) {
      const inlineOk = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
      if (!inlineOk) { headers['Content-Type'] = 'application/octet-stream'; headers['Content-Disposition'] = 'attachment'; }
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// ------------------------------------------------------------------
// Router API
// ------------------------------------------------------------------
async function handleApi(req, res, url, ip) {
  const method = req.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1); // buang 'api'
  const query = url.searchParams;

  // --- LOGIN ---
  if (seg[0] === 'login' && method === 'POST') {
    if (loginBlocked(ip)) return sendJSON(res, 429, { error: 'Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.' });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const user = DB.users.find(u => u.username.toLowerCase() === username);
    if (!user || !verifyPassword(body.password || '', user.password)) {
      recordLoginFail(ip);
      return sendJSON(res, 401, { error: 'Username atau kata sandi salah' });
    }
    resetLoginFail(ip);
    const token = createSession(user.id);
    return sendJSON(res, 200, { token, user: publicUser(user) });
  }

  // Semua endpoint di bawah butuh autentikasi
  const me = getSessionUser(req);

  if (seg[0] === 'logout' && method === 'POST') {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    sessions.delete(token);
    return sendJSON(res, 200, { ok: true });
  }

  if (!me) return sendJSON(res, 401, { error: 'Tidak terautentikasi' });

  if (seg[0] === 'me' && method === 'GET') {
    return sendJSON(res, 200, { user: publicUser(me) });
  }

  // Ganti kata sandi sendiri
  if (seg[0] === 'me' && seg[1] === 'password' && method === 'POST') {
    const body = await readBody(req);
    if (!verifyPassword(body.old || '', me.password)) {
      return sendJSON(res, 400, { error: 'Kata sandi lama salah' });
    }
    if (!body.baru || String(body.baru).length < 5) {
      return sendJSON(res, 400, { error: 'Kata sandi baru minimal 5 karakter' });
    }
    me.password = hashPassword(body.baru);
    saveDBDebounced();
    return sendJSON(res, 200, { ok: true });
  }

  // Unggah / hapus foto diri (disimpan sebagai file di uploads/, path pada user.foto)
  if (seg[0] === 'me' && seg[1] === 'foto' && method === 'POST') {
    const body = await readBody(req);
    const foto = String(body.foto || '');
    const oldName = (me.foto && me.foto.startsWith('/uploads/')) ? path.basename(me.foto) : '';
    if (!foto) {
      if (oldName) { try { fs.unlinkSync(path.join(UPLOAD_DIR, oldName)); } catch (e) {} }
      me.foto = ''; saveDBDebounced();
      return sendJSON(res, 200, { user: publicUser(me) });
    }
    const m = foto.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (!m) return sendJSON(res, 400, { error: 'Format gambar tidak didukung' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) return sendJSON(res, 400, { error: 'Ukuran foto terlalu besar (maks ~2MB)' });
    const e = m[1].toLowerCase(); const ext = (e === 'jpg' || e === 'jpeg') ? 'jpg' : e;
    const fname = uid('ava') + '.' + ext;
    try { fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf); }
    catch (err) { return sendJSON(res, 500, { error: 'Gagal menyimpan foto' }); }
    if (oldName && oldName !== fname) { try { fs.unlinkSync(path.join(UPLOAD_DIR, oldName)); } catch (e2) {} }
    me.foto = '/uploads/' + fname;
    saveDBDebounced();
    return sendJSON(res, 200, { user: publicUser(me) });
  }

  // ================= USERS (admin) =================
  if (seg[0] === 'users') {
    if (method === 'GET') {
      // admin & kaprodi bisa lihat daftar; dosen bisa lihat daftar dosen (untuk pembimbing)
      const roleFilter = query.get('role');
      let list = DB.users;
      if (me.role === 'mahasiswa') {
        list = DB.users.filter(u => u.role === 'dosen');
      } else if (me.role === 'dosen') {
        list = DB.users.filter(u => u.role === 'dosen' || u.role === 'mahasiswa');
      } else if (me.role !== 'admin' && me.role !== 'kaprodi') {
        return sendJSON(res, 403, { error: 'Akses ditolak' });
      }
      if (roleFilter) list = list.filter(u => u.role === roleFilter);
      return sendJSON(res, 200, { users: list.map(publicUser) });
    }
    if (method === 'POST' && seg[1] === 'import') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      const body = await readBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const roles = ['mahasiswa', 'dosen', 'admin', 'kaprodi', 'validator'];
      const findDosen = v => {
        v = String(v || '').trim().toLowerCase();
        if (!v) return '';
        const d = DB.users.find(u => u.role === 'dosen' && (u.username.toLowerCase() === v || u.nama.toLowerCase() === v));
        return d ? d.id : '';
      };
      let created = 0; const errors = []; const seen = new Set();
      rows.forEach((r, i) => {
        const rowNo = i + 2; // baris 1 = header
        const nama = String(r.nama || '').trim();
        const username = String(r.username || '').trim().toLowerCase();
        const role = roles.includes(String(r.role || '').trim().toLowerCase()) ? String(r.role).trim().toLowerCase() : 'mahasiswa';
        if (!username) { errors.push({ row: rowNo, username: r.username || '', error: 'Username kosong' }); return; }
        if (seen.has(username) || DB.users.some(u => u.username.toLowerCase() === username)) {
          errors.push({ row: rowNo, username, error: 'Username sudah dipakai' }); return;
        }
        seen.add(username);
        const p1 = role === 'mahasiswa' ? findDosen(r.promotor) : '';
        const p2 = role === 'mahasiswa' ? findDosen(r.copromotor) : '';
        // Cocokkan prodi ke Master Prodi (berdasarkan kode atau nama) → simpan Nama Prodi
        const prodiRaw = String(r.prodi || '').trim();
        const pm = (DB.prodi || []).find(p => p.kode.toLowerCase() === prodiRaw.toLowerCase() || p.nama.toLowerCase() === prodiRaw.toLowerCase());
        const user = {
          id: uid('usr'), username, nama: nama || username, role,
          prodi: pm ? pm.nama : prodiRaw, wa: String(r.wa || '').trim(),
          tahunMasuk: role === 'mahasiswa' ? String(r.tahunMasuk || r['tahun masuk'] || '').trim() : '',
          pembimbing1: p1, pembimbing2: p2,
          password: hashPassword(String(r.password || '').trim() || defaultPassword(role, username)),
          createdAt: new Date().toISOString()
        };
        DB.users.push(user);
        if (role === 'mahasiswa') {
          DB.skripsi.push({
            mahasiswaId: user.id, judul: String(r.judul || '').trim(),
            pembimbing1: p1, pembimbing2: p2,
            validatorId: DB.meta.defaultValidator || '',
            tahapan: DB.meta.tahapanTemplate.map(n => ({ nama: n, selesai: false, tanggal: '' })),
            updatedAt: new Date().toISOString()
          });
          // Onboarding mahasiswa lama: set fase yang sudah dilewati bila kolom diisi
          const lastFaseRaw = String(r.faseTerakhir || r['fase_terakhir'] || r.fase || '').trim().toLowerCase();
          const lastFase = FASE_ORDER.find(f => f.toLowerCase() === lastFaseRaw) || '';
          if (lastFase && p1) {
            applyStartingStage(user.id, lastFase, {
              Proposal: r.tglProposal || r['tgl_ujian_proposal'] || '',
              Hasil: r.tglHasil || r['tgl_ujian_hasil'] || '',
              Tutup: r.tglTutup || r['tgl_ujian_tutup'] || '',
              Promosi: r.tglPromosi || r['tgl_ujian_promosi'] || ''
            }, {}, FASE_ORDER, {});
          }
        }
        created++;
      });
      if (created) saveDBDebounced();
      return sendJSON(res, 200, { created, errors });
    }
    if (method === 'POST' && !seg[1]) {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      const body = await readBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      if (!username) return sendJSON(res, 400, { error: 'Username wajib diisi' });
      if (DB.users.some(u => u.username.toLowerCase() === username)) {
        return sendJSON(res, 400, { error: 'Username sudah dipakai' });
      }
      const role = ['mahasiswa', 'dosen', 'admin', 'kaprodi', 'validator'].includes(body.role) ? body.role : 'mahasiswa';
      const user = {
        id: uid('usr'),
        username,
        nama: String(body.nama || '').trim() || username,
        role,
        prodi: String(body.prodi || '').trim(),
        wa: String(body.wa || '').trim(),
        tahunMasuk: role === 'mahasiswa' ? String(body.tahunMasuk || '').trim() : '',
        pembimbing1: body.pembimbing1 || '',
        pembimbing2: body.pembimbing2 || '',
        password: hashPassword(body.password || defaultPassword(role, username)),
        createdAt: new Date().toISOString()
      };
      DB.users.push(user);
      if (role === 'mahasiswa') {
        DB.skripsi.push({
          mahasiswaId: user.id,
          judul: String(body.judul || '').trim(),
          pembimbing1: user.pembimbing1,
          pembimbing2: user.pembimbing2,
          validatorId: body.validatorId || DB.meta.defaultValidator || '',
          tahapan: DB.meta.tahapanTemplate.map(n => ({ nama: n, selesai: false, tanggal: '' })),
          updatedAt: new Date().toISOString()
        });
      }
      saveDBDebounced();
      return sendJSON(res, 200, { user: publicUser(user) });
    }
    const targetId = seg[1];
    if (targetId && method === 'PUT') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      const body = await readBody(req);
      const u = DB.users.find(x => x.id === targetId);
      if (!u) return sendJSON(res, 404, { error: 'User tidak ditemukan' });
      ['nama', 'prodi', 'wa', 'tahunMasuk', 'pembimbing1', 'pembimbing2'].forEach(k => {
        if (body[k] !== undefined) u[k] = body[k];
      });
      if (body.role && ['mahasiswa', 'dosen', 'admin', 'kaprodi', 'validator'].includes(body.role)) u.role = body.role;
      // sinkron pembimbing ke skripsi
      const sk = DB.skripsi.find(s => s.mahasiswaId === u.id);
      if (sk) {
        if (body.pembimbing1 !== undefined) sk.pembimbing1 = body.pembimbing1;
        if (body.pembimbing2 !== undefined) sk.pembimbing2 = body.pembimbing2;
        if (body.judul !== undefined) sk.judul = String(body.judul);
        if (body.validatorId !== undefined) sk.validatorId = body.validatorId;
      }
      saveDBDebounced();
      return sendJSON(res, 200, { user: publicUser(u) });
    }
    if (targetId && seg[2] === 'reset-password' && method === 'POST') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      const body = await readBody(req);
      const u = DB.users.find(x => x.id === targetId);
      if (!u) return sendJSON(res, 404, { error: 'User tidak ditemukan' });
      u.password = hashPassword(body.password || defaultPassword(u.role, u.username));
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
    if (targetId && method === 'DELETE') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      if (targetId === me.id) return sendJSON(res, 400, { error: 'Tidak bisa menghapus diri sendiri' });
      // Hapus juga berkas dokumen milik pengguna agar tidak menyisakan file yatim
      DB.documents.filter(d => d.mahasiswaId === targetId || d.uploadedBy === targetId)
        .forEach(d => { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(d.file || ''))); } catch (e) {} });
      const targetUser = DB.users.find(u => u.id === targetId);
      if (targetUser && typeof targetUser.foto === 'string' && targetUser.foto.startsWith('/uploads/')) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(targetUser.foto))); } catch (e) {}
      }
      DB.documents = DB.documents.filter(d => d.mahasiswaId !== targetId && d.uploadedBy !== targetId);
      DB.users = DB.users.filter(u => u.id !== targetId);
      DB.skripsi = DB.skripsi.filter(s => s.mahasiswaId !== targetId);
      DB.bimbingan = DB.bimbingan.filter(b => b.mahasiswaId !== targetId);
      DB.timeline = DB.timeline.filter(t => t.mahasiswaId !== targetId);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ================= MASTER PROGRAM STUDI =================
  if (seg[0] === 'prodi') {
    const pid = seg[1];
    if (method === 'GET' && !pid) {
      const list = (DB.prodi || []).slice().sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || '')));
      return sendJSON(res, 200, { prodi: list });
    }
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
    if (method === 'POST' && !pid) {
      const body = await readBody(req);
      const kode = String(body.kode || '').trim();
      const nama = String(body.nama || '').trim();
      if (!kode || !nama) return sendJSON(res, 400, { error: 'Kode dan Nama Prodi wajib diisi' });
      if ((DB.prodi || []).some(p => p.kode.toLowerCase() === kode.toLowerCase())) return sendJSON(res, 400, { error: 'Kode prodi sudah dipakai' });
      const p = { id: uid('prd'), kode, nama, ketua: String(body.ketua || '').trim(), createdAt: new Date().toISOString() };
      DB.prodi = DB.prodi || []; DB.prodi.push(p);
      saveDBDebounced();
      return sendJSON(res, 200, { prodi: p });
    }
    if (method === 'PUT' && pid) {
      const p = (DB.prodi || []).find(x => x.id === pid);
      if (!p) return sendJSON(res, 404, { error: 'Prodi tidak ditemukan' });
      const body = await readBody(req);
      if (body.kode !== undefined) {
        const kode = String(body.kode).trim();
        if (!kode) return sendJSON(res, 400, { error: 'Kode wajib diisi' });
        if (DB.prodi.some(x => x.id !== pid && x.kode.toLowerCase() === kode.toLowerCase())) return sendJSON(res, 400, { error: 'Kode prodi sudah dipakai' });
        p.kode = kode;
      }
      if (body.nama !== undefined) p.nama = String(body.nama).trim();
      if (body.ketua !== undefined) p.ketua = String(body.ketua).trim();
      saveDBDebounced();
      return sendJSON(res, 200, { prodi: p });
    }
    if (method === 'DELETE' && pid) {
      DB.prodi = (DB.prodi || []).filter(x => x.id !== pid);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ================= SKRIPSI =================
  if (seg[0] === 'skripsi') {
    const mid = seg[1];
    if (method === 'GET' && !mid) {
      let list = DB.skripsi;
      if (me.role === 'mahasiswa') list = list.filter(s => s.mahasiswaId === me.id);
      else if (me.role === 'dosen') list = list.filter(s => s.pembimbing1 === me.id || s.pembimbing2 === me.id);
      else if (me.role === 'validator') list = list.filter(s => !s.validatorId || s.validatorId === me.id);
      // admin & kaprodi: semua
      const enriched = list.map(s => ({ ...s, mahasiswa: publicUser(DB.users.find(u => u.id === s.mahasiswaId)) }));
      return sendJSON(res, 200, { skripsi: enriched });
    }
    if (method === 'GET' && mid) {
      const s = DB.skripsi.find(x => x.mahasiswaId === mid);
      if (!s) return sendJSON(res, 404, { error: 'Data skripsi tidak ditemukan' });
      if (!canAccessMahasiswa(me, mid)) return sendJSON(res, 403, { error: 'Akses ditolak' });
      return sendJSON(res, 200, { skripsi: { ...s, mahasiswa: publicUser(DB.users.find(u => u.id === mid)) } });
    }
    // Onboarding mahasiswa lama (admin): tetapkan fase yang sudah dilewati
    if (method === 'POST' && mid && seg[2] === 'set-stage') {
      if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
      const body = await readBody(req);
      const lastFase = FASE_ORDER.includes(body.lastFase) ? body.lastFase : '';
      const r = applyStartingStage(mid, lastFase, body.dates || {}, body.sessions || {}, body.doneFases || [], body.pengajuan || {});
      if (!r.ok) return sendJSON(res, 400, { error: r.error });
      saveDBDebounced();
      const s = DB.skripsi.find(x => x.mahasiswaId === mid);
      return sendJSON(res, 200, { skripsi: { ...s, mahasiswa: publicUser(DB.users.find(u => u.id === mid)) }, completed: r.completed });
    }
    if (method === 'PUT' && mid) {
      const s = DB.skripsi.find(x => x.mahasiswaId === mid);
      if (!s) return sendJSON(res, 404, { error: 'Data skripsi tidak ditemukan' });
      const body = await readBody(req);
      // mahasiswa boleh ubah judul sendiri; dosen/admin boleh ubah tahapan & pembimbing
      const isOwner = me.role === 'mahasiswa' && me.id === mid;
      const isSupervisor = me.role === 'dosen' && (s.pembimbing1 === me.id || s.pembimbing2 === me.id);
      const isValidator = me.role === 'validator' && (!s.validatorId || s.validatorId === me.id);
      if (!isOwner && !isSupervisor && !isValidator && me.role !== 'admin') {
        return sendJSON(res, 403, { error: 'Akses ditolak' });
      }
      if (body.judul !== undefined) {
        // Mahasiswa mengusulkan judul (perlu persetujuan dosen); admin boleh langsung ubah
        if (isOwner) {
          s.judulUsulan = String(body.judul); s.judulStatus = 'pending';
          const isi = `*${namaUser(mid)}* mengajukan *perubahan judul disertasi*:`;
          const cat = `"${s.judulUsulan}"\n\nMohon untuk menyetujui atau menolak usulan ini.`;
          waNotify(s.pembimbing1, isi, { catatan: cat });
          waNotify(s.pembimbing2, isi, { catatan: cat });
        }
        else if (me.role === 'admin') { s.judul = String(body.judul); s.judulUsulan = ''; s.judulStatus = ''; }
      }
      // Persetujuan usulan judul oleh dosen pembimbing / admin
      if (body.judulAction && (isSupervisor || me.role === 'admin')) {
        if (body.judulAction === 'approve' && s.judulUsulan) {
          s.judul = s.judulUsulan; s.judulUsulan = ''; s.judulStatus = 'approved';
          waNotify(mid, `Alhamdulillah, usulan *judul disertasi* Anda telah *DISETUJUI*. ✅`, { catatan: `"${s.judul}"` });
        } else if (body.judulAction === 'reject') {
          s.judulUsulan = ''; s.judulStatus = 'rejected';
          waNotify(mid, `Mohon maaf, usulan *judul disertasi* Anda *ditolak*. Silakan ajukan judul lain.`);
        }
      }
      // Jadwal ujian per JENIS (berjenjang; butuh ACC semua pembimbing di fase terkait)
      if ((isOwner || me.role === 'admin') && body.ujianJenis && body.ujianTanggal !== undefined) {
        const JENIS = {
          proposal: { label: 'Ujian Seminar Proposal', fase: 'Proposal' },
          hasil: { label: 'Ujian Seminar Hasil', fase: 'Hasil' },
          tutup: { label: 'Ujian Seminar Tutup', fase: 'Tutup' },
          promosi: { label: 'Ujian Promosi Doktor', fase: 'Promosi' }
        };
        const jns = body.ujianJenis;
        if (!JENIS[jns]) return sendJSON(res, 400, { error: 'Jenis ujian tidak dikenal' });
        if (!faseAccReady(mid, JENIS[jns].fase) && me.role !== 'admin') return sendJSON(res, 403, { error: 'Jadwal ' + JENIS[jns].label + ' dapat diisi setelah bimbingan tahap ini di-ACC semua pembimbing.' });
        s.ujian = s.ujian || {};
        const prev = s.ujian[jns] || {};
        const penguji = Array.isArray(body.ujianPenguji)
          ? body.ujianPenguji.map(x => String(x).trim()).filter(Boolean).slice(0, 20)
          : (prev.penguji || []);
        const metode = (body.ujianMetode === 'daring' || body.ujianMetode === 'luring') ? body.ujianMetode : (prev.metode || 'luring');
        const link = body.ujianLink !== undefined ? String(body.ujianLink).trim().slice(0, 500) : (prev.link || '');
        const tempat = body.ujianTempat !== undefined ? String(body.ujianTempat).trim().slice(0, 300) : (prev.tempat || '');
        s.ujian[jns] = { tanggal: String(body.ujianTanggal), penguji, metode, link, tempat };
        const pengujiTxt = penguji.length ? `\nPenguji: ${penguji.join(', ')}` : '';
        const lokasiTxt = metode === 'daring' ? (link ? `\nDaring: ${link}` : '\nDaring') : (tempat ? `\nLuring: ${tempat}` : '\nLuring');
        const isi = `*${namaUser(mid)}* mengisi *jadwal ${JENIS[jns].label}*: *${body.ujianTanggal}*.${pengujiTxt}${lokasiTxt}`;
        waNotify(s.pembimbing1, isi); waNotify(s.pembimbing2, isi);
      }
      // Admin boleh menghapus jadwal ujian suatu fase
      if (me.role === 'admin' && body.ujianHapus && body.ujianJenis) {
        if (s.ujian && s.ujian[body.ujianJenis]) delete s.ujian[body.ujianJenis];
      }
      // Admin menetapkan/mengubah validator instrumen
      if (me.role === 'admin' && body.validatorId !== undefined) s.validatorId = body.validatorId;
      // Validasi instrumen oleh validator (atau admin)
      if (body.instrumen && (isValidator || me.role === 'admin')) {
        if (!faseAccReady(mid, 'Instrumen') && me.role !== 'admin') return sendJSON(res, 403, { error: 'Instrumen baru dapat divalidasi setelah bimbingan instrumen di-ACC kedua pembimbing.' });
        s.instrumen = s.instrumen || {};
        const inb = body.instrumen;
        if (inb.tanggal !== undefined) s.instrumen.tanggal = String(inb.tanggal);
        if (inb.status !== undefined) s.instrumen.status = ['valid', 'perbaikan'].includes(inb.status) ? inb.status : '';
        if (inb.catatan !== undefined) s.instrumen.catatan = String(inb.catatan);
        s.instrumen.validatorId = s.validatorId || me.id;
        s.instrumen.updatedAt = new Date().toISOString();
        const stLabel = s.instrumen.status === 'valid' ? 'dinyatakan *VALID*' : (s.instrumen.status === 'perbaikan' ? 'perlu *PERBAIKAN*' : 'diperbarui');
        waNotify(mid, `Instrumen penelitian Anda telah divalidasi: ${stLabel} oleh *${namaUser(s.validatorId || me.id)}*.`, { catatan: s.instrumen.catatan });
        if (s.pembimbing1) waNotify(s.pembimbing1, `Instrumen *${namaUser(mid)}* ${stLabel}.`);
        if (s.pembimbing2) waNotify(s.pembimbing2, `Instrumen *${namaUser(mid)}* ${stLabel}.`);
      }
      if (Array.isArray(body.tahapan) && (isSupervisor || me.role === 'admin')) {
        s.tahapan = body.tahapan.map(t => ({
          nama: String(t.nama || ''),
          selesai: !!t.selesai,
          tanggal: t.selesai ? (t.tanggal || new Date().toISOString().slice(0, 10)) : ''
        }));
      }
      if (me.role === 'admin') {
        if (body.pembimbing1 !== undefined) s.pembimbing1 = body.pembimbing1;
        if (body.pembimbing2 !== undefined) s.pembimbing2 = body.pembimbing2;
      }
      // Arsip kelulusan: promotor/co-promotor atau admin menandai LULUS (atau membatalkannya)
      if (body.lulus !== undefined && (isSupervisor || me.role === 'admin')) {
        s.lulus = !!body.lulus;
        s.tanggalLulus = s.lulus ? (String(body.tanggalLulus || '').trim() || new Date().toISOString().slice(0, 10)) : '';
        s.lulusOleh = s.lulus ? me.id : '';
        if (s.lulus) waNotify(mid, `Selamat! Bimbingan disertasi Anda dinyatakan *LULUS* dan telah *diarsipkan*. 🎓`);
      }
      s.updatedAt = new Date().toISOString();
      saveDBDebounced();
      return sendJSON(res, 200, { skripsi: s });
    }
  }

  // ================= BIMBINGAN =================
  if (seg[0] === 'bimbingan') {
    const bid = seg[1];
    if (method === 'GET' && !bid) {
      const mid = query.get('mahasiswaId');
      let list = DB.bimbingan;
      if (me.role === 'mahasiswa') list = list.filter(b => b.mahasiswaId === me.id);
      else if (me.role === 'dosen') list = list.filter(b => b.dosenId === me.id);
      if (mid) list = list.filter(b => b.mahasiswaId === mid);
      list = list.slice().sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''));
      const enriched = list.map(b => ({
        ...b,
        mahasiswaNama: (DB.users.find(u => u.id === b.mahasiswaId) || {}).nama || '-',
        dosenNama: (DB.users.find(u => u.id === b.dosenId) || {}).nama || '-'
      }));
      return sendJSON(res, 200, { bimbingan: enriched });
    }
    if (method === 'POST' && !bid) {
      const body = await readBody(req);
      let mahasiswaId, dosenId, status, catatanMhs = '', catatanDosen = '', dibuatOleh, faseBaru = 'Proposal';
      if (me.role === 'dosen') {
        dosenId = me.id;
        mahasiswaId = body.mahasiswaId;
        status = body.status || 'dijadwalkan';
        catatanDosen = String(body.catatan || '');
        dibuatOleh = 'dosen';
      } else if (me.role === 'admin') {
        dosenId = body.dosenId;
        mahasiswaId = body.mahasiswaId;
        status = body.status || 'dijadwalkan';
        catatanDosen = String(body.catatan || '');
        dibuatOleh = 'dosen';
      } else if (me.role === 'mahasiswa') {
        mahasiswaId = me.id;
        const sk = DB.skripsi.find(s => s.mahasiswaId === me.id);
        dosenId = body.dosenId || (sk && sk.pembimbing1) || '';
        // Dosen tujuan harus salah satu pembimbing mahasiswa
        if (!sk || (dosenId !== sk.pembimbing1 && dosenId !== sk.pembimbing2)) {
          return sendJSON(res, 403, { error: 'Dosen tujuan bukan promotor/co-promotor Anda.' });
        }
        faseBaru = ['Proposal', 'Instrumen', 'Hasil', 'Tutup', 'Promosi'].includes(body.fase) ? body.fase : 'Proposal';
        // Tahap Hasil hanya boleh setelah instrumen DIVALIDASI (valid)
        if (faseBaru === 'Hasil' && !(sk.instrumen && sk.instrumen.status === 'valid')) {
          return sendJSON(res, 403, { error: 'Bimbingan Hasil dapat diajukan setelah instrumen penelitian divalidasi (valid).' });
        }
        // Mahasiswa hanya boleh satu kali mengajukan ke tiap pembimbing PER FASE (Proposal / Disertasi)
        const existing = DB.bimbingan.filter(b => b.mahasiswaId === me.id && b.dosenId === dosenId && b.dibuatOleh === 'mahasiswa' && (b.fase || 'Proposal') === faseBaru);
        if (existing.length > 0) {
          return sendJSON(res, 403, { error: 'Anda sudah mengajukan bimbingan ' + faseBaru.toLowerCase() + ' ke dosen ini.' });
        }
        status = 'diajukan';
        catatanMhs = String(body.catatan || '');
        dibuatOleh = 'mahasiswa';
      } else {
        return sendJSON(res, 403, { error: 'Akses ditolak' });
      }
      if (!mahasiswaId || !dosenId) {
        return sendJSON(res, 400, { error: me.role === 'mahasiswa' ? 'Dosen pembimbing belum ditetapkan admin' : 'Data tidak lengkap' });
      }
      const b = {
        id: uid('bmb'),
        mahasiswaId, dosenId,
        tanggal: body.tanggal || new Date().toISOString().slice(0, 10),
        topik: String(body.topik || '').trim(),
        // Metode ditentukan dosen; pengajuan mahasiswa dibiarkan kosong
        metode: me.role === 'mahasiswa' ? '' : (body.metode || 'Tatap muka'),
        status,
        dibuatOleh,
        fase: dibuatOleh === 'mahasiswa' ? faseBaru : undefined,
        catatanMhs,
        catatanDosen,
        dokumen: Array.isArray(body.dokumen) ? body.dokumen : [],
        createdAt: new Date().toISOString()
      };
      DB.bimbingan.push(b);
      // Notifikasi WA ke pihak terkait
      if (dibuatOleh === 'mahasiswa') {
        waNotify(dosenId, `Terdapat *pengajuan bimbingan baru* dari *${namaUser(mahasiswaId)}*${b.topik ? ` dengan topik _"${b.topik}"_` : ''}.\nMohon untuk ditindaklanjuti.`);
      } else {
        const isRevisi = status === 'revisi';
        const note = String(b.catatanDosen || '').trim();
        waNotify(mahasiswaId, `${isRevisi ? 'Terdapat *permintaan revisi*' : 'Terdapat *tahapan/jadwal bimbingan baru*'} dari *${namaUser(dosenId)}*${b.topik ? ` — _"${b.topik}"_` : ''}.`, { catatan: note });
      }
      saveDBDebounced();
      return sendJSON(res, 200, { bimbingan: b });
    }
    if (method === 'PUT' && bid) {
      const b = DB.bimbingan.find(x => x.id === bid);
      if (!b) return sendJSON(res, 404, { error: 'Bimbingan tidak ditemukan' });
      const body = await readBody(req);
      const isDosen = me.role === 'dosen' && b.dosenId === me.id;
      const isMhs = me.role === 'mahasiswa' && b.mahasiswaId === me.id;
      if (isDosen || me.role === 'admin') {
        if (body.catatanDosen !== undefined) b.catatanDosen = String(body.catatanDosen);
        if (body.status !== undefined) b.status = body.status;
        if (body.tanggal !== undefined) b.tanggal = body.tanggal;
        if (body.metode !== undefined) b.metode = String(body.metode);
      }
      if (isMhs) {
        // Mahasiswa hanya boleh menambah catatan/tanggapan pada tahapannya
        if (body.catatanMhs !== undefined) b.catatanMhs = String(body.catatanMhs);
        if (body.tanggalUjian !== undefined) b.tanggalUjian = body.tanggalUjian;
        // Tandai sudah direvisi bila mahasiswa menanggapi entri yang diminta revisi
        if (b.status === 'revisi' && body.catatanMhs !== undefined) b.status = 'direvisi';
      }
      if (!isDosen && !isMhs && me.role !== 'admin') return sendJSON(res, 403, { error: 'Akses ditolak' });
      // Notifikasi WA
      if ((isDosen || me.role === 'admin') && body.status === 'disetujui') {
        const note = String(b.catatanDosen || '').trim();
        waNotify(b.mahasiswaId, `Alhamdulillah, pengajuan bimbingan Anda telah *DISETUJUI* oleh *${namaUser(b.dosenId)}*. \u2705\nSilakan lanjutkan proses bimbingan Anda.`, { catatan: note });
      } else if ((isDosen || me.role === 'admin') && body.status === 'acc') {
        const note = String(b.catatanDosen || '').trim();
        waNotify(b.mahasiswaId, `Alhamdulillah, bimbingan Anda telah *di-ACC* oleh *${namaUser(b.dosenId)}* dan dinyatakan *siap diujikan*. 🎉`, { catatan: note });
      }
      if (isMhs && body.tanggalUjian) {
        waNotify(b.dosenId, `*${namaUser(b.mahasiswaId)}* telah mengisi *jadwal ujian*: *${b.tanggalUjian}*.`);
      } else if (isMhs && b.status === 'direvisi' && body.catatanMhs !== undefined) {
        waNotify(b.dosenId, `*${namaUser(b.mahasiswaId)}* telah *menanggapi / merevisi* bimbingan.`);
      }
      saveDBDebounced();
      return sendJSON(res, 200, { bimbingan: b });
    }
    if (method === 'DELETE' && bid) {
      const b = DB.bimbingan.find(x => x.id === bid);
      if (!b) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      const canDelete = me.role === 'admin' ||
        (me.role === 'dosen' && b.dosenId === me.id) ||
        (me.role === 'mahasiswa' && b.mahasiswaId === me.id && b.status === 'diajukan');
      if (!canDelete) return sendJSON(res, 403, { error: 'Akses ditolak' });
      DB.bimbingan = DB.bimbingan.filter(x => x.id !== bid);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ================= DOCUMENTS =================
  if (seg[0] === 'documents') {
    if (method === 'GET') {
      const mid = query.get('mahasiswaId');
      let list = DB.documents;
      if (me.role === 'mahasiswa') list = list.filter(d => d.mahasiswaId === me.id);
      else if (me.role === 'dosen') {
        const myMhs = DB.skripsi.filter(s => s.pembimbing1 === me.id || s.pembimbing2 === me.id).map(s => s.mahasiswaId);
        list = list.filter(d => myMhs.includes(d.mahasiswaId));
      }
      if (mid) list = list.filter(d => d.mahasiswaId === mid);
      list = list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return sendJSON(res, 200, { documents: list });
    }
    if (method === 'POST' && !seg[1]) {
      const body = await readBody(req);
      let mahasiswaId = me.role === 'mahasiswa' ? me.id : body.mahasiswaId;
      if (!mahasiswaId) return sendJSON(res, 400, { error: 'mahasiswaId wajib' });
      if (!canAccessMahasiswa(me, mahasiswaId)) return sendJSON(res, 403, { error: 'Akses ditolak' });
      const dataUrl = String(body.dataUrl || '');
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return sendJSON(res, 400, { error: 'Format file tidak valid' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_FILE) return sendJSON(res, 400, { error: 'File terlalu besar (maks 12MB)' });
      // Hanya PDF asli (cek MIME + magic bytes) untuk mencegah unggahan berbahaya
      const isPdf = m[1] === 'application/pdf' && buf.slice(0, 5).toString('latin1') === '%PDF-';
      if (!isPdf) return sendJSON(res, 400, { error: 'Hanya berkas PDF yang diperbolehkan' });
      // Cegah duplikat: tolak jika isi file identik sudah pernah diunggah untuk mahasiswa ini
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const dup = DB.documents.find(d => d.mahasiswaId === mahasiswaId && d.hash === hash);
      if (dup) return sendJSON(res, 409, { error: 'Unggahan ditolak: isi file ini sama persis dengan dokumen "' + dup.nama + '" yang sudah ada. Jika ini hasil revisi, pastikan Anda memilih file yang sudah diperbaiki (bukan file lama).' });
      const safeName = String(body.nama || 'dokumen').replace(/[^\w.\- ]+/g, '_');
      const fname = uid('doc') + '.pdf';
      fs.writeFileSync(path.join(UPLOAD_DIR, fname), buf);
      const doc = {
        id: uid('doc'),
        mahasiswaId,
        bimbinganId: body.bimbinganId || '',
        nama: safeName,
        file: '/uploads/' + fname,
        ukuran: buf.length,
        hash,
        uploadedBy: me.id,
        uploaderNama: me.nama,
        createdAt: new Date().toISOString()
      };
      DB.documents.push(doc);
      if (body.bimbinganId) {
        const b = DB.bimbingan.find(x => x.id === body.bimbinganId);
        if (b) {
          b.dokumen = b.dokumen || []; b.dokumen.push(doc.id);
          // Mahasiswa mengunggah hasil revisi -> tandai sudah direvisi
          if (me.role === 'mahasiswa' && b.status === 'revisi') b.status = 'direvisi';
        }
      }
      saveDBDebounced();
      return sendJSON(res, 200, { document: doc });
    }
    const did = seg[1];
    if (did && method === 'DELETE') {
      const doc = DB.documents.find(d => d.id === did);
      if (!doc) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      const canDelete = me.role === 'admin' || doc.uploadedBy === me.id;
      if (!canDelete) return sendJSON(res, 403, { error: 'Akses ditolak' });
      try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(doc.file))); } catch (e) {}
      DB.documents = DB.documents.filter(d => d.id !== did);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
    // Catatan pada dokumen (dua arah: dosen & mahasiswa)
    if (did && seg[2] === 'catatan' && method === 'POST') {
      const doc = DB.documents.find(d => d.id === did);
      if (!doc) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      if (me.role === 'kaprodi' || !canAccessMahasiswa(me, doc.mahasiswaId)) return sendJSON(res, 403, { error: 'Akses ditolak' });
      const body = await readBody(req);
      const teks = String(body.teks || '').trim();
      if (!teks) return sendJSON(res, 400, { error: 'Catatan kosong' });
      doc.catatan = doc.catatan || [];
      const note = { id: uid('cat'), teks: teks.slice(0, 2000), oleh: me.id, olehNama: me.nama, olehRole: me.role, createdAt: new Date().toISOString() };
      doc.catatan.push(note);
      // Notifikasi WA ke pihak lawan
      if (me.role === 'mahasiswa') {
        const sk = DB.skripsi.find(x => x.mahasiswaId === doc.mahasiswaId);
        const isi = `*${me.nama}* menambahkan *catatan* pada dokumen _"${doc.nama}"_.`;
        if (sk) { waNotify(sk.pembimbing1, isi, { catatan: teks }); waNotify(sk.pembimbing2, isi, { catatan: teks }); }
      } else {
        waNotify(doc.mahasiswaId, `*${me.nama}* memberi *catatan* pada dokumen _"${doc.nama}"_.`, { catatan: teks });
      }
      saveDBDebounced();
      return sendJSON(res, 200, { catatan: note, document: doc });
    }
    if (did && seg[2] === 'catatan' && seg[3] && method === 'DELETE') {
      const doc = DB.documents.find(d => d.id === did);
      if (!doc) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      const note = (doc.catatan || []).find(n => n.id === seg[3]);
      if (!note) return sendJSON(res, 404, { error: 'Catatan tidak ditemukan' });
      if (me.role !== 'admin' && note.oleh !== me.id) return sendJSON(res, 403, { error: 'Akses ditolak' });
      doc.catatan = doc.catatan.filter(n => n.id !== seg[3]);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
    // Tanda / coretan pada dokumen (vektor stroke ternormalisasi)
    if (did && seg[2] === 'anotasi' && method === 'PUT') {
      const doc = DB.documents.find(d => d.id === did);
      if (!doc) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      if (me.role === 'kaprodi' || !canAccessMahasiswa(me, doc.mahasiswaId)) return sendJSON(res, 403, { error: 'Akses ditolak' });
      const body = await readBody(req);
      if (!Array.isArray(body.anotasi)) return sendJSON(res, 400, { error: 'Data anotasi tidak valid' });
      const incoming = body.anotasi.slice(0, 8000);
      if (me.role === 'mahasiswa') {
        // Mahasiswa hanya boleh mengelola tanda miliknya; tanda dari dosen/lainnya dipertahankan
        const preserved = (doc.anotasi || []).filter(a => a.oleh !== me.id);
        const mine = incoming.filter(a => a.oleh === me.id);
        doc.anotasi = preserved.concat(mine).slice(0, 8000);
      } else {
        doc.anotasi = incoming;
      }
      saveDBDebounced();
      return sendJSON(res, 200, { document: doc });
    }
  }

  // ================= TIMELINE / DEADLINE =================
  if (seg[0] === 'timeline') {
    const tid = seg[1];
    if (method === 'GET' && !tid) {
      const mid = query.get('mahasiswaId');
      let list = DB.timeline;
      if (me.role === 'mahasiswa') list = list.filter(t => t.mahasiswaId === me.id || t.mahasiswaId === '*');
      else if (me.role === 'dosen') {
        const myMhs = DB.skripsi.filter(s => s.pembimbing1 === me.id || s.pembimbing2 === me.id).map(s => s.mahasiswaId);
        list = list.filter(t => myMhs.includes(t.mahasiswaId) || t.mahasiswaId === '*');
      }
      if (mid) list = list.filter(t => t.mahasiswaId === mid || t.mahasiswaId === '*');
      list = list.slice().sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));
      return sendJSON(res, 200, { timeline: list });
    }
    if (method === 'POST' && !tid) {
      const body = await readBody(req);
      let mahasiswaId = body.mahasiswaId;
      if (me.role === 'mahasiswa') mahasiswaId = me.id;
      if (!mahasiswaId) return sendJSON(res, 400, { error: 'mahasiswaId wajib' });
      const t = {
        id: uid('tml'),
        mahasiswaId,
        judul: String(body.judul || '').trim(),
        tanggal: body.tanggal || '',
        selesai: false,
        createdBy: me.id,
        createdAt: new Date().toISOString()
      };
      DB.timeline.push(t);
      saveDBDebounced();
      return sendJSON(res, 200, { timeline: t });
    }
    if (method === 'PUT' && tid) {
      const t = DB.timeline.find(x => x.id === tid);
      if (!t) return sendJSON(res, 404, { error: 'Tidak ditemukan' });
      const body = await readBody(req);
      if (body.judul !== undefined) t.judul = String(body.judul);
      if (body.tanggal !== undefined) t.tanggal = body.tanggal;
      if (body.selesai !== undefined) t.selesai = !!body.selesai;
      saveDBDebounced();
      return sendJSON(res, 200, { timeline: t });
    }
    if (method === 'DELETE' && tid) {
      DB.timeline = DB.timeline.filter(x => x.id !== tid);
      saveDBDebounced();
      return sendJSON(res, 200, { ok: true });
    }
  }

  // ================= UJIAN (dosen: mahasiswa yang akan diuji) =================
  if (seg[0] === 'ujian' && method === 'GET') {
    if (me.role !== 'dosen' && me.role !== 'admin' && me.role !== 'kaprodi') return sendJSON(res, 403, { error: 'Akses ditolak' });
    const JENIS = { proposal: 'Ujian Seminar Proposal', hasil: 'Ujian Seminar Hasil', tutup: 'Ujian Seminar Tutup', promosi: 'Ujian Promosi Doktor' };
    const meName = String(me.nama || '').trim().toLowerCase();
    const out = [];
    DB.skripsi.forEach(s => {
      if (!s.ujian) return;
      const mhs = DB.users.find(u => u.id === s.mahasiswaId);
      Object.keys(s.ujian).forEach(jns => {
        const u = s.ujian[jns];
        if (!u || !u.tanggal) return;
        const penguji = Array.isArray(u.penguji) ? u.penguji : [];
        const asProm = s.pembimbing1 === me.id;
        const asCoprom = s.pembimbing2 === me.id;
        const asPenguji = penguji.some(n => String(n).trim().toLowerCase() === meName);
        if (!(me.role === 'admin' || me.role === 'kaprodi' || asProm || asCoprom || asPenguji)) return;
        out.push({
          mahasiswaId: s.mahasiswaId,
          mahasiswaNama: mhs ? mhs.nama : '-',
          mahasiswaNim: mhs ? mhs.username : '-',
          prodi: mhs ? mhs.prodi : '',
          judul: s.judul || '',
          jenis: jns, jenisLabel: JENIS[jns] || jns,
          tanggal: u.tanggal, metode: u.metode || '', link: u.link || '', tempat: u.tempat || '',
          penguji,
          peran: asProm ? 'Promotor' : (asCoprom ? 'Co-Promotor' : (asPenguji ? 'Penguji' : '-'))
        });
      });
    });
    out.sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || ''));
    return sendJSON(res, 200, { ujian: out });
  }

  // ================= VALIDASI INSTRUMEN (validator) =================
  if (seg[0] === 'validasi' && method === 'GET') {
    if (me.role !== 'validator' && me.role !== 'admin' && me.role !== 'kaprodi') return sendJSON(res, 403, { error: 'Akses ditolak' });
    const out = [];
    DB.skripsi.forEach(s => {
      if (s.lulus) return;
      if (me.role === 'validator' && s.validatorId && s.validatorId !== me.id) return;
      const ready = faseAccReady(s.mahasiswaId, 'Instrumen');
      if (!ready && !(s.instrumen && s.instrumen.status)) return; // tampilkan bila siap divalidasi atau sudah ada hasil
      const mhs = DB.users.find(u => u.id === s.mahasiswaId);
      out.push({
        mahasiswaId: s.mahasiswaId,
        mahasiswaNama: mhs ? mhs.nama : '-',
        mahasiswaNim: mhs ? mhs.username : '-',
        prodi: mhs ? mhs.prodi : '',
        judul: s.judul || '',
        promotor: namaUser(s.pembimbing1), copromotor: namaUser(s.pembimbing2),
        ready, instrumen: s.instrumen || null, validatorId: s.validatorId || ''
      });
    });
    out.sort((a, b) => Number(!!(b.instrumen && b.instrumen.status === 'valid')) - Number(!!(a.instrumen && a.instrumen.status === 'valid')));
    return sendJSON(res, 200, { validasi: out });
  }

  // ================= PENGATURAN (admin) =================
  if (seg[0] === 'settings') {
    if (seg[1] === 'validator') {
      if (method === 'GET') return sendJSON(res, 200, { defaultValidator: DB.meta.defaultValidator || '' });
      if (method === 'POST') {
        if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
        const body = await readBody(req);
        DB.meta.defaultValidator = String(body.validatorId || '');
        saveDBDebounced();
        return sendJSON(res, 200, { defaultValidator: DB.meta.defaultValidator });
      }
    }
  }

  // ================= PEMELIHARAAN PENYIMPANAN (admin) =================
  if (seg[0] === 'maintenance') {
    if (me.role !== 'admin') return sendJSON(res, 403, { error: 'Hanya admin' });
    const listUploads = () => { try { return fs.readdirSync(UPLOAD_DIR); } catch (e) { return []; } };
    if (seg[1] === 'storage' && method === 'GET') {
      const referenced = new Set([
        ...DB.documents.map(d => path.basename(d.file || '')),
        ...DB.users.filter(u => typeof u.foto === 'string' && u.foto.startsWith('/uploads/')).map(u => path.basename(u.foto))
      ]);
      let totalBytes = 0, orphanCount = 0, orphanBytes = 0, fileCount = 0;
      listUploads().forEach(f => {
        let st; try { st = fs.statSync(path.join(UPLOAD_DIR, f)); } catch (e) { return; }
        if (!st.isFile()) return;
        fileCount++; totalBytes += st.size;
        if (!referenced.has(f)) { orphanCount++; orphanBytes += st.size; }
      });
      return sendJSON(res, 200, { fileCount, totalBytes, docCount: DB.documents.length, orphanCount, orphanBytes });
    }
    if (seg[1] === 'cleanup' && method === 'POST') {
      const referenced = new Set([
        ...DB.documents.map(d => path.basename(d.file || '')),
        ...DB.users.filter(u => typeof u.foto === 'string' && u.foto.startsWith('/uploads/')).map(u => path.basename(u.foto))
      ]);
      let removed = 0, freed = 0;
      listUploads().forEach(f => {
        if (referenced.has(f)) return;
        const p = path.join(UPLOAD_DIR, f);
        try { const st = fs.statSync(p); if (st.isFile()) { freed += st.size; fs.unlinkSync(p); removed++; } } catch (e) {}
      });
      return sendJSON(res, 200, { removed, freed });
    }
  }

  // ================= STATISTIK (kaprodi/admin) =================
  if (seg[0] === 'stats' && method === 'GET') {
    if (me.role !== 'kaprodi' && me.role !== 'admin') return sendJSON(res, 403, { error: 'Akses ditolak' });
    const TARGET = (DB.meta && DB.meta.targetBimbingan) || 8; // target minimum bimbingan
    const mahasiswa = DB.users.filter(u => u.role === 'mahasiswa');
    const perMhs = DB.skripsi.map(s => {
      const u = DB.users.find(x => x.id === s.mahasiswaId) || {};
      const sesi = DB.bimbingan.filter(b => b.mahasiswaId === s.mahasiswaId)
        .slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      // Tiap revisi (entri selain pengajuan) dihitung 1 bimbingan
      const pengajuan = sesi.find(b => b.dibuatOleh === 'mahasiswa') || sesi.find(b => !b.dibuatOleh);
      const revisi = sesi.filter(b => b !== pengajuan);
      const last = revisi[revisi.length - 1] || sesi[sesi.length - 1];
      const selesai = revisi.filter(b => b.status === 'acc' || b.status === 'selesai').length;
      const jml = revisi.length;
      return {
        mahasiswaId: s.mahasiswaId,
        nama: u.nama || '-',
        username: u.username || '-',
        tahunMasuk: u.tahunMasuk || '-',
        prodi: u.prodi || '-',
        judul: s.judul || '(belum ada judul)',
        pembimbing1: (DB.users.find(x => x.id === s.pembimbing1) || {}).nama || '-',
        pembimbing2: (DB.users.find(x => x.id === s.pembimbing2) || {}).nama || '-',
        jmlBimbingan: jml,
        bimbinganSelesai: selesai,
        target: TARGET,
        progres: Math.min(100, Math.round(jml / TARGET * 100)),
        lastTanggal: last ? last.tanggal : '',
        lastTopik: last ? last.topik : '',
        updatedAt: s.updatedAt
      };
    });
    return sendJSON(res, 200, {
      ringkasan: {
        totalMahasiswa: mahasiswa.length,
        totalDosen: DB.users.filter(u => u.role === 'dosen').length,
        rataBimbingan: perMhs.length ? Math.round((perMhs.reduce((a, b) => a + b.jmlBimbingan, 0) / perMhs.length) * 10) / 10 : 0,
        rataProgres: perMhs.length ? Math.round(perMhs.reduce((a, b) => a + b.progres, 0) / perMhs.length) : 0,
        targetBimbingan: TARGET,
        totalBimbingan: perMhs.reduce((a, b) => a + b.jmlBimbingan, 0)
      },
      mahasiswa: perMhs.sort((a, b) => a.progres - b.progres)
    });
  }

  return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan' });
}

function canAccessMahasiswa(me, mahasiswaId) {
  if (me.role === 'admin' || me.role === 'kaprodi') return true;
  if (me.role === 'mahasiswa') return me.id === mahasiswaId;
  if (me.role === 'dosen') {
    const s = DB.skripsi.find(x => x.mahasiswaId === mahasiswaId);
    return s && (s.pembimbing1 === me.id || s.pembimbing2 === me.id);
  }
  if (me.role === 'validator') {
    const s = DB.skripsi.find(x => x.mahasiswaId === mahasiswaId);
    return s && (!s.validatorId || s.validatorId === me.id);
  }
  return false;
}

function guessExt(mime) {
  const map = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
  return map[mime] || '.bin';
}

// ------------------------------------------------------------------
// Keamanan: header, rate limiting, anti brute-force, same-origin (CSRF)
// ------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'"
].join('; ');

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // aktif saat via HTTPS
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Rate limit global per-IP (jendela geser sederhana) — mitigasi DoS/flooding
const RL_WINDOW_MS = 10 * 1000, RL_MAX = 150;
const rlHits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  let e = rlHits.get(ip);
  if (!e || e.reset < now) { e = { count: 0, reset: now + RL_WINDOW_MS }; rlHits.set(ip, e); }
  e.count++;
  return e.count > RL_MAX;
}

// Anti brute-force login: kunci sementara per-IP setelah beberapa kegagalan
const LOGIN_MAX_FAIL = 6, LOGIN_WINDOW_MS = 15 * 60 * 1000, LOGIN_BLOCK_MS = 10 * 60 * 1000;
const loginFails = new Map();
function loginBlocked(ip) { const e = loginFails.get(ip); return !!(e && e.blockUntil && e.blockUntil > Date.now()); }
function recordLoginFail(ip) {
  const now = Date.now();
  let e = loginFails.get(ip);
  if (!e || (now - e.first) > LOGIN_WINDOW_MS) e = { fails: 0, first: now, blockUntil: 0 };
  e.fails++;
  if (e.fails >= LOGIN_MAX_FAIL) e.blockUntil = now + LOGIN_BLOCK_MS;
  loginFails.set(ip, e);
}
function resetLoginFail(ip) { loginFails.delete(ip); }

// Pembersihan berkala agar map tidak tumbuh tak terbatas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rlHits) if (v.reset < now) rlHits.delete(k);
  for (const [k, v] of loginFails) if ((v.blockUntil || (v.first + LOGIN_WINDOW_MS)) < now) loginFails.delete(k);
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t);
}, 60 * 1000).unref();

// Tolak permintaan pengubah data dari origin berbeda (mitigasi CSRF, defense-in-depth)
function sameOriginOk(req, url) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const origin = req.headers['origin'];
  if (!origin) return true; // non-browser tanpa Origin — token tetap wajib
  try { return new URL(origin).host === (req.headers['host'] || url.host); } catch (e) { return false; }
}

// ------------------------------------------------------------------
// Server
// ------------------------------------------------------------------

function requestHandler(req, res) {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = clientIp(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }
  if (rateLimited(ip)) return sendJSON(res, 429, { error: 'Terlalu banyak permintaan. Coba lagi beberapa saat.' });
  if (url.pathname.startsWith('/api/')) {
    if (!sameOriginOk(req, url)) return sendJSON(res, 403, { error: 'Permintaan lintas-situs ditolak' });
    handleApi(req, res, url, ip).catch(err => {
      console.error('API error:', err);
      sendJSON(res, 500, { error: err.message || 'Kesalahan server' });
    });
    return;
  }
  serveStatic(req, res, url.pathname);
}

// Batas waktu untuk mengurangi serangan lambat (slowloris) & kebocoran koneksi
function applyTimeouts(s) {
  s.requestTimeout = 30 * 1000;
  s.headersTimeout = 20 * 1000;
  s.keepAliveTimeout = 10 * 1000;
  s.maxHeadersCount = 100;
}

const httpServer = http.createServer(requestHandler);
applyTimeouts(httpServer);

// HTTPS opsional: aktif otomatis bila sertifikat tersedia (anti-MitM)
const TLS_KEY = process.env.TLS_KEY || path.join(ROOT, 'certs', 'key.pem');
const TLS_CERT = process.env.TLS_CERT || path.join(ROOT, 'certs', 'cert.pem');
const TLS_PFX = process.env.TLS_PFX || path.join(ROOT, 'certs', 'cert.pfx');
const TLS_PFX_PASS_FILE = path.join(ROOT, 'certs', 'pfx-pass.txt');
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT, 10) || 5443;
let httpsServer = null;
let tlsOptions = null;
if (fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CERT)) {
  tlsOptions = { key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) };
} else if (fs.existsSync(TLS_PFX)) {
  const pass = process.env.TLS_PFX_PASS || (fs.existsSync(TLS_PFX_PASS_FILE) ? fs.readFileSync(TLS_PFX_PASS_FILE, 'utf8').trim() : '');
  tlsOptions = { pfx: fs.readFileSync(TLS_PFX), passphrase: pass };
}
if (tlsOptions) {
  try {
    httpsServer = https.createServer(tlsOptions, requestHandler);
    applyTimeouts(httpsServer);
  } catch (e) { console.error('Gagal memuat sertifikat TLS:', e.message); httpsServer = null; }
}

(async () => {
  try {
    await loadDB();
  } catch (e) {
    console.error('Gagal inisialisasi database:', e);
    process.exit(1);
  }
  httpServer.listen(PORT, HOST, () => {
    console.log('===================================================');
    console.log('  DoctoralSync — Sistem Bimbingan Disertasi berjalan');
    console.log('  HTTP    : http://localhost:' + PORT);
    if (httpsServer) console.log('  HTTPS   : https://localhost:' + HTTPS_PORT + '  (disarankan, anti-MitM)');
    else console.log('  HTTPS   : nonaktif — jalankan "buat-sertifikat.cmd" lalu restart untuk mengaktifkan');
    console.log('  Jaringan: http://<IP-Anda>:' + PORT);
    console.log('  Login default admin -> admin / admin123');
    console.log('  Penyimpanan: ' + (USE_PG ? 'PostgreSQL (DATABASE_URL)' : 'file data/db.json'));
    console.log('  Notifikasi WA: ' + (WA_API_URL ? ('AKTIF -> ' + WA_API_URL) : 'nonaktif (set WA_API_URL / jalankan wa-server)'));
    console.log('===================================================');
  });
  if (httpsServer) httpsServer.listen(HTTPS_PORT, HOST, () => console.log('  [HTTPS aktif] https://localhost:' + HTTPS_PORT));
})();
