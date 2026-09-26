@echo off
title DoctoralSync - WA Gateway (WhatsApp)
cd /d "%~dp0wa-server"
echo ==================================================
echo    DOCTORALSYNC - WA GATEWAY (WhatsApp)
echo --------------------------------------------------
echo    1) Pertama kali: proses akan memasang dependensi
echo       (butuh internet, agak lama).
echo    2) Setelah aktif, buka:  http://localhost:3011/qr
echo       lalu SCAN dengan WhatsApp di HP
echo       (WhatsApp ^> Perangkat Tertaut).
echo    3) Biarkan jendela ini tetap terbuka.
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js tidak ditemukan. Pasang dari https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Memasang dependensi WhatsApp gateway ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Gagal memasang dependensi. Periksa koneksi internet / npm.
    pause
    exit /b 1
  )
)

echo [INFO] Menjalankan WA gateway di http://localhost:3011
node server.js
echo.
echo WA gateway berhenti.
pause
