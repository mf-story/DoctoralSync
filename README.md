# Aplikasi Bimbingan Skripsi

Aplikasi web untuk mengelola bimbingan skripsi mahasiswa dengan 4 peran pengguna. Dibangun dengan HTML/CSS/JS vanilla dan backend Node.js (hanya modul bawaan, tanpa dependensi npm).

## Peran Pengguna

| Peran | Hak akses |
|-------|-----------|
| **Mahasiswa** | Melihat progres skripsi, mengajukan bimbingan, mengunggah dokumen/draft, membuat target/deadline, mengedit judul. |
| **Dosen** | Melihat mahasiswa bimbingan, memberi catatan bimbingan, memperbarui tahapan skripsi, meninjau dokumen. |
| **Admin Prodi** | Mengelola seluruh pengguna, menetapkan pembimbing, reset kata sandi, melihat semua data. |
| **Ketua Prodi** | Monitoring progres seluruh mahasiswa (read-only) dengan statistik. |

## Fitur

- 📊 Dashboard sesuai peran
- 📖 Progres tahapan skripsi (checklist)
- 💬 Jadwal & log bimbingan (riwayat pertemuan + catatan dosen)
- 📎 Upload & revisi dokumen/draft (PDF/DOC/gambar, maks 12 MB)
- 🗓️ Timeline & pengingat deadline
- 📱 Notifikasi WhatsApp (via wa.me, satu klik)
- 📈 Monitoring & statistik untuk Ketua Prodi/Admin

## Menjalankan

Prasyarat: **Node.js** terpasang.

1. Klik dua kali **`Jalankan Server.bat`** (atau jalankan `node server.js`).
2. Buka browser: **http://localhost:5520**
3. Login admin default: **`admin`** / **`admin123`** — segera ganti kata sandi di menu **Akun Saya**.

### Akses dari HP / perangkat lain
1. Jalankan **`Buka Akses HP.bat`** (klik "Yes" pada UAC) untuk membuka port firewall.
2. Cari IP komputer: `ipconfig` → cari IPv4 Address.
3. Di HP (jaringan Wi-Fi sama), buka: `http://IP-KOMPUTER:5520`

## Alur Penggunaan

1. **Admin** login → menu **Kelola Pengguna** → tambah Dosen dulu, lalu tambah Mahasiswa sambil menetapkan **Pembimbing 1 & 2**.
2. **Mahasiswa** login → isi judul skripsi, **ajukan bimbingan**, unggah dokumen, buat deadline.
3. **Dosen** login → lihat pengajuan, **beri catatan**, centang **tahapan** yang selesai.
4. **Ketua Prodi** login → menu **Monitoring** untuk melihat progres semua mahasiswa.

## Struktur Data

Semua data tersimpan lokal di:
- `data/db.json` — pengguna, skripsi, bimbingan, dokumen (metadata), timeline.
- `uploads/` — berkas dokumen yang diunggah.

> **Backup:** cukup salin folder `data/` dan `uploads/`.

## Catatan Keamanan

- Kata sandi di-hash (scrypt) — tidak disimpan dalam bentuk teks.
- Token sesi berlaku 12 jam (di memori server).
- Ganti kata sandi admin default sebelum digunakan sungguhan.
- Untuk penggunaan produksi/publik, jalankan di belakang HTTPS (mis. reverse proxy).

## Tahapan Skripsi Default

1. Pengajuan Judul
2. Penyusunan Proposal (Bab 1-3)
3. Seminar Proposal
4. Penelitian / Pengambilan Data
5. Penyusunan Hasil (Bab 4-5)
6. Seminar Hasil
7. Ujian Sidang Skripsi
8. Revisi Akhir & Pengumpulan
