@echo off
title DoctoralSync - Buat Sertifikat HTTPS
cd /d "%~dp0"
echo ==================================================
echo   Membuat sertifikat TLS (HTTPS) untuk DoctoralSync
echo --------------------------------------------------
where openssl >nul 2>nul
if %errorlevel%==0 (
  if not exist certs mkdir certs
  openssl req -x509 -newkey rsa:2048 -nodes -keyout certs\key.pem -out certs\cert.pem -days 825 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  echo Sertifikat PEM dibuat di folder certs\.
) else (
  echo OpenSSL tidak ditemukan - memakai PowerShell (self-signed PFX)...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0buat-sertifikat.ps1"
)
echo.
echo Selesai. Restart server lalu buka https://localhost:5443
pause
