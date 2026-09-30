// ==================================================================
// Aplikasi Bimbingan Disertasi - logika frontend (vanilla JS)
// ==================================================================
'use strict';

const API = '/api';
let TOKEN = localStorage.getItem('bs_token') || '';
let ME = null;           // user login
let USERS_CACHE = [];    // cache daftar user (untuk nama pembimbing/dosen)
let PRODI_CACHE = [];    // cache master program studi (untuk pemilih di form)

// ---------------- HTTP helper ----------------
async function api(pathName, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + pathName, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (res.status === 401 && ME) { doLogout(); }
    throw new Error(data.error || 'Terjadi kesalahan (' + res.status + ')');
  }
  return data;
}

// ---------------- Util ----------------
const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach(c => { if (c != null) n.append(c.nodeType ? c : document.createTextNode(c)); });
  return n;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const fmtDateTime = d => d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
// Jenis ujian doktor (berjenjang). fase = syarat ACC bimbingan yang harus terpenuhi.
const UJIAN_TYPES = [
  { key: 'proposal', label: 'Ujian Seminar Proposal', fase: 'Proposal', nextFase: 'Hasil', nextLabel: 'Seminar Hasil' },
  { key: 'hasil', label: 'Ujian Seminar Hasil', fase: 'Hasil', nextFase: 'Tutup', nextLabel: 'Seminar Tutup' },
  { key: 'tutup', label: 'Ujian Seminar Tutup', fase: 'Tutup', nextFase: 'Promosi', nextLabel: 'Promosi Doktor' },
  { key: 'promosi', label: 'Ujian Promosi Doktor', fase: 'Promosi', nextFase: null, nextLabel: null }
];
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const roleLabel = r => ({ mahasiswa: 'Mahasiswa', dosen: 'Dosen', admin: 'Admin Prodi', kaprodi: 'Ketua Prodi' }[r] || r);
const statusLabel = s => ({ diajukan: 'diajukan', disetujui: 'disetujui', dijadwalkan: 'dijadwalkan', revisi: (ME && ME.role === 'mahasiswa') ? 'perlu revisi' : 'belum direvisi', direvisi: 'sudah direvisi', acc: 'ACC', selesai: 'selesai', batal: 'batal' }[s] || s);
const userName = id => (USERS_CACHE.find(u => u.id === id) || {}).nama || '-';
const userObj = id => USERS_CACHE.find(u => u.id === id) || null;
// Nomor identitas (NIM mahasiswa / NUPTK dosen) tersimpan pada field username
const userNomor = id => (USERS_CACHE.find(u => u.id === id) || {}).username || '';
const nomorSuffix = (id, label) => { const n = userNomor(id); return n ? ' · ' + label + ' ' + esc(n) : ''; };

function readFileDataUrl(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

function toast(msg, type) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.hidden = false;
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.hidden = true; }, 2800);
}

// ---------------- Modal ----------------
const modalStack = [];
function openModal(title, bodyNode, opts) {
  opts = opts || {};
  if (typeof opts.back === 'function') modalStack.push(opts.back); else modalStack.length = 0;
  $('#modalTitle').textContent = title;
  const card = document.querySelector('#modal .modal-card');
  if (card) card.classList.toggle('wide', !!opts.wide);
  const body = $('#modalBody');
  body.innerHTML = '';
  body.append(bodyNode);
  $('#modal').hidden = false;
}
function closeModal() {
  if (modalStack.length) { const back = modalStack.pop(); back(); return; }
  $('#modal').hidden = true;
}
document.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) closeModal(); });

// Penampil dokumen di dalam aplikasi (PDF via iframe, gambar via img) + tombol layar penuh
function pdfViewer(src) {
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(src);
  const media = isImg
    ? el('img', { src, style: 'max-width:100%;display:block;margin:0 auto' })
    : el('iframe', { src, style: 'width:100%;height:65vh;border:none;display:block;background:#fff' });
  const wrap = el('div', { class: 'pdf-wrap' });
  const fsBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => toggleFullscreen(wrap) }, '⛶ Layar Penuh');
  wrap.append(el('div', { class: 'pdf-bar' }, fsBtn), media);
  wrap.addEventListener('fullscreenchange', () => {
    fsBtn.textContent = document.fullscreenElement === wrap ? '✕ Keluar Layar Penuh' : '⛶ Layar Penuh';
  });
  return wrap;
}
function toggleFullscreen(elm) {
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  const req = elm.requestFullscreen || elm.webkitRequestFullscreen || elm.msRequestFullscreen;
  if (req) req.call(elm);
  else toast('Peramban tidak mendukung layar penuh', 'err');
}
function openPdfModal(doc) {
  openModal(doc.nama, pdfViewer(doc.file), { wide: true });
}
// Blok dokumen dengan tombol Lihat/Sembunyikan (file tersembunyi default, dimuat saat diklik)
function docToggleBlock(doc, onBack) {
  const holder = el('div', { style: 'margin-top:8px' });
  holder.hidden = true;
  let loaded = false;
  const btn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    holder.hidden = !holder.hidden;
    if (!holder.hidden && !loaded) { holder.append(pdfViewer(doc.file)); loaded = true; }
    btn.textContent = holder.hidden ? '👁️ Lihat File' : '🙈 Sembunyikan File';
  } }, '👁️ Lihat File');
  const nCat = (doc.catatan || []).length, nAno = (doc.anotasi || []).length;
  const annoBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openDocAnnotator(doc, onBack) },
    '✍️ Tanda & Catatan' + (nCat ? ' · 💬' + nCat : '') + (nAno ? ' · ✏️' + nAno : ''));
  return el('div', { class: 'field' }, el('label', {}, '📄 ' + esc(doc.nama)),
    el('div', { class: 'row', style: 'gap:8px' }, btn, annoBtn), holder);
}

// Penanda (coretan/stabilo) + catatan teks pada dokumen; dua arah dosen & mahasiswa
function openDocAnnotator(doc, onBack) {
  const canEdit = ME.role === 'mahasiswa' || ME.role === 'dosen' || ME.role === 'admin';
  const isPdf = /\.pdf$/i.test(doc.file);
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(doc.file);
  const strokes = Array.isArray(doc.anotasi) ? doc.anotasi.map(s => JSON.parse(JSON.stringify(s))) : [];
  const overlays = [];
  let tool = 'pen', color = '#e11d48', cur = null, dirty = false;

  function drawStroke(ctx, s, W, H) {
    if (s.tool === 'pin' || !s.pts || !s.pts.length) return;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = s.color || '#e11d48';
    ctx.lineWidth = Math.max(1, (s.w || 0.004) * W);
    if (s.tool === 'hl') ctx.globalAlpha = 0.32;
    ctx.beginPath();
    s.pts.forEach((p, i) => { const x = p[0] * W, y = p[1] * H; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * W + 0.5, s.pts[0][1] * H);
    ctx.stroke();
    ctx.restore();
  }
  function redrawPage(pi) {
    const o = overlays[pi]; if (!o) return;
    o.octx.clearRect(0, 0, o.over.width, o.over.height);
    strokes.forEach(s => { if (s.page === pi) drawStroke(o.octx, s, o.over.width, o.over.height); });
    if (cur && cur.page === pi) drawStroke(o.octx, cur, o.over.width, o.over.height);
  }
  function redrawAll() { overlays.forEach((o, i) => { if (o) { redrawPage(i); renderPins(i); } }); }

  // --- Pin catatan (tanda berisi catatan pada titik dokumen) ---
  function renderPins(pi) {
    const o = overlays[pi]; if (!o || !o.pins) return;
    o.pins.innerHTML = '';
    strokes.forEach(s => {
      if (s.tool !== 'pin' || s.page !== pi) return;
      o.pins.append(el('button', { class: 'anno-pin pin-' + (s.olehRole || 'dosen'), style: `left:${s.x * 100}%;top:${s.y * 100}%`, title: s.teks,
        onclick: (ev) => { ev.stopPropagation(); showPinPopup(pi, s); } }, '📌'));
    });
  }
  function showPinPopup(pi, s) {
    const o = overlays[pi]; if (!o) return;
    o.pins.querySelectorAll('.anno-pin-pop').forEach(p => p.remove());
    const canDel = ME.role !== 'mahasiswa' || s.oleh === ME.id;
    const pop = el('div', { class: 'anno-pin-pop', style: `left:${s.x * 100}%;top:${s.y * 100}%` },
      el('div', { class: 'meta' }, el('span', { class: 'badge ' + s.olehRole }, roleLabel(s.olehRole)), el('b', {}, esc(s.olehNama || '-')),
        el('span', { class: 'muted small', style: 'margin-left:auto' }, fmtDateTime(s.createdAt))),
      el('div', { style: 'margin:4px 0 6px' }, esc(s.teks)),
      el('div', { class: 'row', style: 'gap:6px' },
        canDel ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => removePin(pi, s) }, '🗑️ Hapus') : null,
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => pop.remove() }, 'Tutup')));
    o.pins.append(pop);
  }
  async function persistAnotasi() {
    try { await api('/documents/' + doc.id + '/anotasi', { method: 'PUT', body: { anotasi: strokes } });
      doc.anotasi = strokes.map(s => JSON.parse(JSON.stringify(s))); dirty = false; return true; }
    catch (ex) { toast(ex.message, 'err'); return false; }
  }
  async function removePin(pi, s) {
    const idx = strokes.indexOf(s); if (idx >= 0) strokes.splice(idx, 1);
    renderPins(pi); if (await persistAnotasi()) toast('Tanda dihapus', 'ok');
  }
  function addPin(pi, x, y) {
    const o = overlays[pi]; if (!o) return;
    o.pins.querySelectorAll('.anno-pin-pop').forEach(p => p.remove());
    const ta = el('textarea', { rows: 2, placeholder: 'Catatan untuk tanda ini…', style: 'width:100%;margin:0 0 6px' });
    const pop = el('div', { class: 'anno-pin-pop', style: `left:${x * 100}%;top:${y * 100}%` }, ta,
      el('div', { class: 'row', style: 'gap:6px' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
          const teks = ta.value.trim(); if (!teks) return toast('Catatan kosong', 'err');
          strokes.push({ id: 'pin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tool: 'pin', page: pi, x, y, teks,
            oleh: ME.id, olehNama: ME.nama, olehRole: ME.role, createdAt: new Date().toISOString() });
          renderPins(pi); if (await persistAnotasi()) toast('Tanda catatan ditambahkan', 'ok');
        } }, '✔ Simpan'),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => pop.remove() }, 'Batal')));
    o.pins.append(pop);
    setTimeout(() => ta.focus(), 30);
  }

  function wireDraw(pi, over) {
    over.style.touchAction = 'none';
    const posOf = e => { const r = over.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    over.addEventListener('pointerdown', e => {
      if (!canEdit) return;
      if (tool === 'pin') { const p = posOf(e); addPin(pi, p[0], p[1]); return; }
      try { over.setPointerCapture(e.pointerId); } catch (x) {}
      cur = { page: pi, tool, color, w: tool === 'hl' ? 0.022 : 0.004, pts: [posOf(e)], oleh: ME.id, olehRole: ME.role };
      redrawPage(pi);
    });
    over.addEventListener('pointermove', e => { if (!cur || cur.page !== pi) return; cur.pts.push(posOf(e)); redrawPage(pi); });
    const end = () => { if (!cur) return; if (cur.pts.length) { strokes.push(cur); dirty = true; } cur = null; };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);
  }

  function addPage(pi, w, h, renderFn) {
    const holder = el('div', { class: 'anno-page', style: `width:${Math.round(w)}px;height:${Math.round(h)}px` });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = el('canvas', { class: 'anno-base' });
    base.width = Math.floor(w * dpr); base.height = Math.floor(h * dpr); base.style.width = w + 'px'; base.style.height = h + 'px';
    const bctx = base.getContext('2d'); bctx.scale(dpr, dpr);
    const over = el('canvas', { class: 'anno-over' });
    over.width = Math.round(w); over.height = Math.round(h); over.style.width = w + 'px'; over.style.height = h + 'px';
    const pins = el('div', { class: 'anno-pins' });
    holder.append(base, over, pins);
    pagesWrap.append(holder);
    overlays[pi] = { over, octx: over.getContext('2d'), w, h, pins };
    wireDraw(pi, over);
    Promise.resolve(renderFn(bctx)).then(() => { redrawPage(pi); renderPins(pi); }).catch(() => {});
  }

  async function render() {
    pagesWrap.innerHTML = ''; overlays.length = 0;
    const maxW = Math.min((pagesWrap.clientWidth || 760) - 4, 900);
    if (isPdf && window.pdfjsLib) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ url: doc.file }).promise;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const b = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: Math.max(maxW / b.width, 0.2) });
          addPage(n - 1, vp.width, vp.height, (ctx) => page.render({ canvasContext: ctx, viewport: vp }).promise);
        }
      } catch (ex) { pagesWrap.append(el('div', { class: 'empty' }, 'Gagal memuat PDF.')); }
    } else if (isImg) {
      await new Promise(res => {
        const im = new Image();
        im.onload = () => { const scale = Math.min(maxW / im.naturalWidth, 1.5); const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
          addPage(0, w, h, (ctx) => ctx.drawImage(im, 0, 0, w, h)); res(); };
        im.onerror = () => { pagesWrap.append(el('div', { class: 'empty' }, 'Gagal memuat gambar.')); res(); };
        im.src = doc.file;
      });
    } else {
      pagesWrap.append(el('div', { class: 'empty' }, 'Pratinjau tidak tersedia untuk berkas ini. Anda tetap bisa menambah catatan teks.'));
    }
    redrawAll();
  }

  // Toolbar tanda
  const bar = el('div', { class: 'anno-bar' });
  const penBtn = el('button', { class: 'btn btn-sm anno-tool active', onclick: () => setTool('pen', penBtn) }, '🖊️ Pena');
  const hlBtn = el('button', { class: 'btn btn-sm anno-tool', onclick: () => setTool('hl', hlBtn) }, '🖍️ Stabilo');
  const pinBtn = el('button', { class: 'btn btn-sm anno-tool', onclick: () => setTool('pin', pinBtn) }, '📌 Pin Catatan');
  const colorInp = el('input', { type: 'color', value: color, style: 'width:42px;height:34px;padding:2px;margin:0', onchange: e => { color = e.target.value; } });
  const undoBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { for (let i = strokes.length - 1; i >= 0; i--) { if (strokes[i].tool !== 'pin' && strokes[i].oleh === ME.id) { strokes.splice(i, 1); break; } } dirty = true; redrawAll(); } }, '↩️ Undo');
  const clearBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const n = strokes.length; for (let i = strokes.length - 1; i >= 0; i--) { if (strokes[i].tool !== 'pin' && strokes[i].oleh === ME.id) strokes.splice(i, 1); } if (strokes.length !== n) { dirty = true; redrawAll(); } } }, '🗑️ Bersihkan');
  const saveBtn = el('button', { class: 'btn btn-gold btn-sm', onclick: saveAnotasi }, '💾 Simpan Tanda');
  function setTool(t, btnEl) { tool = t; bar.querySelectorAll('.anno-tool').forEach(b => b.classList.remove('active')); btnEl.classList.add('active'); }
  async function saveAnotasi() {
    if (await persistAnotasi()) toast('Tanda tersimpan', 'ok');
  }
  const fsBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => toggleFullscreen(viewer) }, '⛶ Layar Penuh');
  if (canEdit) bar.append(penBtn, hlBtn, pinBtn, colorInp, undoBtn, clearBtn, saveBtn);
  bar.append(fsBtn);
  bar.append(el('span', { class: 'pin-legend' },
    el('span', { class: 'pin-dot pin-dosen' }, '●'), 'Dosen',
    el('span', { class: 'pin-dot pin-mahasiswa' }, '●'), 'Mahasiswa'));

  const pagesWrap = el('div', { class: 'anno-pages' });
  const wrap = el('div', { class: 'anno-wrap' }, pagesWrap);
  const viewer = el('div', { class: 'anno-viewer' }, bar, wrap);

  // Catatan teks
  const notesList = el('div', { class: 'anno-notes-list' });
  function renderNotes() {
    notesList.innerHTML = '';
    const list = (doc.catatan || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    if (!list.length) { notesList.append(el('div', { class: 'muted small' }, 'Belum ada catatan.')); return; }
    list.forEach(n => {
      const note = el('div', { class: 'anno-note' },
        el('div', { class: 'meta' },
          el('span', { class: 'badge ' + n.olehRole }, roleLabel(n.olehRole)),
          el('b', {}, esc(n.olehNama || '-')),
          el('span', { style: 'flex:1' }, ''),
          el('span', { class: 'muted small' }, fmtDateTime(n.createdAt))),
        el('div', {}, esc(n.teks)));
      if (ME.role === 'admin' || n.oleh === ME.id) {
        note.append(el('button', { class: 'btn btn-danger btn-sm', style: 'margin-top:6px', onclick: async () => {
          try { await api('/documents/' + doc.id + '/catatan/' + n.id, { method: 'DELETE' });
            doc.catatan = (doc.catatan || []).filter(x => x.id !== n.id); renderNotes(); toast('Catatan dihapus', 'ok'); }
          catch (ex) { toast(ex.message, 'err'); }
        } }, '🗑️ Hapus'));
      }
      notesList.append(note);
    });
  }
  const notesBox = el('div', { class: 'anno-notes' }, el('h4', { style: 'margin:0 0 8px' }, '💬 Catatan Dokumen'), notesList);
  if (canEdit) {
    const ta = el('textarea', { rows: 2, placeholder: 'Tulis catatan untuk dokumen ini…' });
    notesBox.append(el('div', { class: 'field', style: 'margin-top:8px' }, ta),
      el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
        if (!ta.value.trim()) return toast('Catatan kosong', 'err');
        try { const r = await api('/documents/' + doc.id + '/catatan', { method: 'POST', body: { teks: ta.value.trim() } });
          doc.catatan = doc.catatan || []; doc.catatan.push(r.catatan); ta.value = ''; renderNotes(); toast('Catatan terkirim', 'ok'); }
        catch (ex) { toast(ex.message, 'err'); }
      } }, '➤ Kirim Catatan'));
  }

  const body = el('div', {}, viewer);
  viewer.append(notesBox);
  openModal('✍️ Tanda & Catatan — ' + esc(doc.nama), body, { wide: true, back: onBack });
  renderNotes();
  render();
}

