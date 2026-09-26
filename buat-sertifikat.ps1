# Membuat sertifikat TLS self-signed (PFX) untuk HTTPS lokal DoctoralSync.
# Tidak perlu OpenSSL maupun hak admin (memakai penyimpanan CurrentUser).
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'certs'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host 'Membuat sertifikat self-signed untuk localhost...'
$cert = New-SelfSignedCertificate `
  -DnsName 'localhost', '127.0.0.1' `
  -FriendlyName 'DoctoralSync Dev' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(2) `
  -KeyExportPolicy Exportable

# Sandi acak untuk PFX, disimpan lokal agar server bisa memuatnya
$pass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$sec = ConvertTo-SecureString -String $pass -Force -AsPlainText
$pfx = Join-Path $dir 'cert.pfx'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $sec | Out-Null
Set-Content -Path (Join-Path $dir 'pfx-pass.txt') -Value $pass -Encoding ascii -NoNewline

# Bersihkan sertifikat dari penyimpanan pribadi (file PFX sudah cukup)
Remove-Item ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force

Write-Host ''
Write-Host ("Selesai. Sertifikat: " + $pfx)
Write-Host 'Restart server, lalu buka: https://localhost:5443'
Write-Host 'Catatan: browser akan memperingatkan "sertifikat tidak tepercaya" (wajar untuk self-signed) - lanjutkan saja untuk uji lokal.'
