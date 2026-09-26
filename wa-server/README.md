# E-Disertasi · WA Gateway

Gateway kecil berbasis **whatsapp-web.js** agar E-Disertasi bisa mengirim
notifikasi WhatsApp ke nomor **tiap pengguna** (mahasiswa/dosen) saat ada
kejadian: pengajuan bimbingan, disetujui, minta revisi, ACC, jadwal ujian,
catatan dokumen, dan usulan/persetujuan judul.

Model: **satu nomor pengirim (gateway)** → mengirim ke banyak penerima.

## Cara pakai (Windows)

1. Klik dua kali **`Jalankan WA Gateway.bat`** (di folder induk).
   - Pertama kali akan menjalankan `npm install` (butuh internet, agak lama).
2. Buka **http://localhost:3011/qr** di browser, lalu **scan** dengan WhatsApp
   di HP: *WhatsApp › Perangkat Tertaut › Tautkan Perangkat*.
3. Setelah muncul "Terhubung sebagai <nomor>", biarkan jendela tetap terbuka.
4. Jalankan aplikasi utama lewat **`Jalankan E-Disertasi.bat`**
   (sudah menyetel `WA_API_URL=http://127.0.0.1:3011/send`).

Selesai — notifikasi WA akan terkirim otomatis ke nomor (`No. WhatsApp`) yang
tersimpan di profil masing-masing pengguna.

## Env (opsional)
- `WA_PORT`     — port gateway (default **3011**).
- `WA_API_KEY`  — bila diisi, `/send` wajib header `Authorization: Bearer <key>`.
  Bila dipakai, set juga `WA_API_KEY` yang sama saat menjalankan server utama.

## Catatan penting
- Ini memakai WhatsApp Web **tidak resmi**. Gunakan **nomor khusus** (bukan
  pribadi), kirim **seperlunya** agar nomor tidak diblokir.
- Sesi login tersimpan di folder `.wwebjs_auth/` (tidak perlu scan ulang tiap
  kali, kecuali sesi kadaluarsa).
- Jika ingin lebih aman & tahan lama untuk produksi, pertimbangkan
  **WhatsApp Cloud API resmi** (Meta) atau penyedia seperti Fonnte/Wablas.

## Endpoint
- `GET /qr`     — halaman QR untuk menautkan WhatsApp.
- `GET /status` — `{ ready, me, hasQr }`.
- `POST /send`  — `{ number, message }` (dipanggil server utama).
