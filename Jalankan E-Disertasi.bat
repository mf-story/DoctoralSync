@echo off
title DoctoralSync - Sistem Bimbingan Disertasi
cd /d "%~dp0"
echo ==================================================
echo    DOCTORALSYNC - Sistem Bimbingan Disertasi
echo --------------------------------------------------
echo    Alamat : http://localhost:5520
echo    Admin  : admin / admin123
echo.
echo    Biarkan jendela ini TETAP TERBUKA selama dipakai.
echo    Untuk berhenti: tutup jendela atau tekan Ctrl+C.
echo ==================================================
echo.

REM --- Pastikan Node.js terpasang ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan.
  echo Silakan pasang dulu dari https://nodejs.org lalu jalankan lagi.
  echo.
  pause
  exit /b 1
)

REM --- Buka browser otomatis setelah server sempat siap (2 detik) ---
start "" /min cmd /c "timeout /t 2 >nul & start "" http://localhost:5520"

REM --- Alamat WA gateway (agar notifikasi WhatsApp aktif bila gateway berjalan) ---
set WA_API_URL=http://127.0.0.1:3011/send

REM --- Jalankan server ---
node server.js

echo.
echo Server berhenti.
pause