// ==================================================================
// AUTH
// ==================================================================
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginError'); err.hidden = true;
  try {
    const data = await api('/login', { method: 'POST', body: { username: $('#loginUser').value, password: $('#loginPass').value } });
    TOKEN = data.token; localStorage.setItem('bs_token', TOKEN);
    ME = data.user;
    await startApp();
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  }
});

$('#btnLogout').addEventListener('click', doLogout);
function doLogout() {
  api('/logout', { method: 'POST' }).catch(() => {});
  TOKEN = ''; ME = null; localStorage.removeItem('bs_token');
  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginForm').reset();
}

async function startApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#userName').textContent = ME.nama;
  refreshTopbarAvatar();
  const rb = $('#userRole'); rb.textContent = roleLabel(ME.role); rb.className = 'badge ' + ME.role;
  // filter menu sesuai role
  document.querySelectorAll('.nav-item').forEach(a => {
    const roles = a.getAttribute('data-role');
    a.hidden = roles ? !roles.split(',').includes(ME.role) : false;
  });
  // Menu "Dashboard" tampil sebagai "Profil" untuk mahasiswa & dosen
  const dashNav = document.querySelector('.nav-item[data-view="dashboard"]');
  if (dashNav) dashNav.textContent = (ME.role === 'mahasiswa' || ME.role === 'dosen') ? '👤 Profil' : '📊 Dashboard';
  // muat cache user bila boleh
  try { const d = await api('/users'); USERS_CACHE = d.users; } catch (e) { USERS_CACHE = [ME]; }
  navigate('dashboard');
}

// ---------------- Navigasi ----------------
document.querySelectorAll('.nav-item').forEach(a => {
  a.addEventListener('click', () => { navigate(a.dataset.view); closeSidebar(); });
});
function navigate(view) {
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const c = $('#mainContent');
  c.innerHTML = '<div class="empty">Memuat…</div>';
  const fn = VIEWS[view] || VIEWS.dashboard;
  fn(c).catch(ex => { c.innerHTML = ''; c.append(el('div', { class: 'empty error' }, ex.message)); });
}

// sidebar mobile
$('#menuToggle').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebarBackdrop').hidden = !$('#sidebar').classList.contains('open'); });
$('#sidebarBackdrop').addEventListener('click', closeSidebar);
function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').hidden = true; }

function pageHead(title, ...actions) {
  return el('div', { class: 'page-head' }, el('h2', {}, title), el('div', { class: 'spacer' }), ...actions);
}

// ==================================================================
// VIEWS
// ==================================================================
const VIEWS = {};

// ---------------- DASHBOARD / PROFIL ----------------
VIEWS.dashboard = async (c) => {
  c.innerHTML = '';
  const isProfil = ME.role === 'mahasiswa' || ME.role === 'dosen';
  c.append(pageHead(isProfil ? 'Profil Saya' : 'Dashboard'));

  if (ME.role === 'mahasiswa') {
    const { skripsi } = await api('/skripsi/' + ME.id).catch(() => ({ skripsi: null }));
    c.append(profilCard());
    const judul = skripsi && skripsi.judul ? skripsi.judul : '(Judul belum ditetapkan)';
    const profilJudulCard = el('div', { class: 'card judul-card mt', style: 'cursor:pointer', onclick: () => navigate('bimbingan') },
      el('div', { class: 'jc-body' },
        el('span', { class: 'judul-kicker' }, '🎓 Judul Disertasi'),
        el('div', { class: 'judul-title' }, judul),
        el('div', { class: 'judul-meta' },
          el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '1'), 'Promotor: ' + esc(userName(skripsi?.pembimbing1))),
          el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '2'), 'Co-Promotor: ' + esc(userName(skripsi?.pembimbing2)))),
        el('div', { class: 'muted small', style: 'margin-top:8px;color:var(--primary)' }, 'Klik untuk membuka bimbingan →')
      ));
    const pjblk = judulUsulanBlock(skripsi, ME.id); if (pjblk) profilJudulCard.append(pjblk);
    c.append(profilJudulCard);
  } else if (ME.role === 'dosen') {
    c.append(profilCard());
    const { skripsi } = await api('/skripsi');
    const { bimbingan } = await api('/bimbingan');
    const box = el('div', { class: 'card mt' }, el('h3', {}, '📖 Mahasiswa Bimbingan Anda'));
    if (!skripsi.length) box.append(el('div', { class: 'empty' }, 'Belum ada mahasiswa bimbingan.'));
    skripsi.forEach(s => {
      const mine = bimbingan.filter(b => b.mahasiswaId === s.mahasiswaId);
      const jml = revisiOf(mine).length;
      const needAtt = mine.filter(b => b.status === 'direvisi' || b.status === 'diajukan').length;
      box.append(el('div', { class: 'list-item' + (needAtt ? ' attn' : ''), style: 'cursor:pointer', onclick: () => openSkripsiDetail(s.mahasiswaId) },
        el('div', { class: 'row-between' },
          el('b', {}, esc(s.mahasiswa?.nama || '-')),
          el('span', { class: 'row', style: 'gap:8px' },
            needAtt ? el('span', { class: 'attn-badge', title: 'Ada balasan/revisi atau pengajuan baru dari mahasiswa' }, '💬 ' + needAtt + ' perlu ditindak') : null,
            el('span', { class: 'muted small' }, jml + ' bimbingan'))),
        el('div', { class: 'muted small', style: 'margin:4px 0 0' }, esc(s.judul || '(belum ada judul)'))));
    });
    c.append(box);
  } else { // admin / kaprodi
    const { ringkasan, mahasiswa } = await api('/stats');
    c.append(el('div', { class: 'grid grid-stats' },
      statCard(ringkasan.totalMahasiswa, 'Mahasiswa'),
      statCard(ringkasan.totalDosen, 'Dosen'),
      statCard(ringkasan.rataProgres + '%', 'Rata-rata Progres'),
      statCard(ringkasan.totalBimbingan, 'Total Bimbingan')
    ));
    const box = el('div', { class: 'card mt' }, el('h3', {}, '📈 Mahasiswa'));
    box.append(mahasiswaPanel(mahasiswa));
    c.append(box);
  }
};

function statCard(num, lbl) {
  return el('div', { class: 'card stat' }, el('div', { class: 'num' }, String(num)), el('div', { class: 'lbl' }, lbl));
}
function profilCard() {
  return el('div', { class: 'card' },
    el('div', { style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px' },
      avatarEl(ME, 72),
      el('div', {},
        el('div', { style: 'font-weight:800;font-size:18px;color:var(--navy)' }, esc(ME.nama)),
        el('div', { class: 'muted small' }, roleLabel(ME.role) + (ME.username ? ' · ' + esc(ME.username) : '')))),
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Nama'), el('div', {}, esc(ME.nama))),
      el('div', { class: 'field' }, el('label', {}, ME.role === 'mahasiswa' ? 'NIM' : 'NIP / Username'), el('div', {}, esc(ME.username)))),
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Peran'), el('div', {}, el('span', { class: 'badge ' + ME.role }, roleLabel(ME.role)))),
      ME.prodi ? el('div', { class: 'field' }, el('label', {}, 'Program Studi'), el('div', {}, esc(ME.prodi))) : el('div', {})),
    el('div', { class: 'two-col' },
      (ME.role === 'mahasiswa' && ME.tahunMasuk) ? el('div', { class: 'field' }, el('label', {}, 'Tahun Masuk'), el('div', {}, esc(ME.tahunMasuk))) : el('div', {}),
      ME.wa ? el('div', { class: 'field' }, el('label', {}, 'WhatsApp'), el('div', {}, esc(ME.wa))) : el('div', {})));
}
function progressBar(pct, small) {
  return el('div', { class: 'progress' + (small ? ' sm' : '') }, el('i', { style: 'width:' + pct + '%' + (pct < 40 ? ';background:var(--amber)' : '') }));
}

// ---------------- DISERTASI ----------------
VIEWS.skripsi = async (c) => {
  c.innerHTML = '';
  if (ME.role === 'mahasiswa') {
    c.append(pageHead('Disertasi Saya', el('button', { class: 'btn btn-primary', onclick: editJudul }, '✏️ Edit Judul')));
    await renderSkripsiCard(c, ME.id, false);
  } else if (ME.role === 'dosen') {
    c.append(pageHead('Mahasiswa Bimbingan'));
    const { skripsi } = await api('/skripsi');
    if (!skripsi.length) { c.append(el('div', { class: 'empty' }, 'Belum ada mahasiswa bimbingan.')); return; }
    const box = el('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(280px,1fr))' });
    skripsi.forEach(s => {
      box.append(el('div', { class: 'card', style: 'cursor:pointer', onclick: () => openSkripsiDetail(s.mahasiswaId) },
        el('b', {}, esc(s.mahasiswa?.nama || '-')),
        el('div', { class: 'muted small', style: 'margin:4px 0 10px;min-height:38px' }, esc(s.judul || '(belum ada judul)')),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); openSkripsiDetail(s.mahasiswaId); } }, 'Lihat Kartu Bimbingan')));
    });
    c.append(box);
  }
};

async function renderSkripsiCard(c, mahasiswaId, dosenView) {
  const { skripsi } = await api('/skripsi/' + mahasiswaId);
  const card = el('div', { class: 'card judul-card' },
    el('div', { class: 'jc-body' },
      el('span', { class: 'judul-kicker' }, '🎓 Judul Disertasi'),
      el('div', { class: 'judul-title' }, skripsi.judul || '(belum ada judul)'),
      el('div', { class: 'judul-meta' },
        el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '1'), 'Promotor: ' + esc(userName(skripsi.pembimbing1))),
        el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '2'), 'Co-Promotor: ' + esc(userName(skripsi.pembimbing2))))));
  const jblk = judulUsulanBlock(skripsi, mahasiswaId); if (jblk) card.append(jblk);
  c.append(card);

  await renderKartuBimbingan(c, mahasiswaId, skripsi);
}

// Blok status usulan judul: catatan untuk mahasiswa, tombol Setujui/Tolak untuk dosen/admin
function judulUsulanBlock(skripsi, mahasiswaId) {
  if (!skripsi || skripsi.judulStatus !== 'pending' || !skripsi.judulUsulan) return null;
  const box = el('div', { class: 'note-acc', style: 'margin-top:10px' },
    el('div', { style: 'font-weight:700' }, '📝 Usulan judul baru menunggu persetujuan:'),
    el('div', { style: 'margin:4px 0 8px;font-weight:600' }, skripsi.judulUsulan));
  if (ME.role === 'dosen' || ME.role === 'admin') {
    const act = async (judulAction, okMsg) => {
      try { await api('/skripsi/' + mahasiswaId, { method: 'PUT', body: { judulAction } }); toast(okMsg, 'ok'); openSkripsiDetail(mahasiswaId); }
      catch (ex) { toast(ex.message, 'err'); }
    };
    box.append(el('div', { class: 'row', style: 'gap:8px' },
      el('button', { class: 'btn btn-success btn-sm', onclick: () => act('approve', 'Judul disetujui') }, '✅ Setujui'),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => act('reject', 'Usulan judul ditolak') }, '✖ Tolak')));
  } else {
    box.append(el('div', { class: 'muted small' }, 'Menunggu persetujuan promotor.'));
  }
  return box;
}

// Tahapan Disertasi = daftar bimbingan bernomor (dibuat dosen), mahasiswa upload PDF
async function renderKartuBimbingan(c, mahasiswaId, skripsi) {
  const [{ bimbingan }, { documents }] = await Promise.all([
    api('/bimbingan?mahasiswaId=' + mahasiswaId),
    api('/documents?mahasiswaId=' + mahasiswaId).catch(() => ({ documents: [] }))
  ]);
  const ordered = bimbingan.slice().sort((a, b) =>
    (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
  const isMhsOwn = ME.role === 'mahasiswa' && ME.id === mahasiswaId;
  const reload = () => { if (isMhsOwn) navigate('skripsi'); else openSkripsiDetail(mahasiswaId); };
  let addBtn = null;
  if (isMhsOwn && ordered.length === 0) {
    addBtn = el('button', { class: 'btn btn-primary btn-sm', onclick: () => ajukanBimbinganForm(reload) }, '+ Ajukan Bimbingan Pertama');
  }
  const box = el('div', { class: 'card mt' },
    el('div', { class: 'row-between' }, el('h3', { style: 'margin:0' }, '📋 Tahapan Disertasi (Bimbingan)'), addBtn),
    el('div', { class: 'muted small', style: 'margin:2px 0 8px' }, isMhsOwn
      ? 'Ajukan bimbingan pertama; tahapan berikutnya dibuat dosen. Unggah dokumen PDF pada tiap tahapan.'
      : 'Setiap tahap berisi tanggal, topik, dan catatan bimbingan.'));
  if (!ordered.length) box.append(el('div', { class: 'empty' }, ME.role === 'dosen'
    ? 'Belum ada pengajuan bimbingan dari mahasiswa.'
    : (isMhsOwn ? 'Belum ada bimbingan. Klik "Ajukan Bimbingan Pertama".' : 'Belum ada tahapan bimbingan.')));
  else box.append(bimbinganGroup(ordered, { docs: documents, reload, skripsi, inlineUjian: true }));
  c.append(box);
}

async function editJudul() {
  const { skripsi } = await api('/skripsi/' + ME.id);
  const inp = el('textarea', { rows: 3 }, skripsi.judulUsulan || skripsi.judul || '');
  const body = el('div', {},
    el('div', { class: 'muted small', style: 'margin-bottom:10px' }, 'Perubahan judul akan dikirim sebagai usulan dan berlaku setelah disetujui promotor.'),
    el('div', { class: 'field' }, el('label', {}, 'Judul Disertasi'), inp),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      if (!inp.value.trim()) return toast('Judul tidak boleh kosong', 'err');
      try { await api('/skripsi/' + ME.id, { method: 'PUT', body: { judul: inp.value.trim() } }); toast('Usulan judul dikirim, menunggu persetujuan dosen', 'ok'); closeModal(); navigate('bimbingan'); }
      catch (ex) { toast(ex.message, 'err'); }
    } }, 'Ajukan Perubahan Judul'));
  openModal('Ajukan Perubahan Judul', body);
}

async function openSkripsiDetail(mahasiswaId) {
  // Menu Skripsi dihapus; tandai Bimbingan sebagai aktif
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === 'bimbingan'));
  const c = $('#mainContent');
  c.innerHTML = '';
  const u = USERS_CACHE.find(x => x.id === mahasiswaId) || {};
  c.append(pageHead('Detail: ' + (u.nama || ''), el('button', { class: 'btn btn-ghost', onclick: () => navigate('bimbingan') }, '← Kembali')));
  await renderSkripsiCard(c, mahasiswaId, true);
}

