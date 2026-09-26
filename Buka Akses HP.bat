@echo off
:: Membuka akses aplikasi dari HP/perangkat lain di jaringan yang sama.
:: Menambahkan aturan firewall untuk port 5520 (perlu klik "Yes" pada UAC).
title Buka Akses HP - Bimbingan Skripsi
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Meminta hak Administrator...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
echo Menambahkan aturan firewall untuk port 5520...
netsh advfirewall firewall delete rule name="Bimbingan Skripsi 5520" >nul 2>&1
netsh advfirewall firewall add rule name="Bimbingan Skripsi 5520" dir=in action=allow protocol=TCP localport=5520
echo.
echo Selesai. Cari IP komputer ini dengan perintah: ipconfig
echo Lalu buka di HP: http://IP-KOMPUTER:5520
echo.
pause
