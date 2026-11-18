# JD Sign staging

Push ke `main` menjalankan GitHub Actions: tes Go dengan PostgreSQL sungguhan,
lint dan build Next.js, lalu deploy kedua image ke VPS. Pull request menjalankan
pemeriksaan tanpa akses kunci deploy. Build berlangsung di GitHub, sehingga VPS
hanya menjalankan aplikasi. URL: https://staging.jd-sign.com.

## Pemasangan awal

1. A record `staging.jd-sign.com` diarahkan ke VPS.
2. Buat kunci Ed25519 khusus CI tanpa passphrase; jangan memakai kunci pribadi pengguna.
3. Salin repo dan public key ke VPS. Jalankan
   `sudo bash deploy/bootstrap-staging.sh /path/to/ci-key.pub`.
4. Environment GitHub `staging` dibatasi ke branch `main`. Isi secrets
   `STAGING_SSH_KEY` dan `STAGING_KNOWN_HOSTS`, serta variable `STAGING_HOST`.
   Host key harus diverifikasi terhadap koneksi SSH yang sudah dipercaya.
5. Push ke `main` atau jalankan workflow `Staging` secara manual.

## Operasi

- File server: `/opt/jdsign/staging/`; konfigurasi rahasia `.env` hanya root.
- PostgreSQL terpisah, volume persisten, tanpa port publik. Web/API hanya bind
  loopback `13300`/`18300`; Caddy menyediakan HTTPS dan routing `/api/*`.
- Batas RAM: PostgreSQL 512 MiB, API 256 MiB, web 512 MiB.
- User CI `jdsign` tidak masuk grup Docker. Kuncinya hanya dapat menjalankan
  penerima deploy; helper root memvalidasi SHA serta dua tag image yang diunggah.
- Deploy diserialkan dengan `flock`. Backup database dibuat sebelum migrasi pada
  pembaruan; backup tersimpan di `backups/` dan perlu retensi/offsite sesuai kebutuhan.
- Versi sukses tersimpan di `current-release` dan `releases.log`. Image rilis lama
  dipertahankan. Tidak ada perintah prune global atau penghapusan volume.
- Kegagalan health check memulihkan image aplikasi sebelumnya. Migrasi database
  tidak otomatis dibatalkan: gunakan perubahan skema yang kompatibel dengan rilis
  sebelumnya. Restore backup merupakan tindakan manual.
- Log: `sudo docker compose --env-file /opt/jdsign/staging/.env -f
  /opt/jdsign/staging/compose.yml logs --tail=100`, dengan `RELEASE_SHA` disetel
  sesuai isi `current-release`.
- Perubahan helper deploy atau Caddy memerlukan pemasangan ulang bootstrap oleh
  administrator; kode aplikasi biasa cukup push ke GitHub.
- Perubahan `compose.staging.yml` dipasang dengan
  `sudo bash deploy/apply-staging-config.sh` **sebelum** push ke `main`. Skrip
  ini aman diulang: memvalidasi Compose, menyalinnya ke `compose.yml`, dan
  membuat `POSTGRES_PASSWORD` atau `LOGIN_CODE_SECRET` yang belum ada di `.env`.

## Login

- `LOGIN_CODE_SECRET` dibuat otomatis oleh `apply-staging-config.sh`. Jangan
  diganti saat ada kode yang masih aktif; kode lama akan tidak cocok.
- Selama `RESEND_API_KEY` kosong, kode masuk hanya ditulis ke log API:
  `sudo docker logs jdsign-staging-api-1 2>&1 | grep 'kode masuk' | tail -n 3`.
- Untuk mengirim email sungguhan, tambahkan `RESEND_API_KEY=...` (dan bila perlu
  `MAIL_FROM=...`) ke `/opt/jdsign/staging/.env`, lalu jalankan ulang workflow `Staging`.
- Login Google aktif setelah `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET`
  ditambahkan ke `.env` dan workflow `Staging` dijalankan ulang. Redirect URI:
  `https://staging.jd-sign.com/api/v1/auth/google/callback`.

Staging dapat dilihat publik dan diberi header `noindex`. Ini masih kerangka
aplikasi; fitur marketplace akan mengikuti tahap pengembangan berikutnya.