// ---------------- BIMBINGAN ----------------
VIEWS.bimbingan = async (c) => {
  c.innerHTML = '';
  const [{ bimbingan }, docsRes, skripsiRes] = await Promise.all([
    api('/bimbingan'),
    (ME.role === 'mahasiswa' || ME.role === 'dosen' || ME.role === 'admin') ? api('/documents') : Promise.resolve({ documents: [] }),
    (ME.role !== 'mahasiswa') ? api('/skripsi').catch(() => ({ skripsi: [] })) : Promise.resolve({ skripsi: [] })
  ]);
  let addBtn = null;
  c.append(pageHead(ME.role === 'mahasiswa' ? 'Bimbingan Saya' : 'Mahasiswa Bimbingan', addBtn));
  const docs = docsRes.documents || [];
  const lulusIds = new Set((skripsiRes.skripsi || []).filter(s => s.lulus).map(s => s.mahasiswaId));
  const skripsiByMid = {};
  (skripsiRes.skripsi || []).forEach(s => { skripsiByMid[s.mahasiswaId] = s; });
  if (ME.role === 'mahasiswa') {
    // Kartu judul skripsi + edit (menu Skripsi disatukan ke sini)
    const { skripsi } = await api('/skripsi/' + ME.id).catch(() => ({ skripsi: null }));
    const judulCard = el('div', { class: 'card judul-card', style: 'margin-bottom:14px' },
      el('div', { class: 'jc-body row-between', style: 'align-items:flex-start;gap:12px' },
        el('div', {},
          el('span', { class: 'judul-kicker' }, '🎓 Judul Disertasi'),
          el('div', { class: 'judul-title' }, (skripsi && skripsi.judul) ? skripsi.judul : '(Judul belum ditetapkan)'),
          el('div', { class: 'judul-meta' },
            el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '1'), 'Promotor: ' + esc(userName(skripsi?.pembimbing1)) + nomorSuffix(skripsi?.pembimbing1, 'NUPTK')),
            el('span', { class: 'pemb' }, el('span', { class: 'ic' }, '2'), 'Co-Promotor: ' + esc(userName(skripsi?.pembimbing2)) + nomorSuffix(skripsi?.pembimbing2, 'NUPTK')))),
        el('button', { class: 'btn btn-ghost btn-sm', style: 'flex-shrink:0', onclick: editJudul }, '✏️ Edit Judul')));
    const jblk = judulUsulanBlock(skripsi, ME.id); if (jblk) judulCard.append(jblk);
    c.append(judulCard);
    // Dua jalur terpisah: satu section untuk tiap pembimbing
    const allOrdered = bimbingan.slice().sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
    const pembs = [
      { label: 'Promotor', id: skripsi && skripsi.pembimbing1 },
      { label: 'Co-Promotor', id: skripsi && skripsi.pembimbing2 }
    ].filter(p => p.id);
    if (!pembs.length) { c.append(el('div', { class: 'empty' }, 'Promotor belum ditetapkan admin.')); return; }
    // ACC per fase untuk tiap pembimbing (jadwal ujian butuh SEMUA pembimbing ACC)
    const accSets = {};
    pembs.forEach(p => { accSets[p.id] = trackAccFases(allOrdered.filter(b => b.dosenId === p.id)); });
    const accReady = fase => pembs.every(p => accSets[p.id].has(fase));
    const pendingAcc = fase => pembs.filter(p => !accSets[p.id].has(fase)).map(p => p.label);
    const reloadB = () => navigate('bimbingan');
    const cols = el('div', { class: 'two-col', style: 'align-items:start' });
    pembs.forEach((p, idx) => {
      const list = allOrdered.filter(b => b.dosenId === p.id);
      const hasPengajuan = list.length > 0;
      const card = el('div', { class: 'card' });
      card.append(el('div', { class: 'row-between', style: 'margin-bottom:6px;gap:8px;align-items:flex-start' },
        el('div', { class: 'row', style: 'gap:10px;min-width:0;align-items:center' },
          avatarEl(userObj(p.id) || { nama: userName(p.id) }, 38),
          el('div', { style: 'min-width:0' },
            el('h3', { style: 'margin:0' }, p.label + ': ' + esc(userName(p.id))),
            userNomor(p.id) ? el('div', { class: 'muted small', style: 'margin-top:2px' }, 'NUPTK ' + esc(userNomor(p.id))) : null)),
        el('div', { class: 'row', style: 'gap:6px;flex:0 0 auto' },
          list.length ? el('button', { class: 'btn btn-ghost btn-sm', onclick: () => cetakKartuKontrol(p, list, skripsi) }, '🖨️ Kartu Kontrol') : null,
          hasPengajuan ? null : el('button', { class: 'btn btn-primary btn-sm', onclick: () => ajukanBimbinganForm(reloadB, p.id) }, '+ Ajukan Bimbingan'))));
      // Jadwal ujian (gabungan) menyisip inline di kedua jalur, muncul setelah semua pembimbing ACC
      const grpOpts = { docs, reload: reloadB, skripsi, inlineUjian: true, accReady, pendingAcc };
      if (list.length) card.append(bimbinganGroup(list, grpOpts));
      else card.append(el('div', { class: 'empty' }, 'Belum ada bimbingan dengan ' + p.label.toLowerCase() + '. Klik "Ajukan Bimbingan".'));
      cols.append(card);
    });
    c.append(cols);
    return;
  }
  if (!bimbingan.length) { c.append(el('div', { class: 'empty' }, 'Belum ada pengajuan bimbingan dari mahasiswa.')); return; }
  const ordered = bimbingan.slice().sort((a, b) =>
    (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
  const wrap = el('div', {});
  // Kelompokkan per mahasiswa (pengajuan awal + tahapan dosen dalam satu grup)
  const byMhs = {};
  ordered.forEach(b => { (byMhs[b.mahasiswaId] = byMhs[b.mahasiswaId] || []).push(b); });
  Object.keys(byMhs).forEach(mid => {
    if (lulusIds.has(mid)) return; // sudah diarsipkan (lulus)
    const list = byMhs[mid];
    const card = el('div', { class: 'card', style: 'margin-bottom:16px' });
    const sk = skripsiByMid[mid];
    // Sisipkan jadwal ujian inline ke timeline (baca-saja untuk dosen); tanpa skripsi → mode gabungan biasa
    const grpOpts = sk
      ? { docs, reload: () => navigate('bimbingan'), inlineUjian: true, skripsi: sk, accReady: () => true }
      : { docs, reload: () => navigate('bimbingan'), combinedUjian: true };
    const groupEl = bimbinganGroup(list, grpOpts);
    if (ME.role !== 'mahasiswa') {
      // Kartu bimbingan dosen bisa dibuka/tutup, default tertutup
      const revisi = revisiOf(list);
      const belumCount = revisi.filter(b => b.status !== 'acc' && b.status !== 'selesai' && b.status !== 'batal').length;
      // Balasan/revisi (direvisi) atau pengajuan baru (diajukan) dari mahasiswa → perlu ditindak dosen
      const needAtt = list.filter(b => b.status === 'direvisi' || b.status === 'diajukan').length;
      if (needAtt) card.classList.add('attn');
      const chevron = el('span', { class: 'muted', style: 'font-size:13px' }, '▸');
      groupEl.hidden = true;
      const header = el('div', { class: 'row-between', style: 'cursor:pointer;user-select:none', onclick: () => {
        groupEl.hidden = !groupEl.hidden;
        chevron.textContent = groupEl.hidden ? '▸' : '▾';
      } },
        el('div', { class: 'row', style: 'gap:10px;min-width:0;align-items:center' },
          avatarEl((sk && sk.mahasiswa) || USERS_CACHE.find(u => u.id === mid) || { nama: list[0].mahasiswaNama }, 40),
          el('div', { style: 'min-width:0' },
            el('h3', { style: 'margin:0' }, esc(list[0].mahasiswaNama || userName(mid))),
            userNomor(mid) ? el('div', { class: 'muted small', style: 'margin-top:2px' }, 'NIM ' + esc(userNomor(mid))) : null)),
        el('span', { class: 'row', style: 'gap:10px' },
          needAtt ? el('span', { class: 'attn-badge', title: 'Ada balasan/revisi atau pengajuan baru dari mahasiswa' }, '💬 ' + needAtt + ' perlu ditindak') : null,
          el('span', { class: 'muted small' }, revisi.length + ' bimbingan' + (belumCount ? ' · ' + belumCount + ' belum selesai' : '')),
          ME.role === 'dosen' ? el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => {
            e.stopPropagation();
            const label = sk && sk.pembimbing2 === ME.id ? 'Co-Promotor' : 'Promotor';
            cetakKartuKontrol({ label, id: ME.id }, list.filter(b => b.dosenId === ME.id), sk);
          } }, '🖨️ Kartu Kontrol') : null,
          ME.role === 'dosen' ? el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); arsipkanLulus(mid, list[0].mahasiswaNama || userName(mid)); } }, '🎓 Arsipkan') : null,
          chevron));
      card.append(header, groupEl);
    } else {
      card.append(groupEl);
    }
    wrap.append(card);
  });
  c.append(wrap);
};

// Tandai mahasiswa LULUS → pindah ke Arsip. Batalkan mengembalikan ke daftar aktif.
async function arsipkanLulus(mid, nama) {
  if (!confirm('Arsipkan bimbingan "' + nama + '" sebagai LULUS? Data akan dipindah ke menu Arsip.')) return;
  try { await api('/skripsi/' + mid, { method: 'PUT', body: { lulus: true } }); toast('Diarsipkan (lulus)', 'ok'); navigate('bimbingan'); }
  catch (ex) { toast(ex.message, 'err'); }
}
async function batalArsip(mid, nama) {
  if (!confirm('Batalkan arsip "' + nama + '" dan kembalikan ke daftar bimbingan aktif?')) return;
  try { await api('/skripsi/' + mid, { method: 'PUT', body: { lulus: false } }); toast('Arsip dibatalkan', 'ok'); navigate('arsip'); }
  catch (ex) { toast(ex.message, 'err'); }
}

// ---------------- UJIAN (dosen) ----------------
VIEWS.ujian = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('🎓 Jadwal Ujian'));
  const { ujian } = await api('/ujian');
  if (!ujian.length) { c.append(el('div', { class: 'empty' }, 'Belum ada mahasiswa yang akan Anda uji. Jadwal muncul di sini setelah mahasiswa mengisi jadwal ujian.')); return; }
  const today = new Date().toISOString().slice(0, 10);
  const akan = ujian.filter(u => u.tanggal >= today);
  const lalu = ujian.filter(u => u.tanggal < today).reverse();
  const peranBadge = p => p === 'Promotor' ? 'dosen' : (p === 'Co-Promotor' ? 'mahasiswa' : 'kaprodi');
  const card = u => {
    const daring = u.metode === 'daring';
    const safe = /^https?:\/\//i.test(u.link || '');
    const lok = daring
      ? ((u.link && safe) ? el('a', { href: u.link, target: '_blank', rel: 'noopener', style: 'color:var(--primary-d);word-break:break-all' }, u.link) : el('span', {}, u.link || '—'))
      : el('span', {}, u.tempat || '—');
    return el('div', { class: 'card', style: 'margin-bottom:12px' },
      el('div', { class: 'li-head', style: 'flex-wrap:wrap;gap:8px' },
        el('span', { class: 'bimb-no ujian' }, '🎓 ' + esc(u.jenisLabel)),
        el('span', { class: 'badge ' + peranBadge(u.peran) }, u.peran),
        el('span', { class: 'spacer', style: 'flex:1' }),
        el('span', { class: 'muted small' }, '📅 ' + fmtDate(u.tanggal))),
      el('div', { style: 'font-weight:700;margin-top:8px' }, esc(u.mahasiswaNama) + (u.mahasiswaNim ? ' · NIM ' + esc(u.mahasiswaNim) : '')),
      u.judul ? el('div', { class: 'muted small', style: 'margin-top:2px' }, esc(u.judul)) : null,
      el('div', { style: 'margin-top:8px' }, el('span', { class: 'muted small' }, daring ? '🔗 Daring: ' : '📍 Luring: '), lok),
      el('div', { style: 'margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center' },
        el('span', { class: 'muted small' }, '🧑‍⚖️ Penguji:'),
        (u.penguji && u.penguji.length) ? u.penguji.map(nm => el('span', { style: PENGUJI_CHIP }, '👤 ' + nm)) : el('span', { class: 'muted small' }, 'belum ditetapkan')));
  };
  if (akan.length) { c.append(el('h3', { style: 'margin:6px 0 10px' }, 'Akan Datang (' + akan.length + ')')); akan.forEach(u => c.append(card(u))); }
  if (lalu.length) { c.append(el('h3', { style: 'margin:18px 0 10px' }, 'Telah Berlangsung (' + lalu.length + ')')); lalu.forEach(u => c.append(card(u))); }
};

// ---------------- ARSIP (dosen) ----------------
VIEWS.arsip = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('🗄️ Arsip Kelulusan'));
  const [{ bimbingan }, docsRes, skripsiRes] = await Promise.all([
    api('/bimbingan'), api('/documents').catch(() => ({ documents: [] })), api('/skripsi').catch(() => ({ skripsi: [] }))
  ]);
  const docs = docsRes.documents || [];
  const arsip = (skripsiRes.skripsi || []).filter(s => s.lulus)
    .sort((a, b) => (b.tanggalLulus || '').localeCompare(a.tanggalLulus || ''));
  if (!arsip.length) { c.append(el('div', { class: 'empty' }, 'Belum ada mahasiswa yang diarsipkan (lulus). Arsipkan dari menu Bimbingan.')); return; }
  const byMhs = {};
  bimbingan.forEach(b => { (byMhs[b.mahasiswaId] = byMhs[b.mahasiswaId] || []).push(b); });
  const wrap = el('div', {});
  arsip.forEach(s => {
    const mid = s.mahasiswaId;
    const nama = (s.mahasiswa && s.mahasiswa.nama) || userName(mid);
    const list = (byMhs[mid] || []).slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
    const card = el('div', { class: 'card', style: 'margin-bottom:16px' });
    const groupEl = bimbinganGroup(list, { docs, reload: () => navigate('arsip'), combinedUjian: true });
    groupEl.hidden = true;
    const chevron = el('span', { class: 'muted', style: 'font-size:13px' }, '▸');
    const header = el('div', { class: 'row-between', style: 'cursor:pointer;user-select:none;gap:8px', onclick: () => { groupEl.hidden = !groupEl.hidden; chevron.textContent = groupEl.hidden ? '▸' : '▾'; } },
      el('div', { class: 'row', style: 'gap:10px;min-width:0;align-items:center' },
        avatarEl(s.mahasiswa || USERS_CACHE.find(u => u.id === mid) || { nama }, 40),
        el('div', { style: 'min-width:0' },
          el('h3', { style: 'margin:0' }, esc(nama)),
          el('div', { class: 'muted small', style: 'margin-top:2px' }, (userNomor(mid) ? 'NIM ' + esc(userNomor(mid)) + ' · ' : '') + 'Lulus: ' + (s.tanggalLulus ? fmtDate(s.tanggalLulus) : '-') + (s.judul ? ' · ' + esc(s.judul) : '')))),
      el('span', { class: 'row', style: 'gap:10px;flex:0 0 auto' }, chevron));
    const pembs = [{ label: 'Promotor', id: s.pembimbing1 }, { label: 'Co-Promotor', id: s.pembimbing2 }].filter(p => p.id);
    const acts = el('div', { class: 'row', style: 'gap:8px;margin:10px 0 2px;flex-wrap:wrap' });
    pembs.forEach(p => acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => cetakKartuKontrol(p, list.filter(b => b.dosenId === p.id), s) }, '🖨️ Kartu ' + p.label)));
    if (ME.role === 'dosen' || ME.role === 'admin') acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => batalArsip(mid, nama) }, '↩️ Batalkan Arsip'));
    card.append(header, acts, groupEl);
    wrap.append(card);
  });
  c.append(wrap);
};

