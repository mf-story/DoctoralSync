// Lapisan penyimpanan PostgreSQL untuk DoctoralSync.
// Menyimpan tiap koleksi (users, skripsi, dst.) sebagai baris JSONB pada satu
// tabel `app_data`, sehingga struktur data in-memory tetap identik dengan mode
// file. Aktif hanya bila env DATABASE_URL diisi (mis. di Coolify).
'use strict';

const { Pool } = require('pg');

// Koleksi array yang dikelola (selaras dengan struktur DB in-memory di server.js)
const COLLECTIONS = ['users', 'skripsi', 'bimbingan', 'documents', 'timeline', 'prodi'];
const META_KEY = '__meta';

let pool = null;

function sslOption() {
  const v = String(process.env.PGSSL || '').toLowerCase();
  if (v === 'true' || v === 'require' || v === '1') return { rejectUnauthorized: false };
  return false;
}

async function init() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslOption(),
    max: parseInt(process.env.PG_POOL_MAX, 10) || 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', e => console.error('[pg pool error]', e.message));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      collection text NOT NULL,
      id text NOT NULL,
      doc jsonb NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
  return pool;
}

// Muat seluruh data menjadi objek DB (bentuk sama seperti mode file).
// Mengembalikan { db, empty } — empty=true bila belum ada data sama sekali.
async function loadAll() {
  const db = {};
  COLLECTIONS.forEach(c => { db[c] = []; });
  db.meta = null;
  const { rows } = await pool.query('SELECT collection, id, doc FROM app_data');
  for (const r of rows) {
    if (r.collection === META_KEY) { db.meta = r.doc; continue; }
    if (!db[r.collection]) db[r.collection] = [];
    db[r.collection].push(r.doc);
  }
  return { db, empty: rows.length === 0 };
}

// ---- Antrian tulis serial (aman untuk satu instance) ----
let writing = false;
let pendingSnapshot = null;

async function flush() {
  if (writing) return;
  writing = true;
  try {
    while (pendingSnapshot) {
      const snap = pendingSnapshot;
      pendingSnapshot = null;
      await writeSnapshot(snap);
    }
  } catch (e) {
    console.error('[pg persist error]', e.message);
  } finally {
    writing = false;
  }
}

async function writeSnapshot(DB) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM app_data');
    const rows = [];
    for (const c of COLLECTIONS) {
      const arr = DB[c] || [];
      for (let i = 0; i < arr.length; i++) {
        const doc = arr[i];
        if (!doc) continue;
        // Kunci baris: id, jika tidak ada pakai mahasiswaId (mis. koleksi skripsi), fallback indeks
        const key = doc.id != null ? String(doc.id)
          : (doc.mahasiswaId != null ? String(doc.mahasiswaId) : ('row_' + i));
        rows.push([c, key, doc]);
      }
    }
    if (DB.meta) rows.push([META_KEY, 'meta', DB.meta]);
    // Sisipkan bertahap (chunk) agar jumlah parameter tetap wajar
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const vals = [];
      const params = [];
      slice.forEach((r, k) => {
        const b = k * 3;
        vals.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
        params.push(r[0], r[1], JSON.stringify(r[2]));
      });
      await client.query(
        `INSERT INTO app_data (collection, id, doc) VALUES ${vals.join(',')}`,
        params
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// Simpan snapshot DB saat ini (deep copy) dan jadwalkan penulisan.
function persist(DB) {
  pendingSnapshot = JSON.parse(JSON.stringify(DB));
  return flush();
}

async function close() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { init, loadAll, persist, close, COLLECTIONS };
