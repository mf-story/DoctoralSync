@echo off
title Aplikasi Bimbingan Skripsi
cd /d "%~dp0"
echo ============================================
echo   Menjalankan Aplikasi Bimbingan Skripsi
echo   Buka browser: http://localhost:5520
echo   Login admin default: admin / admin123
echo   Tekan Ctrl+C untuk berhenti.
echo ============================================
node server.js
pause