// Kartu kontrol bimbingan per pembimbing → jendela cetak (Simpan sebagai PDF).
function cetakKartuKontrol(p, list, skripsi) {
  const ordered = list.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
  const hasMhs = ordered.some(b => b.dibuatOleh === 'mahasiswa');
  const firstNoMarker = ordered.find(b => !b.dibuatOleh);
  const isPeng = b => b.dibuatOleh === 'mahasiswa' || (!hasMhs && b === firstNoMarker);
  let fase = 'Proposal', no = 0, seen = 0;
  const rows = ordered.map(b => {
    let label;
    if (isPeng(b)) { fase = b.fase || (seen === 0 ? 'Proposal' : fase); seen++; no = 0; label = 'Pengajuan Bimbingan' + (fase === 'Proposal' ? '' : ' ' + fase); }
    else { no++; label = 'Bimbingan ' + fase + ' ke-' + no; }
    return {
      tanggal: b.tanggal ? fmtDate(b.tanggal) : '-',
      tahap: label,
      materi: b.topik || (isPeng(b) ? 'Pengajuan bimbingan' : '-'),
      arahan: b.catatanDosen || '',
      status: statusLabel(b.status)
    };
  });
  const hari = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const mhs = (skripsi && skripsi.mahasiswa) || userObj(skripsi && skripsi.mahasiswaId) || (ME.role === 'mahasiswa' ? ME : null) || {};
  const mhsNama = mhs.nama || '-', mhsNim = mhs.username || '-', prodi = mhs.prodi || '-';
  const judul = (skripsi && skripsi.judul) || '(Judul belum ditetapkan)';
  const dosenNama = userName(p.id), dosenNuptk = userNomor(p.id) || '-';
  const trs = rows.length
    ? rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(r.tanggal)}</td><td>${esc(r.tahap)}</td><td>${esc(r.materi)}</td><td>${esc(r.arahan)}</td><td class="c">${esc(r.status)}</td><td></td></tr>`).join('')
    : `<tr><td class="c" colspan="7">Belum ada bimbingan.</td></tr>`;
  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Kartu Kontrol Bimbingan — ${esc(mhsNama)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #16233d; margin: 24px; font-size: 12px; }
  .head { position: relative; text-align: center; border-bottom: 3px double #0045a6; padding-bottom: 10px; margin-bottom: 14px; min-height: 76px; }
  .head .logo { position: absolute; left: 4px; top: 0; width: 72px; height: 72px; object-fit: contain; }
  .head h1 { margin: 0; font-size: 18px; letter-spacing: .5px; color: #0045a6; }
  .head .sub { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .head .uni { font-size: 14px; font-weight: 800; margin-top: 1px; color: #0045a6; }
  table.meta { width: 100%; margin: 10px 0 14px; border-collapse: collapse; }
  table.meta td { padding: 2px 4px; vertical-align: top; }
  table.meta td.k { width: 1%; white-space: nowrap; font-weight: 600; padding-right: 8px; }
  table.meta td.s { width: 12px; }
  table.log { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.log th, table.log td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; }
  table.log th { background: #eef3fb; font-size: 11px; }
  table.log td.c { text-align: center; }
  table.log td:nth-child(7) { width: 70px; }
  .sign-wrap { margin-top: 34px; display: flex; justify-content: flex-end; }
  .sign-box { width: 46%; max-width: 320px; text-align: center; font-size: 12px; line-height: 1.5; }
  .sign-box .sp { height: 66px; }
  @media print { body { margin: 12mm; } .noprint { display: none; } }
  .noprint { text-align: center; margin-bottom: 14px; }
  .btnp { background: #0045a6; color: #fff; border: 0; padding: 8px 18px; border-radius: 8px; font-size: 13px; cursor: pointer; }
</style></head><body>
<div class="noprint"><button class="btnp" id="btnCetak">🖨️ Cetak / Simpan PDF</button></div>
<div class="head">
  <img class="logo" src="${location.origin}/logo-unismuh.png" alt="Logo Unismuh Makassar">
  <h1>KARTU KONTROL BIMBINGAN DISERTASI</h1>
  <div class="sub">Program Studi S-3 Pendidikan Program Pascasarjana</div>
  <div class="uni">Universitas Muhammadiyah Makassar</div>
</div>
<table class="meta">
  <tr><td class="k">Nama Mahasiswa</td><td class="s">:</td><td>${esc(mhsNama)}</td><td class="k">${esc(p.label)}</td><td class="s">:</td><td>${esc(dosenNama)}</td></tr>
  <tr><td class="k">NIM</td><td class="s">:</td><td>${esc(mhsNim)}</td><td class="k">NUPTK</td><td class="s">:</td><td>${esc(dosenNuptk)}</td></tr>
  <tr><td class="k">Program Studi</td><td class="s">:</td><td colspan="4">${esc(prodi)}</td></tr>
  <tr><td class="k">Judul Disertasi</td><td class="s">:</td><td colspan="4">${esc(judul)}</td></tr>
</table>
<table class="log">
  <thead><tr><th>No</th><th>Tanggal</th><th>Tahap</th><th>Materi / Topik</th><th>Catatan / Arahan Pembimbing</th><th>Status</th><th>Paraf</th></tr></thead>
  <tbody>${trs}</tbody>
</table>
<div class="sign-wrap">
  <div class="sign-box">
    Makassar, ${esc(hari)}<br>Mengetahui, ${esc(p.label)}
    <div class="sp"></div>
    <b>${esc(dosenNama)}</b><br>NUPTK. ${esc(dosenNuptk)}
  </div>
</div>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Popup diblokir browser. Izinkan popup untuk mencetak.', 'err');
  w.document.write(html);
  w.document.close();
  w.focus();
  try { const b = w.document.getElementById('btnCetak'); if (b) b.addEventListener('click', () => w.print()); } catch (e) {}
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

function bimbinganItem(b, label, opts, isPengajuan, extraDocs) {
  const reload = opts && opts.reload;
  const allDocs = (opts && opts.docs) || [];
  const docs = allDocs.filter(d => d.bimbinganId === b.id);
  const carried = (extraDocs || []).filter(d => !docs.some(x => x.id === d.id));

  // Setiap langkah bimbingan = kartu ringkas yang bisa diklik untuk membuka popup detail
  const item = el('div', { class: 'list-item bimb-item' + (isPengajuan ? ' pengajuan' : ''), style: 'cursor:pointer', onclick: () => openBimbinganModal(b, allDocs, reload, isPengajuan, extraDocs) });
  const head = el('div', { class: 'li-head' });
  head.append(el('span', { class: 'bimb-no' + (isPengajuan ? ' pengajuan' : '') }, label || (isPengajuan ? 'Pengajuan Bimbingan' : 'Bimbingan')));
  if (!isPengajuan && b.topik) head.append(el('b', {}, esc(b.topik)));
  head.append(
    el('span', { class: 'tag ' + b.status }, statusLabel(b.status)),
    el('span', { class: 'spacer', style: 'flex:1' }),
    el('span', { class: 'muted small' }, fmtDate(b.tanggal)));
  item.append(head);
  const who = ME.role === 'dosen' ? ('Mahasiswa: ' + esc(b.mahasiswaNama || userName(b.mahasiswaId)) + nomorSuffix(b.mahasiswaId, 'NIM'))
    : ('Dosen: ' + esc(b.dosenNama || userName(b.dosenId)) + nomorSuffix(b.dosenId, 'NUPTK'));
  item.append(el('div', { class: 'muted small', style: 'margin:4px 0' }, who + (b.metode ? ' · ' + esc(b.metode) : '')));
  const preview = b.catatanDosen ? ('✅ ' + b.catatanDosen) : (b.catatanMhs ? ('📝 ' + b.catatanMhs) : '');
  if (preview) item.append(el('div', { class: 'small', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%' }, esc(preview)));
  const info = [];
  if (docs.length + carried.length) info.push('📎 ' + (docs.length + carried.length) + ' dokumen');
  info.push('Klik untuk detail →');
  item.append(el('div', { class: 'small', style: 'margin-top:6px;color:var(--primary)' }, info.join(' · ')));
  return item;
}

// Popup detail 1 langkah bimbingan — dosen bisa revisi, mahasiswa bisa menanggapi/upload
function openBimbinganModal(b, allDocs, reload, isPengajuan, extraDocs) {
  const docs = (allDocs || []).filter(d => d.bimbinganId === b.id);
  const carried = (extraDocs || []).filter(d => !docs.some(x => x.id === d.id));
  const body = el('div', {});
  body.append(
    el('div', { class: 'field' }, el('label', {}, 'Mahasiswa'), el('div', {}, esc(b.mahasiswaNama || userName(b.mahasiswaId)) + nomorSuffix(b.mahasiswaId, 'NIM'))),
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Tanggal'), el('div', {}, fmtDate(b.tanggal))),
      el('div', { class: 'field' }, el('label', {}, 'Status'), el('span', { class: 'tag ' + b.status }, statusLabel(b.status)))));
  if (!isPengajuan && b.topik) body.append(el('div', { class: 'field' }, el('label', {}, 'Topik / Materi'), el('div', {}, esc(b.topik))));
  if (b.metode) body.append(el('div', { class: 'field' }, el('label', {}, 'Metode'), el('div', {}, esc(b.metode))));
  if (b.catatanMhs) body.append(el('div', { class: 'field' }, el('label', {}, 'Catatan Mahasiswa'), el('div', { style: 'white-space:pre-wrap' }, esc(b.catatanMhs))));
  if (b.catatanDosen) body.append(el('div', { class: 'field' }, el('label', {}, 'Catatan / Arahan Dosen'), el('div', { style: 'white-space:pre-wrap;color:var(--green)' }, esc(b.catatanDosen))));
  const reopenSelf = () => openBimbinganModal(b, allDocs, reload, isPengajuan, extraDocs);
  if (docs.length) docs.forEach(d => body.append(docToggleBlock(d, reopenSelf)));
  if (carried.length) {
    body.append(el('div', { class: 'muted small', style: 'margin-top:6px' }, '📎 Dokumen dari pengajuan (dengan tanda/catatan dosen):'));
    carried.forEach(d => body.append(docToggleBlock(d, reopenSelf)));
  }

  const hr = () => el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' });

  // ---- Aksi DOSEN ----
  if (ME.role === 'dosen') {
    if (isPengajuan && b.status === 'diajukan') {
      body.append(hr(),
        el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Setujui pengajuan ini. Setelah disetujui, opsi Minta Revisi / ACC muncul di sini (tab tetap terbuka).'),
        el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          try {
            await api('/bimbingan/' + b.id, { method: 'PUT', body: { status: 'disetujui' } });
            b.status = 'disetujui';
            toast('Pengajuan disetujui', 'ok');
            openBimbinganModal(b, allDocs, reload, isPengajuan); // re-render modal, TETAP terbuka
            reload && reload();
          } catch (ex) { toast(ex.message, 'err'); }
        } }, '✅ Setujui Pengajuan'));
    } else if (b.status === 'acc') {
      // Sudah ACC: jadwal ujian & file ada di baris "Jadwal Ujian"
      body.append(hr(),
        el('div', { class: 'note-acc' }, '✅ Sudah di-ACC. Jadwal ujian & file ada pada baris "Jadwal Ujian" di bawah.'),
        el('button', { class: 'btn btn-warn btn-sm', onclick: () => { closeModal(); bimbinganForm(null, b.mahasiswaId, reload); } }, '✍️ Minta Revisi'));
    } else {
      // 2) Setelah disetujui / pada tiap langkah: Minta Revisi (buat bimbingan baru) atau ACC
      body.append(hr(),
        el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Periksa dokumen mahasiswa, lalu minta revisi (dihitung 1 bimbingan) atau ACC bila sudah benar.'),
        el('div', { class: 'row' },
          el('button', { class: 'btn btn-warn', onclick: () => { closeModal(); bimbinganForm(null, b.mahasiswaId, reload); } }, '✍️ Minta Revisi'),
          el('button', { class: 'btn btn-success', onclick: () => { closeModal(); accForm(b, reload); } }, '✅ ACC – Siap Ujian')));
    }
  }

  // ---- Aksi MAHASISWA ----
  if (ME.role === 'mahasiswa' && b.mahasiswaId === ME.id) {
    if (b.status === 'acc') {
      // Jadwal ujian & file diisi pada baris "Jadwal Ujian" (bukan di sini)
      body.append(hr(), el('div', { class: 'note-acc' }, '✅ Sudah di-ACC. Isi jadwal ujian & unggah file pada baris "Jadwal Ujian" di bawah.'));
    } else {
      if (b.status === 'revisi') {
        body.append(el('div', { class: 'note-revisi mt' }, '⚠️ Dosen meminta revisi. Perbaiki sesuai catatan dosen di atas, lalu unggah ulang dokumen Anda.'));
      }
      const tgp = el('textarea', { rows: 3, placeholder: isPengajuan ? 'Tulis pesan / catatan…' : 'Tulis tanggapan…' }, b.catatanMhs || '');
      // Upload PDF INLINE — popup tidak tertutup saat upload; hanya tertutup saat Simpan Tanggapan
      const fileInput = el('input', { type: 'file', accept: '.pdf' });
      const uploadedBox = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' });
      const uploadBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
        const f = fileInput.files[0];
        if (!f) return toast('Pilih file PDF dulu', 'err');
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast('Hanya berkas PDF', 'err');
        if (f.size > 12 * 1024 * 1024) return toast('Berkas melebihi 12MB', 'err');
        try {
          const dataUrl = await readFileDataUrl(f);
          const res = await api('/documents', { method: 'POST', body: { nama: f.name, dataUrl, bimbinganId: b.id } });
          toast('File terupload', 'ok');
          fileInput.value = '';
          uploadedBox.append(el('div', { class: 'row-between', style: 'background:#eef7ee;border:1px solid #cfe8cf;border-radius:8px;padding:6px 10px' },
            el('span', {}, '📄 ' + esc(res.document.nama)), el('span', { class: 'muted small' }, 'Terupload ✓')));
        } catch (ex) { toast(ex.message, 'err'); }
      } }, '⬆️ Upload File');
      body.append(hr(),
        el('div', { class: 'field' }, el('label', {}, '📎 Lampiran PDF (opsional)'), fileInput),
        uploadBtn, uploadedBox,
        el('div', { class: 'field', style: 'margin-top:12px' }, el('label', {}, isPengajuan ? '📝 Pesan / Catatan' : '💬 Tanggapan Saya'), tgp),
        el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
          try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { catatanMhs: tgp.value.trim() } });
            toast('Tersimpan', 'ok'); closeModal(); reload && reload(); } catch (ex) { toast(ex.message, 'err'); }
        } }, isPengajuan ? 'Simpan Pengajuan' : 'Simpan Tanggapan'));
      if (isPengajuan && b.status === 'diajukan') {
        body.append(el('button', { class: 'btn btn-danger btn-block mt', onclick: () => delBimbingan(b.id, reload) }, 'Batalkan Pengajuan'));
      }
    }
  }

  // ---- Aksi ADMIN: kelola progres bimbingan (ubah status/tanggal/catatan atau hapus) ----
  if (ME.role === 'admin') {
    const STATUSES = ['diajukan', 'disetujui', 'revisi', 'direvisi', 'acc', 'selesai', 'batal'];
    const statusSel = el('select', {}, STATUSES.map(s => el('option', { value: s, ...(b.status === s ? { selected: 'selected' } : {}) }, statusLabel(s))));
    const tglInp = el('input', { type: 'date', value: b.tanggal || '' });
    const catInp = el('textarea', { rows: 2, placeholder: 'Catatan / arahan (opsional)' }, b.catatanDosen || '');
    body.append(hr(),
      el('div', { class: 'muted small', style: 'margin-bottom:8px' }, '🛠️ Kelola (Admin) — ubah status/tanggal/catatan, atau hapus entri ini.'),
      el('div', { class: 'two-col' },
        el('div', { class: 'field' }, el('label', {}, 'Status'), statusSel),
        el('div', { class: 'field' }, el('label', {}, 'Tanggal'), tglInp)),
      el('div', { class: 'field' }, el('label', {}, 'Catatan / Arahan'), catInp),
      el('div', { class: 'row', style: 'gap:8px' },
        el('button', { class: 'btn btn-primary', onclick: async () => {
          try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { status: statusSel.value, tanggal: tglInp.value, catatanDosen: catInp.value.trim() } });
            toast('Perubahan disimpan', 'ok'); closeModal(); reload && reload(); } catch (ex) { toast(ex.message, 'err'); }
        } }, '💾 Simpan Perubahan'),
        el('button', { class: 'btn btn-danger', onclick: async () => {
          if (!confirm('Hapus entri bimbingan ini secara permanen?')) return;
          try { await api('/bimbingan/' + b.id, { method: 'DELETE' }); toast('Entri dihapus', 'ok'); closeModal(); reload && reload(); } catch (ex) { toast(ex.message, 'err'); }
        } }, '🗑️ Hapus Entri')));
  }

  const judul = isPengajuan ? 'Detail Pengajuan Bimbingan' : 'Detail Bimbingan';
  openModal(judul, body, { wide: (docs.length + carried.length) > 0 });
}

// Form ACC — dosen menambahkan catatan sebelum menyatakan siap ujian (popup tidak langsung tertutup)
function accForm(b, reload) {
  const cat = el('textarea', { rows: 4, placeholder: 'Catatan / keterangan untuk mahasiswa (opsional)…' }, b.catatanDosen || '');
  const body = el('div', {},
    el('div', { class: 'note-acc' }, 'Disertasi akan di-ACC dan dinyatakan siap diujikan. Tambahkan catatan bila perlu, lalu simpan.'),
    el('div', { class: 'field' }, el('label', {}, '✅ Catatan ACC'), cat),
    el('button', { class: 'btn btn-success btn-block', onclick: async () => {
      try {
        await api('/bimbingan/' + b.id, { method: 'PUT', body: { status: 'acc', catatanDosen: cat.value.trim() } });
        toast('Disertasi di-ACC – siap diujikan', 'ok'); closeModal(); reload && reload();
      } catch (ex) { toast(ex.message, 'err'); }
    } }, '✅ Simpan ACC'));
  openModal('ACC – Siap Ujian', body);
}

// Setujui pengajuan lalu langsung buka form tahapan (berisi catatan/perbaikan)
async function approveAndCreate(b, reload) {
  try {
    await api('/bimbingan/' + b.id, { method: 'PUT', body: { status: 'disetujui' } });
    toast('Pengajuan disetujui', 'ok'); closeModal();
    bimbinganForm(null, b.mahasiswaId, reload);
  } catch (ex) { toast(ex.message, 'err'); }
}

// Entri revisi (semua entri selain pengajuan). Tiap revisi dihitung 1 bimbingan.
function revisiOf(list) {
  const p = list.find(b => b.dibuatOleh === 'mahasiswa') || list.find(b => !b.dibuatOleh);
  return list.filter(b => b !== p);
}

// Tentukan id entri pengajuan (buatan mahasiswa) per mahasiswa
function pengajuanIdSet(list) {
  const byMhs = {};
  list.forEach(b => { (byMhs[b.mahasiswaId] = byMhs[b.mahasiswaId] || []).push(b); });
  const ids = new Set();
  Object.values(byMhs).forEach(arr => {
    const sorted = arr.slice().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.tanggal || '').localeCompare(b.tanggal || ''));
    const p = sorted.find(x => x.dibuatOleh === 'mahasiswa') || sorted.find(x => !x.dibuatOleh);
    if (p) ids.add(p.id);
  });
  return ids;
}

// Kelompokkan pengajuan awal mahasiswa + tahapan dosen dalam satu grup visual
function bimbinganGroup(ordered, opts) {
  const group = el('div', { class: 'bimb-group' });
  const hasMhsEntry = ordered.some(b => b.dibuatOleh === 'mahasiswa');
  const firstNoMarker = ordered.find(b => !b.dibuatOleh);
  const isPengajuanEntry = b => b.dibuatOleh === 'mahasiswa' || (!hasMhsEntry && b === firstNoMarker);
  let fase = 'Proposal';
  let no = 0;
  let pengajuanSeen = 0;
  let pengajuanEntry = null;
  const insertedUjian = {};
  const els = [];
  ordered.forEach((b, i) => {
    const isPengajuan = isPengajuanEntry(b);
    let label;
    let extraDocs = null;
    if (isPengajuan) {
      fase = b.fase || (pengajuanSeen === 0 ? 'Proposal' : fase);
      pengajuanSeen++;
      no = 0;
      pengajuanEntry = b;
      label = 'Pengajuan Bimbingan' + (fase === 'Proposal' ? '' : ' ' + fase);
    } else {
      no++;
      label = 'Bimbingan ' + fase + ' ke-' + no;
      // Bimbingan pertama menampilkan dokumen pengajuan yang sudah diberi tanda/catatan dosen
      if (no === 1 && pengajuanEntry) {
        const pid = pengajuanEntry.id;
        extraDocs = ((opts && opts.docs) || []).filter(d => d.bimbinganId === pid && ((d.anotasi && d.anotasi.length) || (d.catatan && d.catatan.length)));
      }
    }
    const itemEl = bimbinganItem(b, label, opts, isPengajuan, extraDocs);
    if (i === ordered.length - 1) itemEl.classList.add('spotlight'); // sorot bimbingan terakhir
    els.push(itemEl);
    if (b.status === 'acc') {
      if (opts && opts.inlineUjian && opts.skripsi) {
        const t = UJIAN_TYPES.find(x => x.fase === fase);
        const ready = !opts.accReady || opts.accReady(fase);
        const pending = opts.pendingAcc ? opts.pendingAcc(fase) : [];
        if (t && !insertedUjian[fase]) { els.push(ujianTimelineRow(opts.skripsi, t, opts.docs, opts.reload, ready, pending)); insertedUjian[fase] = true; }
      } else if (!(opts && opts.combinedUjian)) {
        els.push(jadwalUjianRow(b, opts, fase));
      }
    }
  });
  // Tampilkan bimbingan terakhir paling atas
  els.reverse().forEach(e => group.append(e));
  return group;
}

// Timeline gabungan mahasiswa: semua bimbingan Promotor + Co-Promotor + jadwal ujian menyisip (satu bagian).
function mergedTimeline(ordered, pembs, skripsi, docs, reload) {
  const group = el('div', { class: 'bimb-group' });
  const dosenRole = id => { const p = pembs.find(x => x.id === id); return p ? p.label : 'Dosen'; };
  const faseByDosen = {}, seenByDosen = {}, noByKey = {}, accByFase = {}, insertedUjian = {};
  const els = [];
  ordered.forEach(b => {
    const d = b.dosenId;
    const isPengajuan = b.dibuatOleh === 'mahasiswa';
    if (isPengajuan) { faseByDosen[d] = b.fase || (seenByDosen[d] ? faseByDosen[d] : 'Proposal'); seenByDosen[d] = (seenByDosen[d] || 0) + 1; }
    const fase = faseByDosen[d] || 'Proposal';
    let label;
    if (isPengajuan) label = 'Pengajuan ' + fase + ' · ' + dosenRole(d);
    else { const k = d + '|' + fase; noByKey[k] = (noByKey[k] || 0) + 1; label = 'Bimbingan ' + fase + ' ke-' + noByKey[k] + ' · ' + dosenRole(d); }
    els.push(bimbinganItem(b, label, { docs, reload }, isPengajuan));
    if (b.status === 'acc') {
      (accByFase[fase] = accByFase[fase] || new Set()).add(d);
      if (accByFase[fase].size >= pembs.length && !insertedUjian[fase]) {
        const t = UJIAN_TYPES.find(x => x.fase === fase);
        if (t) els.push(ujianTimelineRow(skripsi, t, docs, reload));
        insertedUjian[fase] = true;
      }
    }
  });
  els.reverse().forEach(e => group.append(e));
  return group;
}

// Baris jadwal ujian di dalam timeline (klik untuk mengisi/melihat).
function ujianTimelineRow(skripsi, type, allDocs, reload, ready, pending) {
  ready = ready !== false;
  pending = pending || [];
  const mid = skripsi.mahasiswaId;
  const key = 'ujian:' + mid + ':' + type.key;
  const docs = (allDocs || []).filter(d => d.bimbinganId === key);
  const tanggal = (skripsi.ujian && skripsi.ujian[type.key]) ? skripsi.ujian[type.key].tanggal : '';
  const sudahUjian = tanggal && tanggal <= new Date().toISOString().slice(0, 10);
  const isMhsOwn = ME.role === 'mahasiswa' && ME.id === mid;
  const row = el('div', { class: 'list-item bimb-item ujian', style: 'cursor:pointer', onclick: () => openUjianModal(skripsi, type, allDocs, reload, ready, pending) });
  row.append(el('div', { class: 'li-head' },
    el('span', { class: 'bimb-no ujian' }, '🎓 ' + type.label),
    sudahUjian ? el('span', { class: 'tag selesai' }, 'sudah ujian') : (!ready ? el('span', { class: 'tag revisi' }, 'terkunci') : (tanggal ? el('span', { class: 'tag acc' }, 'terjadwal') : el('span', { class: 'tag revisi' }, 'belum diisi'))),
    el('span', { class: 'spacer', style: 'flex:1' }),
    el('span', { class: 'muted small' }, tanggal ? fmtDate(tanggal) : '')));
  let desc;
  if (tanggal) desc = sudahUjian ? '✅ Telah dilaksanakan: ' + fmtDate(tanggal) : '📅 Dijadwalkan: ' + fmtDate(tanggal);
  else if (!ready) desc = '🔒 Jadwal terkunci — menunggu ACC ' + (pending.length ? pending.join(' & ') : 'kedua pembimbing');
  else desc = isMhsOwn ? 'Klik untuk mengisi jadwal & unggah berkas' : 'Menunggu mahasiswa mengisi jadwal';
  row.append(el('div', { class: 'small', style: 'margin-top:4px;color:' + ((!ready && !tanggal) ? 'var(--red)' : 'var(--primary)') },
    desc + (docs.length ? ' · 📎 ' + docs.length + ' berkas' : '')));
  return row;
}
function openUjianModal(skripsi, type, allDocs, reload, ready, pending) {
  ready = ready !== false;
  const pendingMsg = 'Jadwal baru dapat diisi setelah Promotor & Co-Promotor ACC' + ((pending && pending.length) ? ' · menunggu: ' + pending.join(', ') : '');
  openModal('🎓 ' + type.label, jadwalUjianCard(skripsi, type, ready, pendingMsg, allDocs, () => { closeModal(); reload && reload(); }), { wide: false });
}

// Set fase yang sudah ACC untuk satu jalur (dosen) — mengikuti logika fase bimbinganGroup.
function trackAccFases(entries) {
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

// Pemilih dosen penguji: pilih dari database dosen atau ketik manual; hasil berupa array nama.
const PENGUJI_CHIP = 'display:inline-flex;align-items:center;gap:4px;background:#eef3fb;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:13px';
function pengujiPicker(initial) {
  const list = (initial || []).slice();
  const chips = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px' });
  const render = () => {
    chips.innerHTML = '';
    if (!list.length) { chips.append(el('span', { class: 'muted small' }, 'Belum ada penguji.')); return; }
    list.forEach((nm, i) => chips.append(el('span', { style: PENGUJI_CHIP }, '👤 ' + nm,
      el('button', { type: 'button', title: 'Hapus', style: 'border:none;background:transparent;color:var(--red);cursor:pointer;font-size:15px;line-height:1', onclick: () => { list.splice(i, 1); render(); } }, '×'))));
  };
  render();
  const dosenSel = el('select', { style: 'flex:1;min-width:0' }, el('option', { value: '' }, '— Pilih dari daftar dosen —'),
    USERS_CACHE.filter(u => u.role === 'dosen').map(u => el('option', { value: u.nama }, u.nama + (u.username ? ' · NUPTK ' + u.username : ''))));
  const add = nm => { const v = (nm || '').trim(); if (v && !list.includes(v)) { list.push(v); render(); } };
  const addDosen = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: 'flex:0 0 auto', onclick: () => { add(dosenSel.value); dosenSel.value = ''; } }, '+ Tambah');
  const manual = el('input', { type: 'text', style: 'flex:1;min-width:0', placeholder: 'atau ketik nama penguji…' });
  const addManual = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: 'flex:0 0 auto', onclick: () => { add(manual.value); manual.value = ''; } }, '+ Tambah');
  const node = el('div', { class: 'field', style: 'margin-top:8px' },
    el('label', {}, '🧑‍⚖️ Dosen Penguji'),
    el('div', { class: 'row', style: 'gap:6px;align-items:center' }, dosenSel, addDosen),
    el('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:6px' }, manual, addManual),
    chips);
  return { node, get: () => list.slice() };
}
function pengujiReadonly(arr) {
  return el('div', { class: 'field', style: 'margin-top:8px' }, el('label', {}, '🧑‍⚖️ Dosen Penguji'),
    (arr && arr.length)
      ? el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, arr.map(nm => el('span', { style: PENGUJI_CHIP }, '👤 ' + nm)))
      : el('div', { class: 'muted small' }, 'Belum ditetapkan.'));
}
// Ringkasan metode ujian (luring: tempat / daring: link) — baca-saja.
function ujianMetodeReadonly(u) {
  const metode = (u && u.metode) || '';
  if (!metode) return null;
  const daring = metode === 'daring';
  const val = (daring ? u.link : u.tempat) || '';
  const safe = /^https?:\/\//i.test(val);
  return el('div', { class: 'field', style: 'margin-top:8px' },
    el('label', {}, daring ? '🔗 Ujian Daring' : '📍 Ujian Luring'),
    !val ? el('div', { class: 'muted small' }, daring ? 'Link belum diisi.' : 'Tempat belum diisi.')
      : (daring && safe) ? el('a', { href: val, target: '_blank', rel: 'noopener', style: 'color:var(--primary-d);word-break:break-all' }, val)
        : el('div', { style: 'word-break:break-all' }, val));
}

// Kartu jadwal ujian GABUNGAN per fase (satu jadwal untuk semua pembimbing).
// Disimpan di skripsi.ujian[fase]; file berkunci 'ujian:<mahasiswaId>:<fase>'.
function jadwalUjianCard(skripsi, type, ready, pendingMsg, allDocs, reload) {
  const mid = skripsi.mahasiswaId;
  const key = 'ujian:' + mid + ':' + type.key;
  const docs = (allDocs || []).filter(d => d.bimbinganId === key);
  const tanggal = (skripsi.ujian && skripsi.ujian[type.key]) ? skripsi.ujian[type.key].tanggal : '';
  const pengujiArr = (skripsi.ujian && skripsi.ujian[type.key] && skripsi.ujian[type.key].penguji) || [];
  const uObj = (skripsi.ujian && skripsi.ujian[type.key]) || {};
  const sudahUjian = tanggal && tanggal <= new Date().toISOString().slice(0, 10);
  const isMhsOwn = ME.role === 'mahasiswa' && ME.id === mid;
  const card = el('div', { class: 'card', style: 'margin-top:14px' });
  card.append(el('div', { class: 'li-head' },
    el('span', { class: 'bimb-no ujian' }, '🎓 ' + type.label),
    sudahUjian ? el('span', { class: 'tag selesai' }, 'sudah ujian') : (!ready ? el('span', { class: 'tag revisi' }, 'terkunci') : (tanggal ? el('span', { class: 'tag acc' }, 'terjadwal') : el('span', { class: 'tag revisi' }, 'belum diisi'))),
    el('span', { class: 'spacer', style: 'flex:1' }),
    el('span', { class: 'muted small' }, tanggal ? fmtDate(tanggal) : '')));
  if (isMhsOwn && !ready) {
    card.append(el('div', { class: 'small', style: 'margin-top:6px;color:var(--red)' }, '🔒 ' + (pendingMsg || 'Terkunci')));
    if (tanggal) card.append(el('div', { class: 'muted small', style: 'margin-top:6px' }, 'Tanggal: ' + fmtDate(tanggal)));
    docs.forEach(d => card.append(docToggleBlock(d)));
    return card;
  }
  if (isMhsOwn) {
    const tgl = el('input', { type: 'date', value: tanggal || '' });
    const penguji = pengujiPicker(pengujiArr);
    const metode = el('select', {}, el('option', { value: 'luring' }, 'Luring (tatap muka)'), el('option', { value: 'daring' }, 'Daring (online)'));
    metode.value = uObj.metode || 'luring';
    const linkInput = el('input', { type: 'url', placeholder: 'https://… (Zoom/Google Meet)', value: uObj.link || '' });
    const tempatInput = el('input', { type: 'text', placeholder: 'mis. Ruang Sidang Pascasarjana', value: uObj.tempat || '' });
    const linkField = el('div', { class: 'field' }, el('label', {}, '🔗 Link Daring'), linkInput);
    const tempatField = el('div', { class: 'field' }, el('label', {}, '📍 Tempat Luring'), tempatInput);
    const syncMetode = () => { const d = metode.value === 'daring'; linkField.hidden = !d; tempatField.hidden = d; };
    metode.addEventListener('change', syncMetode); syncMetode();
    const metodeBlock = el('div', {}, el('div', { class: 'field' }, el('label', {}, 'Metode Ujian'), metode), linkField, tempatField);
    const fileInput = el('input', { type: 'file', accept: '.pdf' });
    const uploadedBox = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' });
    const uploadBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
      const f = fileInput.files[0];
      if (!f) return toast('Pilih file PDF dulu', 'err');
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast('Hanya berkas PDF', 'err');
      if (f.size > 12 * 1024 * 1024) return toast('Berkas melebihi 12MB', 'err');
      try {
        const dataUrl = await readFileDataUrl(f);
        const res = await api('/documents', { method: 'POST', body: { nama: f.name, dataUrl, bimbinganId: key, mahasiswaId: mid } });
        toast('File terupload', 'ok'); fileInput.value = '';
        uploadedBox.append(el('div', { class: 'row-between', style: 'background:#eef7ee;border:1px solid #cfe8cf;border-radius:8px;padding:6px 10px' },
          el('span', {}, '📄 ' + esc(res.document.nama)), el('span', { class: 'muted small' }, 'Terupload ✓')));
      } catch (ex) { toast(ex.message, 'err'); }
    } }, '⬆️ Upload Berkas');
    const saveBtn = el('button', { class: 'btn btn-primary btn-block mt', onclick: async () => {
      if (!tgl.value) return toast('Pilih tanggal ujian', 'err');
      const daring = metode.value === 'daring';
      if (daring && !linkInput.value.trim()) return toast('Isi link ujian daring', 'err');
      if (!daring && !tempatInput.value.trim()) return toast('Isi tempat ujian luring', 'err');
      try { await api('/skripsi/' + mid, { method: 'PUT', body: { ujianJenis: type.key, ujianTanggal: tgl.value, ujianPenguji: penguji.get(), ujianMetode: metode.value, ujianLink: linkInput.value.trim(), ujianTempat: tempatInput.value.trim() } });
        toast('Jadwal ' + type.label + ' tersimpan', 'ok'); reload && reload(); } catch (ex) { toast(ex.message, 'err'); }
    } }, 'Simpan Jadwal');
    const form = el('div', {},
      el('div', { class: 'field', style: 'margin-top:8px' }, el('label', {}, 'Tanggal ' + type.label), tgl),
      metodeBlock,
      penguji.node,
      el('div', { class: 'field' }, el('label', {}, 'Berkas PDF'), fileInput),
      uploadBtn, uploadedBox, saveBtn);
    if (tanggal) {
      // Sudah terjadwal: tampilkan ringkasan + tombol Edit (form disembunyikan)
      card.append(el('div', { class: 'field', style: 'margin-top:8px' }, el('label', {}, 'Tanggal ' + type.label),
        el('div', { style: 'font-weight:800;font-size:18px;color:var(--primary-d)' }, fmtDate(tanggal))));
      card.append(pengujiReadonly(pengujiArr));
      const mr = ujianMetodeReadonly(uObj); if (mr) card.append(mr);
      if (docs.length) { card.append(el('div', { class: 'muted small', style: 'margin:6px 0' }, 'Berkas:')); docs.forEach(d => card.append(docToggleBlock(d))); }
      else card.append(el('div', { class: 'muted small' }, 'Belum ada berkas.'));
      form.hidden = true;
      const editBtn = el('button', { class: 'btn btn-ghost btn-sm mt', onclick: () => { form.hidden = false; editBtn.hidden = true; } }, '✏️ Edit Jadwal');
      card.append(editBtn, form);
    } else {
      card.append(el('div', { class: 'note-acc', style: 'margin-top:8px' }, 'Lengkapi jadwal ' + type.label.toLowerCase() + ' & unggah berkas.'));
      docs.forEach(d => card.append(docToggleBlock(d)));
      card.append(form);
    }
    if (sudahUjian && type.nextFase) {
      const p1 = skripsi.pembimbing1, p2 = skripsi.pembimbing2;
      card.append(el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }),
        el('div', { class: 'note-acc' }, '🎓 ' + type.label + ' telah dilaksanakan. Ajukan bimbingan ' + type.nextLabel + ':'),
        el('div', { class: 'row', style: 'gap:8px' },
          p1 ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => ajukanBimbinganForm(reload, p1, type.nextFase) }, '➡️ ke Promotor') : null,
          p2 ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => ajukanBimbinganForm(reload, p2, type.nextFase) }, '➡️ ke Co-Promotor') : null));
    }
  } else {
    card.append(el('div', { class: 'field', style: 'margin-top:8px' }, el('label', {}, 'Tanggal ' + type.label),
      el('div', { style: 'font-weight:800;font-size:18px;color:var(--primary-d)' }, tanggal ? fmtDate(tanggal) : 'Belum dijadwalkan')));
    card.append(pengujiReadonly(pengujiArr));
    const mr2 = ujianMetodeReadonly(uObj); if (mr2) card.append(mr2);
    if (docs.length) { card.append(el('div', { class: 'muted small', style: 'margin:6px 0' }, 'Berkas:')); docs.forEach(d => card.append(docToggleBlock(d))); }
    else card.append(el('div', { class: 'muted small' }, 'Belum ada berkas.'));
  }
  return card;
}

// Baris "Jadwal Ujian Proposal/Disertasi" di bawah bimbingan yang di-ACC
function jadwalUjianRow(b, opts, fase) {
  fase = fase || 'Proposal';
  const reload = opts && opts.reload;
  const docs = ((opts && opts.docs) || []).filter(d => d.bimbinganId === 'ujian:' + b.id);
  const sudahUjian = b.tanggalUjian && b.tanggalUjian <= new Date().toISOString().slice(0, 10);
  const ready = opts && opts.accReady ? opts.accReady(fase) : true;
  const pending = opts && opts.pendingAcc ? opts.pendingAcc(fase) : [];
  const row = el('div', { class: 'list-item bimb-item ujian', style: 'cursor:pointer', onclick: () => openJadwalUjianModal(b, (opts && opts.docs) || [], reload, fase, { ready, pending }) });
  row.append(el('div', { class: 'li-head' },
    el('span', { class: 'bimb-no ujian' }, '🎓 Jadwal Ujian ' + fase),
    sudahUjian ? el('span', { class: 'tag selesai' }, 'sudah ujian') : (!ready ? el('span', { class: 'tag revisi' }, 'menunggu ACC') : (b.tanggalUjian ? el('span', { class: 'tag acc' }, 'terjadwal') : el('span', { class: 'tag revisi' }, 'belum diisi'))),
    el('span', { class: 'spacer', style: 'flex:1' }),
    el('span', { class: 'muted small' }, b.tanggalUjian ? fmtDate(b.tanggalUjian) : '')));
  if (b.tanggalUjian) {
    row.append(el('div', { class: 'small', style: 'margin-top:4px;font-weight:600' },
      (sudahUjian ? '✅ Ujian ' + fase.toLowerCase() + ' telah dilaksanakan: ' : '📅 Ujian ' + fase.toLowerCase() + ' dijadwalkan: ') + fmtDate(b.tanggalUjian)));
  } else if (!ready) {
    row.append(el('div', { class: 'small', style: 'margin-top:4px;color:var(--red)' },
      '🔒 Dapat diisi setelah SEMUA pembimbing ACC' + (pending.length ? ' · menunggu: ' + pending.join(', ') : '')));
  } else {
    row.append(el('div', { class: 'muted small', style: 'margin-top:4px' },
      ME.role === 'mahasiswa' ? ('Klik untuk mengisi jadwal ujian ' + fase.toLowerCase() + ' & unggah file ' + fase.toLowerCase() + '.') : ('Menunggu mahasiswa mengisi jadwal ujian ' + fase.toLowerCase() + '.')));
  }
  if (docs.length) row.append(el('div', { class: 'small', style: 'margin-top:4px;color:var(--primary)' }, '📎 ' + docs.length + ' file ' + fase.toLowerCase() + ' · Klik untuk detail →'));
  return row;
}

// Popup khusus Jadwal Ujian (per fase): input jadwal + file (mahasiswa) / lihat (dosen)
function openJadwalUjianModal(b, allDocs, reload, fase, gate) {
  fase = fase || 'Proposal';
  gate = gate || { ready: true, pending: [] };
  const key = 'ujian:' + b.id;
  const docs = (allDocs || []).filter(d => d.bimbinganId === key);
  const sudahUjian = b.tanggalUjian && b.tanggalUjian <= new Date().toISOString().slice(0, 10);
  const body = el('div', {});
  body.append(el('div', { class: 'field' }, el('label', {}, 'Mahasiswa'), el('div', {}, esc(b.mahasiswaNama || userName(b.mahasiswaId)))));

  if (ME.role === 'mahasiswa' && b.mahasiswaId === ME.id && !gate.ready) {
    body.append(el('div', { class: 'note-revisi' }, '🔒 Jadwal ujian ' + fase.toLowerCase() + ' baru dapat diisi setelah bimbingan Promotor dan Co-Promotor di-ACC.'));
    if (gate.pending && gate.pending.length) body.append(el('div', { class: 'muted small', style: 'margin-top:8px' }, 'Menunggu ACC dari: ' + gate.pending.join(', ')));
    if (b.tanggalUjian) body.append(el('div', { class: 'field', style: 'margin-top:10px' }, el('label', {}, 'Tanggal Ujian ' + fase), el('div', {}, fmtDate(b.tanggalUjian))));
    if (docs.length) docs.forEach(d => body.append(docToggleBlock(d)));
  } else if (ME.role === 'mahasiswa' && b.mahasiswaId === ME.id) {
    const tgl = el('input', { type: 'date', value: b.tanggalUjian || '' });
    const fileInput = el('input', { type: 'file', accept: '.pdf' });
    const uploadedBox = el('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' });
    const uploadBtn = el('button', { class: 'btn btn-ghost', onclick: async () => {
      const f = fileInput.files[0];
      if (!f) return toast('Pilih file PDF dulu', 'err');
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast('Hanya berkas PDF', 'err');
      if (f.size > 12 * 1024 * 1024) return toast('Berkas melebihi 12MB', 'err');
      try {
        const dataUrl = await readFileDataUrl(f);
        const res = await api('/documents', { method: 'POST', body: { nama: f.name, dataUrl, bimbinganId: key } });
        toast('File terupload', 'ok'); fileInput.value = '';
        uploadedBox.append(el('div', { class: 'row-between', style: 'background:#eef7ee;border:1px solid #cfe8cf;border-radius:8px;padding:6px 10px' },
          el('span', {}, '📄 ' + esc(res.document.nama)), el('span', { class: 'muted small' }, 'Terupload ✓')));
      } catch (ex) { toast(ex.message, 'err'); }
    } }, '⬆️ Upload File ' + fase);
    body.append(
      el('div', { class: 'note-acc' }, fase + ' Anda sudah di-ACC dan siap diujikan. Lengkapi jadwal ujian dan unggah file ' + fase.toLowerCase() + '.'),
      el('div', { class: 'field' }, el('label', {}, 'Jadwal Ujian ' + fase), tgl));
    if (docs.length) docs.forEach(d => body.append(docToggleBlock(d)));
    body.append(
      el('div', { class: 'field' }, el('label', {}, 'File PDF ' + fase), fileInput),
      uploadBtn, uploadedBox,
      el('button', { class: 'btn btn-primary btn-block mt', onclick: async () => {
        if (!tgl.value) return toast('Pilih jadwal ujian', 'err');
        try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { tanggalUjian: tgl.value } });
          toast('Jadwal ujian tersimpan', 'ok'); closeModal(); reload && reload(); } catch (ex) { toast(ex.message, 'err'); }
      } }, 'Simpan Jadwal Ujian'));
    // Setelah ujian proposal: MAHASISWA mengajukan bimbingan tahap Disertasi
    if (fase === 'Proposal' && sudahUjian) {
      body.append(
        el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }),
        el('div', { class: 'note-acc' }, '🎓 Ujian proposal telah dilaksanakan. Silakan ajukan bimbingan tahap Disertasi kepada dosen.'),
        el('button', { class: 'btn btn-primary btn-block', onclick: () => { closeModal(); ajukanBimbinganForm(reload, b.dosenId, 'Disertasi'); } }, '➡️ Ajukan Bimbingan Disertasi'));
    }
  } else {
    body.append(el('div', { class: 'field' }, el('label', {}, 'Tanggal Ujian ' + fase),
      el('div', { style: 'font-weight:800;font-size:18px;color:var(--primary-d)' }, b.tanggalUjian ? fmtDate(b.tanggalUjian) : 'Belum diisi mahasiswa')));
    if (docs.length) { body.append(el('div', { class: 'muted small', style: 'margin:6px 0' }, 'File ' + fase + ':')); docs.forEach(d => body.append(docToggleBlock(d))); }
    else body.append(el('div', { class: 'muted small' }, 'Belum ada file ' + fase.toLowerCase() + '.'));
    // Setelah ujian proposal, mahasiswa yang mengajukan bimbingan Disertasi (dosen menunggu)
    if (ME.role === 'dosen' && fase === 'Proposal' && sudahUjian) {
      body.append(el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }),
        el('div', { class: 'muted small' }, 'Menunggu mahasiswa mengajukan bimbingan tahap Disertasi.'));
    }
  }
  openModal('🎓 Jadwal Ujian ' + fase, body, { wide: docs.length > 0 });
}

async function bimbinganForm(existing, fixedMahasiswaId, onDone, judulForm) {
  // Dosen meminta revisi -> membuat entri bimbingan baru (dihitung 1 kali bimbingan)
  const body = el('div', {});
  const { skripsi } = await api('/skripsi');
  const opts = skripsi.map(s => el('option', { value: s.mahasiswaId, ...(s.mahasiswaId === fixedMahasiswaId ? { selected: 'selected' } : {}) }, s.mahasiswa?.nama || '-'));
  const partnerSelect = el('select', {}, ...opts);
  if (!skripsi.length) { toast('Belum ada mahasiswa bimbingan', 'err'); return; }
  body.append(el('div', { class: 'field' }, el('label', {}, 'Mahasiswa'), partnerSelect));
  const tgl = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const PRESET_TOPIK = ['Judul', 'Abstrak', 'Bab 1', 'Bab 2', 'Bab 3', 'Bab 4', 'Bab 5', 'Kajian Teori', 'Metodologi Penelitian', 'Instrumen', 'Analisis Data', 'Tata Tulis & Sitasi', 'Daftar Pustaka'];
  const topikSelected = new Set();
  const topikChips = el('div', { class: 'chip-wrap' });
  const topikInput = el('input', { type: 'text', placeholder: 'Ketik topik lain lalu tekan Enter / Tambah' });
  function renderTopikChips() {
    topikChips.innerHTML = '';
    PRESET_TOPIK.forEach(t => topikChips.append(el('button', { type: 'button', class: 'chip' + (topikSelected.has(t) ? ' chip-on' : ''), onclick: () => { topikSelected.has(t) ? topikSelected.delete(t) : topikSelected.add(t); renderTopikChips(); } }, t)));
    [...topikSelected].filter(t => !PRESET_TOPIK.includes(t)).forEach(t => topikChips.append(el('button', { type: 'button', class: 'chip chip-on chip-custom', onclick: () => { topikSelected.delete(t); renderTopikChips(); } }, t + ' ✕')));
  }
  function addTopikCustom() { const v = topikInput.value.trim(); if (v) { topikSelected.add(v); topikInput.value = ''; renderTopikChips(); } }
  topikInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTopikCustom(); } });
  const topikAddBtn = el('button', { type: 'button', class: 'btn btn-sm', onclick: addTopikCustom }, 'Tambah');
  renderTopikChips();
  const metode = el('select', {}, el('option', { value: 'Tatap muka' }, 'Tatap muka'), el('option', { value: 'Daring' }, 'Daring'));
  const tempat = el('input', { type: 'text', placeholder: 'mis. Ruang Prodi / Lab Komputer' });
  const aplikasi = el('select', {}, el('option', {}, 'Aplikasi ini'), el('option', {}, 'Virtual Meet'));
  const fieldTempat = el('div', { class: 'field' }, el('label', {}, 'Tempat'), tempat);
  const fieldAplikasi = el('div', { class: 'field' }, el('label', {}, 'Media'), aplikasi);
  const catatan = el('textarea', { rows: 4, placeholder: 'Tulis catatan revisi / perbaikan yang harus dilakukan mahasiswa…' });
  function toggleMetode() {
    const isTM = metode.value === 'Tatap muka';
    fieldTempat.style.display = isTM ? '' : 'none';
    fieldAplikasi.style.display = isTM ? 'none' : '';
  }
  metode.addEventListener('change', toggleMetode);
  body.append(
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Tanggal'), tgl),
      el('div', { class: 'field' }, el('label', {}, 'Metode'), metode)),
    fieldTempat, fieldAplikasi,
    el('div', { class: 'field' },
      el('label', {}, 'Topik / Materi ', el('span', { style: 'color:var(--red)' }, '*')),
      topikChips,
      el('div', { class: 'two-col', style: 'grid-template-columns:1fr auto;gap:8px;align-items:end' }, topikInput, topikAddBtn)),
    el('div', { class: 'field' }, el('label', {}, 'Catatan Revisi'), catatan),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const metodeStr = metode.value === 'Tatap muka'
        ? (tempat.value.trim() ? 'Tatap muka — ' + tempat.value.trim() : 'Tatap muka')
        : 'Daring — ' + aplikasi.value;
      const payload = { tanggal: tgl.value, topik: [...topikSelected].join(', '), metode: metodeStr, catatan: catatan.value.trim(), mahasiswaId: partnerSelect.value, status: 'revisi' };
      if (!topikSelected.size) return toast('Pilih atau ketik minimal 1 topik/materi', 'err');
      if (!payload.catatan) return toast('Catatan revisi wajib diisi', 'err');
      if (!payload.mahasiswaId) return toast('Pilih mahasiswa', 'err');
      if (metode.value === 'Tatap muka' && !tempat.value.trim()) return toast('Tempat wajib diisi', 'err');
      try { await api('/bimbingan', { method: 'POST', body: payload });
        toast('Revisi dikirim ke mahasiswa', 'ok'); closeModal();
        if (onDone) onDone(); else if (fixedMahasiswaId) openSkripsiDetail(fixedMahasiswaId); else navigate('bimbingan'); }
      catch (ex) { toast(ex.message, 'err'); }
    } }, 'Kirim Revisi'));
  openModal(judulForm || 'Minta Revisi ke Mahasiswa', body);
  toggleMetode();
}

// Mahasiswa mengajukan bimbingan PERTAMA kali (sekali saja)
async function ajukanBimbinganForm(onDone, fixedDosenId, fase) {
  fase = ['Proposal', 'Hasil', 'Tutup', 'Promosi'].includes(fase) ? fase : 'Proposal';
  const isLanjut = fase !== 'Proposal';
  const { skripsi } = await api('/skripsi/' + ME.id);
  const pembimbing = [skripsi.pembimbing1, skripsi.pembimbing2].filter(Boolean);
  const dosenSelect = el('select', {}, ...(pembimbing.length
    ? pembimbing.map(id => el('option', { value: id, ...(id === fixedDosenId ? { selected: 'selected' } : {}) }, userName(id)))
    : [el('option', { value: '' }, '(Promotor belum ditetapkan)')]));
  if (fixedDosenId) dosenSelect.disabled = true;
  const tgl = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const topik = el('input', { type: 'text', placeholder: isLanjut ? ('mis. Persiapan ' + fase) : 'mis. Konsultasi awal / pengajuan judul' });
  const catatan = el('textarea', { rows: 3, placeholder: isLanjut ? ('Hal yang ingin dikonsultasikan untuk tahap ' + fase + '…') : 'Hal yang ingin dikonsultasikan pertama kali…' });
  const file = el('input', { type: 'file', accept: '.pdf' });
  const body = el('div', {},
    el('div', { class: 'muted small', style: 'margin-bottom:10px' }, isLanjut ? ('Pengajuan bimbingan tahap ' + fase + '. Tahapan berikutnya ditentukan oleh promotor.') : 'Pengajuan ini hanya sekali. Metode & tahapan berikutnya ditentukan oleh promotor.'),
    el('div', { class: 'field' }, el('label', {}, 'Promotor / Co-Promotor'), dosenSelect),
    el('div', { class: 'field' }, el('label', {}, 'Tanggal'), tgl),
    el('div', { class: 'field' }, el('label', {}, 'Topik'), topik),
    el('div', { class: 'field' }, el('label', {}, 'Catatan / Pertanyaan'), catatan),
    el('div', { class: 'field' }, el('label', {}, 'Lampiran PDF (opsional, maks 12MB)'), file),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      if (!topik.value.trim()) return toast('Topik wajib diisi', 'err');
      if (!dosenSelect.value) return toast('Promotor belum ditetapkan admin', 'err');
      const f = file.files[0];
      if (f && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast('Lampiran harus berupa PDF', 'err');
      if (f && f.size > 12 * 1024 * 1024) return toast('Berkas melebihi 12MB', 'err');
      try {
        const { bimbingan } = await api('/bimbingan', { method: 'POST', body: { dosenId: dosenSelect.value, tanggal: tgl.value, topik: topik.value.trim(), catatan: catatan.value.trim(), fase } });
        if (f) {
          const dataUrl = await readFileDataUrl(f);
          await api('/documents', { method: 'POST', body: { nama: f.name, dataUrl, bimbinganId: bimbingan.id } });
        }
        toast('Pengajuan bimbingan terkirim', 'ok'); closeModal(); onDone ? onDone() : navigate('bimbingan');
      } catch (ex) { toast(ex.message, 'err'); }
    } }, isLanjut ? ('Ajukan Bimbingan ' + fase) : 'Ajukan Bimbingan'));
  openModal(isLanjut ? ('Ajukan Bimbingan ' + fase) : 'Ajukan Bimbingan Pertama', body);
}

// Mahasiswa memberi tanggapan pada tahapan bimbingan
function catatanMhsForm(b, onDone) {
  const catatan = el('textarea', { rows: 4, placeholder: 'Tanggapan / catatan Anda…' }, b.catatanMhs || '');
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Tanggapan Mahasiswa'), catatan),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { catatanMhs: catatan.value.trim() } });
        toast('Tersimpan', 'ok'); closeModal(); onDone && onDone(); } catch (ex) { toast(ex.message, 'err'); }
    } }, 'Simpan'));
  openModal('Tanggapan Bimbingan', body);
}

function reviewBimbingan(b, onDone) {
  const catatan = el('textarea', { rows: 4, placeholder: 'Arahan untuk mahasiswa…' }, b.catatanDosen || '');
  const metode = el('select', {}, ...['Tatap muka', 'Daring (Zoom/Meet)', 'WhatsApp', 'Email'].map(m =>
    el('option', { value: m, ...(m === b.metode ? { selected: 'selected' } : {}) }, m)));
  const status = el('select', {}, ...['dijadwalkan', 'selesai', 'batal'].map(s =>
    el('option', { value: s, ...(s === b.status ? { selected: 'selected' } : {}) }, s)));
  const body = el('div', {},
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Metode'), metode),
      el('div', { class: 'field' }, el('label', {}, 'Status'), status)),
    el('div', { class: 'field' }, el('label', {}, 'Catatan Dosen'), catatan),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { catatanDosen: catatan.value.trim(), status: status.value, metode: metode.value } });
        toast('Tersimpan', 'ok'); closeModal(); onDone ? onDone() : navigate('bimbingan'); } catch (ex) { toast(ex.message, 'err'); }
    } }, 'Simpan'));
  openModal('Beri Catatan Bimbingan', body);
}

async function delBimbingan(id, onDone) {
  if (!confirm('Hapus tahapan bimbingan ini?')) return;
  try { await api('/bimbingan/' + id, { method: 'DELETE' }); toast('Dihapus', 'ok'); onDone ? onDone() : navigate('bimbingan'); }
  catch (ex) { toast(ex.message, 'err'); }
}

async function setujuiBimbingan(b, onDone) {
  try { await api('/bimbingan/' + b.id, { method: 'PUT', body: { status: 'disetujui' } });
    toast('Pengajuan disetujui', 'ok'); onDone ? onDone() : navigate('bimbingan'); }
  catch (ex) { toast(ex.message, 'err'); }
}

function waNotify(target, b) {
  const num = String(target.wa).replace(/\D/g, '').replace(/^0/, '62');
  const teks = `Halo ${target.nama}, terkait bimbingan disertasi "${b.topik}" pada ${fmtDate(b.tanggal)}. Terima kasih.`;
  window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(teks), '_blank');
}

// ---------------- DOKUMEN ----------------
VIEWS.dokumen = async (c) => {
  c.innerHTML = '';
  const isMhs = ME.role === 'mahasiswa';
  c.append(pageHead('Dokumen & Revisi', isMhs ? el('button', { class: 'btn btn-primary', onclick: () => uploadForm() }, '⬆️ Unggah Dokumen') : null));

  let mahasiswaFilter = '';
  if (!isMhs) {
    const { skripsi } = await api('/skripsi');
    const sel = el('select', { onchange: () => loadDocs(sel.value) }, el('option', { value: '' }, 'Semua mahasiswa'),
      ...skripsi.map(s => el('option', { value: s.mahasiswaId }, s.mahasiswa?.nama || '-')));
    c.append(el('div', { class: 'card', style: 'margin-bottom:16px' }, el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Filter Mahasiswa'), sel)));
  }
  const listBox = el('div', {});
  c.append(listBox);

  async function loadDocs(mid) {
    listBox.innerHTML = '';
    const { documents } = await api('/documents' + (mid ? '?mahasiswaId=' + mid : ''));
    if (!documents.length) { listBox.append(el('div', { class: 'empty' }, 'Belum ada dokumen.')); return; }
    documents.forEach(d => {
      const item = el('div', { class: 'list-item' },
        el('div', { class: 'row-between' },
          el('div', {}, el('b', {}, '📄 ' + esc(d.nama)),
            el('div', { class: 'muted small' }, 'Oleh ' + esc(d.uploaderNama || userName(d.uploadedBy)) + ' · ' + fmtDate(d.createdAt) + ' · ' + fmtSize(d.ukuran))),
          el('div', { class: 'row' },
            el('a', { class: 'btn btn-sm btn-ghost', href: d.file, target: '_blank' }, 'Buka'),
            (d.uploadedBy === ME.id || ME.role === 'admin') ? el('button', { class: 'btn btn-sm btn-danger', onclick: () => delDoc(d.id, () => loadDocs(mid)) }, 'Hapus') : null)));
      listBox.append(item);
    });
  }
  loadDocs(mahasiswaFilter);
  VIEWS.dokumen._reload = loadDocs;
};

function uploadForm(opts) {
  opts = opts || {};
  const pdfOnly = !!opts.pdfOnly;
  const file = el('input', { type: 'file', accept: pdfOnly ? '.pdf' : '.pdf,.doc,.docx,.png,.jpg,.jpeg' });
  const nama = el('input', { type: 'text', placeholder: 'mis. Draft Bab 1 - Revisi 2' });
  const body = el('div', {},
    opts.bimbinganId ? el('div', { class: 'muted small', style: 'margin-bottom:10px' }, 'Dokumen akan dilampirkan pada tahapan bimbingan ini.') : null,
    el('div', { class: 'field' }, el('label', {}, 'Nama / Judul Dokumen'), nama),
    el('div', { class: 'field' }, el('label', {}, pdfOnly ? 'Berkas PDF (maks 12MB)' : 'Berkas (PDF/DOC/gambar, maks 12MB)'), file),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const f = file.files[0];
      if (!f) return toast('Pilih berkas dulu', 'err');
      if (pdfOnly && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast('Hanya berkas PDF yang diperbolehkan', 'err');
      if (f.size > 12 * 1024 * 1024) return toast('Berkas melebihi 12MB', 'err');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const payload = { nama: (nama.value.trim() || f.name), dataUrl: reader.result };
          if (opts.bimbinganId) payload.bimbinganId = opts.bimbinganId;
          await api('/documents', { method: 'POST', body: payload });
          toast('Dokumen terunggah', 'ok'); closeModal();
          if (opts.onDone) opts.onDone();
          else if (VIEWS.dokumen._reload) VIEWS.dokumen._reload('');
          else navigate('dokumen');
        } catch (ex) { toast(ex.message, 'err'); }
      };
      reader.readAsDataURL(f);
    } }, 'Unggah'));
  openModal(opts.bimbinganId ? 'Upload Dokumen PDF' : 'Unggah Dokumen', body);
}

async function delDoc(id, cb) {
  if (!confirm('Hapus dokumen ini?')) return;
  try { await api('/documents/' + id, { method: 'DELETE' }); toast('Dihapus', 'ok'); cb && cb(); }
  catch (ex) { toast(ex.message, 'err'); }
}

// ---------------- TIMELINE ----------------
VIEWS.timeline = async (c) => {
  c.innerHTML = '';
  const isMhs = ME.role === 'mahasiswa';
  c.append(pageHead('Timeline & Deadline', el('button', { class: 'btn btn-primary', onclick: () => timelineForm() }, '+ Tambah Target')));

  let mid = isMhs ? ME.id : '';
  if (!isMhs) {
    const { skripsi } = await api('/skripsi');
    const sel = el('select', { onchange: () => load(sel.value) }, el('option', { value: '' }, 'Semua'),
      ...skripsi.map(s => el('option', { value: s.mahasiswaId }, s.mahasiswa?.nama || '-')));
    c.append(el('div', { class: 'card', style: 'margin-bottom:16px' }, el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Mahasiswa'), sel)));
    VIEWS.timeline._mhsList = skripsi;
  }
  const box = el('div', {});
  c.append(box);

  async function load(filterMid) {
    box.innerHTML = '';
    const { timeline } = await api('/timeline' + (filterMid ? '?mahasiswaId=' + filterMid : ''));
    if (!timeline.length) { box.append(el('div', { class: 'empty' }, 'Belum ada target/deadline.')); return; }
    const today = new Date().toISOString().slice(0, 10);
    timeline.forEach(t => {
      const overdue = !t.selesai && t.tanggal && t.tanggal < today;
      box.append(el('div', { class: 'list-item' },
        el('div', { class: 'row-between' },
          el('div', { class: 'row' },
            el('input', { type: 'checkbox', ...(t.selesai ? { checked: 'checked' } : {}),
              onchange: async ev => { try { await api('/timeline/' + t.id, { method: 'PUT', body: { selesai: ev.target.checked } }); load(filterMid); } catch (ex) { toast(ex.message, 'err'); } } }),
            el('div', {}, el('b', { style: t.selesai ? 'text-decoration:line-through;color:var(--muted)' : '' }, esc(t.judul)),
              el('div', { class: 'muted small' }, (t.tanggal ? fmtDate(t.tanggal) : 'Tanpa tanggal') + (overdue ? ' · ⚠️ Terlewat' : '')))),
          el('button', { class: 'icon-btn', onclick: () => delTimeline(t.id, () => load(filterMid)) }, '🗑️')),
      ));
    });
  }
  load(mid);
  VIEWS.timeline._reload = load;
  VIEWS.timeline._defaultMid = mid;
};

async function timelineForm() {
  const isMhs = ME.role === 'mahasiswa';
  const judul = el('input', { type: 'text', placeholder: 'mis. Selesaikan Bab 3' });
  const tgl = el('input', { type: 'date' });
  const body = el('div', {});
  let midSelect = null;
  if (!isMhs) {
    const list = VIEWS.timeline._mhsList || (await api('/skripsi')).skripsi;
    midSelect = el('select', {}, ...list.map(s => el('option', { value: s.mahasiswaId }, s.mahasiswa?.nama || '-')));
    body.append(el('div', { class: 'field' }, el('label', {}, 'Mahasiswa'), midSelect));
  }
  body.append(
    el('div', { class: 'field' }, el('label', {}, 'Target / Deadline'), judul),
    el('div', { class: 'field' }, el('label', {}, 'Tanggal'), tgl),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      if (!judul.value.trim()) return toast('Judul wajib diisi', 'err');
      const payload = { judul: judul.value.trim(), tanggal: tgl.value };
      if (!isMhs) payload.mahasiswaId = midSelect.value;
      try { await api('/timeline', { method: 'POST', body: payload }); toast('Ditambahkan', 'ok'); closeModal();
        if (VIEWS.timeline._reload) VIEWS.timeline._reload(VIEWS.timeline._defaultMid || ''); } catch (ex) { toast(ex.message, 'err'); }
    } }, 'Simpan'));
  openModal('Tambah Target', body);
}

async function delTimeline(id, cb) {
  if (!confirm('Hapus target ini?')) return;
  try { await api('/timeline/' + id, { method: 'DELETE' }); cb && cb(); } catch (ex) { toast(ex.message, 'err'); }
}

// ---------------- MONITORING (kaprodi/admin) ----------------
VIEWS.monitoring = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('Monitoring Progres'));
  const { ringkasan, mahasiswa } = await api('/stats');
  c.append(el('div', { class: 'grid grid-stats' },
    statCard(ringkasan.totalMahasiswa, 'Mahasiswa'),
    statCard(ringkasan.totalDosen, 'Dosen'),
    statCard(ringkasan.rataProgres + '%', 'Rata-rata Progres'),
    statCard(ringkasan.totalBimbingan, 'Total Bimbingan')));
  const box = el('div', { class: 'card mt' }, el('h3', {}, 'Seluruh Mahasiswa'));
  box.append(mahasiswaPanel(mahasiswa));
  c.append(box);
};

function mahasiswaTable(rows) {
  const wrap = el('div', { class: 'table-wrap' });
  const t = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, 'Nama'), el('th', {}, 'Tahun Masuk'), el('th', {}, 'Judul'),
      el('th', {}, 'Promotor'), el('th', {}, 'Co-Promotor'),
      el('th', {}, 'Progres Bimbingan'), el('th', {}, 'Bimbingan Terakhir'))));
  const tb = el('tbody', {});
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'Belum ada data.')));
  rows.forEach(r => tb.append(el('tr', { class: 'rowlink', title: 'Klik untuk melihat detail bimbingan', onclick: () => openSkripsiDetail(r.mahasiswaId) },
    el('td', {}, el('b', {}, esc(r.nama)), el('div', { class: 'muted small' }, esc(r.username))),
    el('td', {}, esc(r.tahunMasuk || '-')),
    el('td', {}, esc(r.judul)),
    el('td', {}, esc(r.pembimbing1)),
    el('td', {}, esc(r.pembimbing2)),
    el('td', { style: 'min-width:150px' }, progressBar(r.progres, true),
      el('div', { class: 'muted small' }, r.progres + '% · ' + r.jmlBimbingan + '/' + (r.target || 8) + ' bimbingan' + (r.bimbinganSelesai ? ' (' + r.bimbinganSelesai + ' selesai)' : ''))),
    el('td', {}, r.lastTanggal ? el('div', {}, el('div', {}, esc(r.lastTopik || '-')), el('div', { class: 'muted small' }, fmtDate(r.lastTanggal))) : el('span', { class: 'muted small' }, 'Belum ada')))));
  t.append(tb); wrap.append(t); return wrap;
}

// Panel mahasiswa dengan filter (cari + Tahun Masuk + Promotor)
function mahasiswaPanel(rows) {
  const search = el('input', { type: 'text', placeholder: '🔍 Cari nama / NIM / judul…', style: 'flex:1 1 180px;min-width:140px;width:auto' });
  const tahunOpts = [...new Set(rows.map(r => r.tahunMasuk).filter(x => x && x !== '-'))].sort();
  const promOpts = [...new Set(rows.map(r => r.pembimbing1).filter(x => x && x !== '-'))].sort();
  const tahunSel = el('select', { style: 'flex:0 1 auto;width:auto' }, el('option', { value: '' }, 'Semua Tahun Masuk'),
    tahunOpts.map(y => el('option', { value: y }, y)));
  const promSel = el('select', { style: 'flex:0 1 auto;width:auto' }, el('option', { value: '' }, 'Semua Promotor'),
    promOpts.map(p => el('option', { value: p }, p)));
  const info = el('div', { class: 'muted small', style: 'margin-left:auto;white-space:nowrap' }, '');
  const host = el('div', {});
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    const ty = tahunSel.value, pr = promSel.value;
    const filtered = rows.filter(r =>
      (!ty || r.tahunMasuk === ty) &&
      (!pr || r.pembimbing1 === pr) &&
      (!q || ((r.nama || '') + ' ' + (r.username || '') + ' ' + (r.judul || '')).toLowerCase().includes(q)));
    host.innerHTML = '';
    host.append(mahasiswaTable(filtered));
    info.textContent = filtered.length + ' / ' + rows.length + ' mahasiswa';
  };
  search.addEventListener('input', apply);
  tahunSel.addEventListener('change', apply);
  promSel.addEventListener('change', apply);
  apply();
  return el('div', {}, el('div', { class: 'row', style: 'gap:8px;margin-bottom:12px' }, search, tahunSel, promSel, info), host);
}

// ---------------- KELOLA PENGGUNA (admin) ----------------
VIEWS.users = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('Kelola Pengguna', el('div', { class: 'row', style: 'gap:8px' },
    el('button', { class: 'btn btn-ghost', onclick: downloadUserTemplate }, '⬇️ Template Excel'),
    el('button', { class: 'btn btn-ghost', onclick: importUsersExcel }, '⬆️ Impor Excel'),
    el('button', { class: 'btn btn-primary', onclick: () => userForm() }, '+ Tambah Pengguna'))));
  const { users } = await api('/users');
  USERS_CACHE = users;
  try { const pr = await api('/prodi'); PRODI_CACHE = pr.prodi || []; } catch (e) { PRODI_CACHE = []; }
  // Panel penyimpanan: pantau ukuran & bersihkan berkas yatim
  try {
    const st = await api('/maintenance/storage');
    c.append(el('div', { class: 'card mt' },
      el('div', { class: 'row-between', style: 'align-items:center;gap:10px;flex-wrap:wrap' },
        el('div', {},
          el('h3', { style: 'margin:0' }, '🗄️ Penyimpanan Dokumen'),
          el('div', { class: 'muted small', style: 'margin-top:4px' },
            st.docCount + ' dokumen · ' + st.fileCount + ' berkas · ' + fmtSize(st.totalBytes) + ' terpakai'
            + (st.orphanCount ? ' · ' + st.orphanCount + ' berkas yatim (' + fmtSize(st.orphanBytes) + ')' : ' · tidak ada berkas yatim'))),
        st.orphanCount ? el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          if (!confirm('Hapus ' + st.orphanCount + ' berkas yatim (' + fmtSize(st.orphanBytes) + ')? Hanya berkas yang tidak lagi dirujuk dokumen mana pun yang dihapus.')) return;
          try { const r = await api('/maintenance/cleanup', { method: 'POST' }); toast(r.removed + ' berkas dihapus · ' + fmtSize(r.freed) + ' dibebaskan', 'ok'); navigate('users'); }
          catch (ex) { toast(ex.message, 'err'); }
        } }, '🧹 Bersihkan Berkas Yatim') : null)));
  } catch (e) { /* abaikan bila gagal */ }
  const roles = ['mahasiswa', 'dosen', 'kaprodi', 'admin'];
  roles.forEach(role => {
    const group = users.filter(u => u.role === role);
    if (!group.length) return;
    const box = el('div', { class: 'card mt' }, el('h3', {}, roleLabel(role) + ' (' + group.length + ')'));
    const wrap = el('div', { class: 'table-wrap' });
    const isMhs = role === 'mahasiswa';
    const headCells = [el('th', {}, 'Nama'), el('th', {}, 'Username'), el('th', {}, 'Prodi')];
    if (isMhs) headCells.push(el('th', {}, 'Tahun Masuk'));
    headCells.push(el('th', {}, 'WA'), el('th', {}, 'Aksi'));
    const t = el('table', {}, el('thead', {}, el('tr', {}, headCells)));
    const tb = el('tbody', {});
    group.forEach(u => {
      const cells = [el('td', {}, esc(u.nama)), el('td', {}, esc(u.username)), el('td', {}, esc(u.prodi || '-'))];
      if (isMhs) cells.push(el('td', {}, esc(u.tahunMasuk || '-')));
      cells.push(el('td', {}, esc(u.wa || '-')),
        el('td', {}, el('div', { class: 'row' },
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => userForm(u) }, 'Edit'),
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => resetPass(u) }, 'Reset PW'),
          u.id !== ME.id ? el('button', { class: 'btn btn-sm btn-danger', onclick: () => delUser(u.id) }, 'Hapus') : null)));
      tb.append(el('tr', {}, cells));
    });
    t.append(tb); wrap.append(t); box.append(wrap); c.append(box);
  });
};

// Impor & template pengguna via Excel (SheetJS di-vendor lokal)
function downloadUserTemplate() {
  if (!window.XLSX) return toast('Pustaka Excel belum termuat', 'err');
  const header = ['nama', 'username', 'role', 'prodi', 'tahun_masuk', 'wa', 'password', 'judul', 'promotor', 'copromotor'];
  const contoh = [
    ['Dr. Andi Dosen, M.Pd.', '198501012010011001', 'dosen', 'S-3 Pendidikan', '', '08123456789', '', '', '', ''],
    ['Budi Mahasiswa', '2024001', 'mahasiswa', 'S-3 Pendidikan', '2024', '08987654321', '', 'Judul disertasi contoh', '198501012010011001', '']
  ];
  const ws = XLSX.utils.aoa_to_sheet([header, ...contoh]);
  ws['!cols'] = [22, 20, 12, 18, 12, 15, 14, 40, 22, 22].map(w => ({ wch: w }));
  const petunjuk = XLSX.utils.aoa_to_sheet([
    ['PETUNJUK PENGISIAN TEMPLATE PENGGUNA DOCTORALSYNC'],
    [''],
    ['Kolom', 'Keterangan'],
    ['nama', 'Nama lengkap (wajib)'],
    ['username', 'NIM (mahasiswa) / NUPTK (dosen) — wajib & unik'],
    ['role', 'mahasiswa / dosen / kaprodi / admin (wajib)'],
    ['prodi', 'Program Studi — isi Kode atau Nama sesuai Master Prodi (mis. S-3 Pendidikan)'],
    ['tahun_masuk', 'Tahun masuk — khusus mahasiswa, mis. 2024 (opsional)'],
    ['wa', 'Nomor WhatsApp, mis. 08xxxx (opsional)'],
    ['password', 'Kata sandi awal (opsional; default: sama dengan username / NIM / NUPTK)'],
    ['judul', 'Judul disertasi — khusus mahasiswa (opsional)'],
    ['promotor', 'NUPTK atau nama dosen promotor — khusus mahasiswa (opsional)'],
    ['copromotor', 'NUPTK atau nama dosen co-promotor — khusus mahasiswa (opsional)'],
    [''],
    ['Catatan: impor DOSEN terlebih dahulu, lalu MAHASISWA, agar promotor/co-promotor dapat dikenali.']
  ]);
  petunjuk['!cols'] = [{ wch: 14 }, { wch: 72 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.utils.book_append_sheet(wb, petunjuk, 'Petunjuk');
  XLSX.writeFile(wb, 'template-pengguna-doctoralsync.xlsx');
}

function importUsersExcel() {
  if (!window.XLSX) return toast('Pustaka Excel belum termuat', 'err');
  const input = el('input', { type: 'file', accept: '.xlsx,.xls,.csv', style: 'display:none' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const rows = raw.map(r => {
        const g = k => { const kk = Object.keys(r).find(x => String(x).trim().toLowerCase() === k); return kk ? String(r[kk]).trim() : ''; };
        return { nama: g('nama'), username: g('username'), role: g('role').toLowerCase(), prodi: g('prodi'), tahunMasuk: g('tahun_masuk') || g('tahun masuk') || g('tahunmasuk'), wa: g('wa'), password: g('password'), judul: g('judul'), promotor: g('promotor'), copromotor: g('copromotor') };
      }).filter(r => r.nama || r.username);
      if (!rows.length) return toast('Tidak ada baris data pada file', 'err');
      openImportPreview(rows);
    } catch (ex) { toast('Gagal membaca file: ' + ex.message, 'err'); }
  });
  input.click();
}

function openImportPreview(rows) {
  const body = el('div', {});
  body.append(el('div', { class: 'muted small', style: 'margin-bottom:8px' }, rows.length + ' baris terbaca. Periksa data lalu klik Impor.'));
  const wrap = el('div', { class: 'table-wrap', style: 'max-height:320px;overflow:auto' });
  const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Nama'), el('th', {}, 'Username'), el('th', {}, 'Peran'), el('th', {}, 'Prodi'))));
  const tb = el('tbody', {});
  rows.forEach((r, i) => tb.append(el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, esc(r.nama)), el('td', {}, esc(r.username)), el('td', {}, esc(r.role || '-')), el('td', {}, esc(r.prodi || '-')))));
  t.append(tb); wrap.append(t); body.append(wrap);
  const result = el('div', { class: 'mt' });
  const btn = el('button', { class: 'btn btn-primary btn-block mt', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Mengimpor…';
    try {
      const res = await api('/users/import', { method: 'POST', body: { rows } });
      const okN = res.created || 0, errs = res.errors || [];
      result.innerHTML = '';
      if (okN) navigate('users');
      if (errs.length) {
        toast(okN + ' dibuat, ' + errs.length + ' gagal', okN ? 'ok' : 'err');
        result.append(el('div', { class: 'note-revisi' }, '⚠️ ' + errs.length + ' baris gagal diimpor:'));
        const ew = el('div', { class: 'table-wrap', style: 'max-height:200px;overflow:auto' });
        const et = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Baris'), el('th', {}, 'Username'), el('th', {}, 'Alasan'))));
        const etb = el('tbody', {});
        errs.forEach(e => etb.append(el('tr', {}, el('td', {}, String(e.row || '-')), el('td', {}, esc(e.username || '-')), el('td', {}, esc(e.error)))));
        et.append(etb); ew.append(et); result.append(ew);
        btn.disabled = false; btn.textContent = 'Coba Impor Ulang';
      } else {
        toast(okN + ' pengguna berhasil diimpor', 'ok');
        closeModal();
      }
    } catch (ex) { btn.disabled = false; btn.textContent = 'Impor Sekarang'; toast(ex.message, 'err'); }
  } }, 'Impor Sekarang');
  body.append(btn, result);
  openModal('⬆️ Impor Pengguna (Excel)', body, { wide: true });
}

function userForm(existing) {
  const isEdit = !!existing;
  const nama = el('input', { type: 'text', value: existing?.nama || '' });
  const username = el('input', { type: 'text', value: existing?.username || '', ...(isEdit ? { disabled: 'disabled' } : {}) });
  const role = el('select', {}, ...['mahasiswa', 'dosen', 'kaprodi', 'admin'].map(r =>
    el('option', { value: r, ...(existing?.role === r ? { selected: 'selected' } : {}) }, roleLabel(r))));
  const prodiOptions = [el('option', { value: '' }, '— Pilih Program Studi —')];
  PRODI_CACHE.forEach(p => prodiOptions.push(el('option', { value: p.nama, ...(existing?.prodi === p.nama ? { selected: 'selected' } : {}) }, p.kode + ' — ' + p.nama)));
  if (existing?.prodi && !PRODI_CACHE.some(p => p.nama === existing.prodi)) prodiOptions.push(el('option', { value: existing.prodi, selected: 'selected' }, existing.prodi));
  const prodi = el('select', {}, prodiOptions);
  const wa = el('input', { type: 'text', placeholder: '08xxx', value: existing?.wa || '' });
  const pass = el('input', { type: 'text', placeholder: 'default: sama dengan username (NIM/NUPTK)' });
  const tahunMasuk = el('input', { type: 'number', min: '2000', max: '2100', placeholder: 'mis. 2024', value: existing?.tahunMasuk || '' });
  const judul = el('input', { type: 'text', placeholder: 'Judul disertasi (opsional)' });

  const dosenOpts = () => USERS_CACHE.filter(u => u.role === 'dosen');
  const p1 = el('select', {}, el('option', { value: '' }, '—'), ...dosenOpts().map(d => el('option', { value: d.id, ...(existing?.pembimbing1 === d.id ? { selected: 'selected' } : {}) }, d.nama)));
  const p2 = el('select', {}, el('option', { value: '' }, '—'), ...dosenOpts().map(d => el('option', { value: d.id, ...(existing?.pembimbing2 === d.id ? { selected: 'selected' } : {}) }, d.nama)));

  const mhsExtra = el('div', {},
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Tahun Masuk'), tahunMasuk),
      el('div', { class: 'field' }, el('label', {}, 'Promotor'), p1)),
    el('div', { class: 'field' }, el('label', {}, 'Co-Promotor'), p2));
  if (!isEdit) mhsExtra.append(el('div', { class: 'field' }, el('label', {}, 'Judul Disertasi'), judul));

  const userLabel = el('label', {}, 'Username / NIM / NIP');
  function toggleExtra() {
    mhsExtra.style.display = role.value === 'mahasiswa' ? 'block' : 'none';
    userLabel.textContent = role.value === 'mahasiswa' ? 'Username / NIM' : (role.value === 'dosen' ? 'Username / NUPTK' : 'Username / NIP');
  }
  role.addEventListener('change', toggleExtra);

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Nama Lengkap'), nama),
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, userLabel, username),
      el('div', { class: 'field' }, el('label', {}, 'Peran'), role)),
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Program Studi'), prodi),
      el('div', { class: 'field' }, el('label', {}, 'No. WhatsApp'), wa)),
    mhsExtra,
    isEdit ? null : el('div', { class: 'field' }, el('label', {}, 'Kata Sandi Awal'), pass),
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const payload = { nama: nama.value.trim(), role: role.value, prodi: prodi.value.trim(), wa: wa.value.trim(),
        tahunMasuk: tahunMasuk.value.trim(), pembimbing1: p1.value, pembimbing2: p2.value };
      try {
        if (isEdit) { await api('/users/' + existing.id, { method: 'PUT', body: payload }); }
        else {
          payload.username = username.value.trim();
          payload.password = pass.value.trim();
          payload.judul = judul.value.trim();
          if (!payload.username) return toast('Username wajib diisi', 'err');
          await api('/users', { method: 'POST', body: payload });
        }
        toast('Tersimpan', 'ok'); closeModal(); navigate('users');
      } catch (ex) { toast(ex.message, 'err'); }
    } }, isEdit ? 'Simpan Perubahan' : 'Tambah Pengguna'));
  openModal(isEdit ? 'Edit Pengguna' : 'Tambah Pengguna', body);
  toggleExtra();
}

async function resetPass(u) {
  const def = (u.role === 'dosen' || u.role === 'mahasiswa') ? u.username : 'disertasi123';
  const pw = prompt('Kata sandi baru untuk ' + u.nama + ' (default: ' + def + '):', def);
  if (!pw) return;
  try { await api('/users/' + u.id + '/reset-password', { method: 'POST', body: { password: pw } }); toast('Kata sandi direset', 'ok'); }
  catch (ex) { toast(ex.message, 'err'); }
}

async function delUser(id) {
  if (!confirm('Hapus pengguna ini beserta seluruh datanya?')) return;
  try { await api('/users/' + id, { method: 'DELETE' }); toast('Dihapus', 'ok'); navigate('users'); }
  catch (ex) { toast(ex.message, 'err'); }
}

// ---------------- MASTER PROGRAM STUDI (admin) ----------------
VIEWS.prodi = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('Master Program Studi', el('button', { class: 'btn btn-primary', onclick: () => prodiForm() }, '+ Tambah Prodi')));
  const { prodi } = await api('/prodi');
  const box = el('div', { class: 'card' });
  if (!prodi.length) { box.append(el('div', { class: 'empty' }, 'Belum ada program studi. Klik "+ Tambah Prodi".')); c.append(box); return; }
  const wrap = el('div', { class: 'table-wrap' });
  const t = el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Kode Prodi'), el('th', {}, 'Nama Prodi'), el('th', {}, 'Ketua Prodi'), el('th', {}, 'Aksi'))));
  const tb = el('tbody', {});
  prodi.forEach(p => tb.append(el('tr', {},
    el('td', {}, el('b', {}, esc(p.kode))),
    el('td', {}, esc(p.nama)),
    el('td', {}, esc(p.ketua || '-')),
    el('td', {}, el('div', { class: 'row' },
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => prodiForm(p) }, 'Edit'),
      el('button', { class: 'btn btn-sm btn-danger', onclick: () => delProdi(p.id) }, 'Hapus'))))));
  t.append(tb); wrap.append(t); box.append(wrap); c.append(box);
};

function prodiForm(existing) {
  const isEdit = !!existing;
  const kode = el('input', { type: 'text', value: existing?.kode || '', placeholder: 'mis. 86201' });
  const nama = el('input', { type: 'text', value: existing?.nama || '', placeholder: 'mis. S-3 Pendidikan' });
  const ketua = el('input', { type: 'text', value: existing?.ketua || '', placeholder: 'Nama Ketua Prodi', list: 'kaprodiOptions' });
  const dl = el('datalist', { id: 'kaprodiOptions' }, USERS_CACHE.filter(u => u.role === 'kaprodi' || u.role === 'dosen').map(u => el('option', { value: u.nama })));
  const body = el('div', {},
    el('div', { class: 'two-col' },
      el('div', { class: 'field' }, el('label', {}, 'Kode Prodi'), kode),
      el('div', { class: 'field' }, el('label', {}, 'Nama Prodi'), nama)),
    el('div', { class: 'field' }, el('label', {}, 'Ketua Prodi'), ketua), dl,
    el('button', { class: 'btn btn-primary btn-block', onclick: async () => {
      const payload = { kode: kode.value.trim(), nama: nama.value.trim(), ketua: ketua.value.trim() };
      if (!payload.kode || !payload.nama) return toast('Kode & Nama Prodi wajib diisi', 'err');
      try {
        if (isEdit) await api('/prodi/' + existing.id, { method: 'PUT', body: payload });
        else await api('/prodi', { method: 'POST', body: payload });
        toast('Tersimpan', 'ok'); closeModal(); navigate('prodi');
      } catch (ex) { toast(ex.message, 'err'); }
    } }, isEdit ? 'Simpan Perubahan' : 'Tambah Prodi'));
  openModal(isEdit ? 'Edit Program Studi' : 'Tambah Program Studi', body);
}

async function delProdi(id) {
  if (!confirm('Hapus program studi ini?')) return;
  try { await api('/prodi/' + id, { method: 'DELETE' }); toast('Dihapus', 'ok'); navigate('prodi'); }
  catch (ex) { toast(ex.message, 'err'); }
}

// ---------------- AKUN SAYA ----------------
// Avatar: gambar bila ada foto, jika tidak inisial nama.
function initials(name) {
  return (String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
}
function avatarEl(user, px) {
  px = px || 40;
  const base = `width:${px}px;height:${px}px;border-radius:50%;flex:0 0 auto`;
  if (user && user.foto) return el('img', { class: 'avatar-img', alt: '', src: user.foto, style: base });
  return el('span', { class: 'avatar-ini', style: base + `;display:grid;place-items:center;font-size:${Math.round(px * 0.4)}px` }, initials(user && user.nama));
}
function refreshTopbarAvatar() {
  const av = $('#userAvatar'); if (!av) return;
  av.innerHTML = ''; av.append(avatarEl(ME, 30));
}
// Perkecil gambar di sisi klien sebelum diunggah (hemat ukuran).
function downscaleImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      const scale = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality || 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal memuat gambar')); };
    img.src = url;
  });
}

VIEWS.akun = async (c) => {
  c.innerHTML = '';
  c.append(pageHead('Akun Saya'));

  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    if (!/^image\//.test(f.type)) return toast('Pilih berkas gambar', 'err');
    try {
      const dataUrl = await downscaleImage(f, 256, 0.85);
      const res = await api('/me/foto', { method: 'POST', body: { foto: dataUrl } });
      ME = res.user; refreshTopbarAvatar(); toast('Foto diperbarui', 'ok'); navigate('akun');
    } catch (ex) { toast(ex.message, 'err'); }
  });
  c.append(el('div', { class: 'card', style: 'display:flex;align-items:center;gap:16px' },
    avatarEl(ME, 92),
    el('div', {},
      el('div', { style: 'font-weight:700;font-size:16px' }, esc(ME.nama)),
      el('div', { class: 'muted small', style: 'margin-bottom:8px' }, roleLabel(ME.role)),
      el('div', { class: 'row', style: 'gap:8px' },
        el('button', { class: 'btn btn-primary btn-sm', onclick: () => fileInput.click() }, '📷 Unggah Foto'),
        ME.foto ? el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
          try { const res = await api('/me/foto', { method: 'POST', body: { foto: '' } }); ME = res.user; refreshTopbarAvatar(); toast('Foto dihapus', 'ok'); navigate('akun'); }
          catch (ex) { toast(ex.message, 'err'); }
        } }, '🗑️ Hapus') : null),
      fileInput)));

  c.append(el('div', { class: 'card mt' },
    el('div', { class: 'field' }, el('label', {}, 'Nama'), el('div', {}, esc(ME.nama))),
    el('div', { class: 'field' }, el('label', {}, 'Username'), el('div', {}, esc(ME.username))),
    el('div', { class: 'field' }, el('label', {}, 'Peran'), el('div', {}, roleLabel(ME.role))),
    ME.role === 'mahasiswa' && ME.tahunMasuk ? el('div', { class: 'field' }, el('label', {}, 'Tahun Masuk'), el('div', {}, esc(ME.tahunMasuk))) : null,
    ME.prodi ? el('div', { class: 'field' }, el('label', {}, 'Program Studi'), el('div', {}, esc(ME.prodi))) : null,
    ME.wa ? el('div', { class: 'field' }, el('label', {}, 'WhatsApp'), el('div', {}, esc(ME.wa))) : null));

  const oldp = el('input', { type: 'password' });
  const newp = el('input', { type: 'password' });
  c.append(el('div', { class: 'card mt' }, el('h3', {}, '🔒 Ganti Kata Sandi'),
    el('div', { class: 'field' }, el('label', {}, 'Kata Sandi Lama'), oldp),
    el('div', { class: 'field' }, el('label', {}, 'Kata Sandi Baru (min. 5)'), newp),
    el('button', { class: 'btn btn-primary', onclick: async () => {
      try { await api('/me/password', { method: 'POST', body: { old: oldp.value, baru: newp.value } });
        toast('Kata sandi diperbarui', 'ok'); oldp.value = ''; newp.value = ''; } catch (ex) { toast(ex.message, 'err'); }
    } }, 'Ganti Kata Sandi')));
};

// ==================================================================
// Boot
// ==================================================================
(async function boot() {
  if (TOKEN) {
    try { const d = await api('/me'); ME = d.user; await startApp(); return; }
    catch (e) { TOKEN = ''; localStorage.removeItem('bs_token'); }
  }
  $('#loginView').hidden = false;
})();
