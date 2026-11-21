# Spesifikasi JD Sign v1 — Go + PostgreSQL + Next.js

Status: **draf untuk ditinjau** (16 November 2026).

Sumber:

- Aturan bisnis: `jd-sign-laravel` commit `84d55be` (service, policy, form request, dan 64 tes feature).
- Login Google: `jdsign-marketplace` (backend Express), dengan perbaikan keamanan.
- Skema database: [`apps/api/internal/database/migrations/00001_init.sql`](../apps/api/internal/database/migrations/00001_init.sql).
- Repo: `https://github.com/jefthah/jdsign`.

## 1. Cakupan

JD Sign adalah marketplace multivendor untuk template website berupa ZIP, untuk pasar Indonesia (IDR, Midtrans Snap).

**Termasuk v1**

- Masuk dengan kode OTP email dan akun Google. Tidak ada kata sandi.
- Katalog publik: pencarian, filter kategori, urutan, halaman template, dan halaman toko.
- Keranjang, favorit, checkout Midtrans Snap, riwayat pesanan, dan unduhan ZIP privat.
- Pengajuan toko, profil toko dengan rekening terenkripsi, upload template (ZIP + sampul), dan dashboard penjual.
- Moderasi toko dan template oleh admin, beserta log audit.
- Komisi platform, buku besar saldo penjual, pengajuan pencairan, dan konfirmasi transfer manual oleh admin.
- Panel admin: pengguna, kategori, toko, template, pesanan, pencairan, dan log audit.

**Tidak termasuk v1**

- Tiket bantuan, notifikasi di situs, testimoni, dan analitik (fitur versi lama yang tidak dipilih).
- Mengganti alamat email akun. Nama tetap bisa diganti.
- Pencairan otomatis lewat API bank, pajak, dan biaya Midtrans per transaksi.
- Live preview template yang di-hosting sendiri. `preview_url` tetap berupa link eksternal dari penjual.
- Refund yang dimulai dari panel admin. Refund dilakukan di dashboard Midtrans, lalu disinkronkan lewat webhook.

**Keputusan pengguna (16 November 2026):** database mulai kosong tanpa migrasi data lama, frontend Next.js dibuat baru dengan TypeScript dan desain versi Laravel, satu-satunya fitur versi lama yang ikut adalah login Google, dan kode disimpan di repo baru.

## 2. Arsitektur

```
Browser ──► Caddy ──┬─ /api/*  ──► Go API   (127.0.0.1)
                    └─ /*      ──► Next.js  (127.0.0.1) ──GET──► Go API (internal)
Go API ──► PostgreSQL JD Sign · Midtrans · Resend · Google · disk file privat
```

- Satu domain untuk frontend dan API, jadi cookie sesi bersifat first-party dan tidak perlu CORS.
- **Semua perubahan data** (POST/PUT/PATCH/DELETE) dikirim browser langsung ke `/api/v1/...`. Server Next.js hanya melakukan GET ke API internal untuk merender halaman dan meneruskan cookie sesi.
- Kontrak API ditulis di `api/openapi.yaml`. Server Go dibuat dengan `oapi-codegen`, tipe TypeScript dengan `openapi-typescript`.
- Go: `net/http`, `pgx` + `sqlc`, migrasi `goose` yang ditanam di binary, antrean dan jadwal `River` (tabel River dibuat oleh migrator River, bukan oleh file migrasi ini).
- Tes integrasi Go memakai PostgreSQL sungguhan dari `TEST_DATABASE_URL` (lokal: `compose.dev.yml`, CI: service container). Setiap paket tes membuat database sementara sendiri lalu menghapusnya.
- Waktu disimpan sebagai `timestamptz` (UTC) dan ditampilkan dalam Asia/Jakarta. Nominal uang selalu rupiah utuh (`bigint`) dan ditampilkan sebagai `Rp 1.250.000`.

## 3. Peran dan akses

| Peran | Didapat dari | Boleh |
|---|---|---|
| `buyer` | Akun baru (OTP atau Google) | Keranjang, favorit, checkout, pesanan, unduhan, mengajukan toko (jika diizinkan) |
| `seller` | Admin menyetujui toko | Semua hak pembeli + kelola template, dashboard, pencairan |
| `admin` | Perintah CLI `jdsign admin create --email ...` | Panel admin |

Aturan:

- Pendaftaran dan login **tidak pernah** memberi peran `seller` atau `admin`, walaupun request mengirim field `role` atau `is_active`.
- Akun `is_active = false`: semua sesinya dihapus dan setiap request login mendapat 403 "Akun Anda sedang dinonaktifkan." Akun nonaktif tidak bisa masuk lewat OTP maupun Google.
- Area penjual mensyaratkan akun aktif, `role = seller`, dan profil toko `approved`. Jika tidak terpenuhi: 403 "Toko Anda belum disetujui."
- Area admin mensyaratkan akun aktif, `role = admin`, email terverifikasi, **dan TOTP** (lihat 4.4).
- Checkout, pesanan, unduhan, dan area penjual mensyaratkan `email_verified_at` terisi.
- Pesanan, item unduhan, keranjang, dan favorit milik orang lain dijawab **404**, bukan 403.

## 4. Login

### 4.1 Kode OTP email

- Email di-trim, diubah ke huruf kecil, harus valid, maksimal 255 karakter. Pesan: "Masukkan alamat email Anda.", "Format email belum benar. Contoh: nama@email.com", "Alamat email terlalu panjang."
- Kode 6 digit dari generator acak kriptografis, dengan nol di depan dipertahankan. Disimpan sebagai HMAC-SHA256 (kunci rahasia server) di `login_codes`, satu kode aktif per email.
- Berlaku **10 menit**. Jeda kirim ulang **60 detik**: dalam masa jeda tidak ada kode baru yang dikirim, dan respons memberi tahu sisa detiknya.
- Maksimal **5 kali salah**. Setiap salah: "Kode tidak cocok. Sisa N percobaan." Pada kesalahan ke-5 kode dihapus: "Kode salah terlalu sering. Kirim kode baru untuk melanjutkan."
- Kode kedaluwarsa atau tidak ada: "Kode sudah kedaluwarsa. Kirim kode baru untuk melanjutkan."
- Input kode dibersihkan dari karakter selain angka sebelum dicek, dan harus tepat 6 digit.
- Batas laju: kirim kode **6/menit per IP** dan **8/jam per email**; verifikasi **10/menit per IP**.
- Email kode dikirim **langsung** (bukan lewat antrean), karena pengguna sedang menunggu. Subjek: `123456 adalah kode masuk JD Sign Anda`. Isinya menampilkan kode berformat `123 456` dan masa berlakunya.
- Jika pengiriman email gagal: "Kode belum bisa dikirim. Coba lagi dalam beberapa saat."
- Tanpa `RESEND_API_KEY` (lokal dan staging), kode hanya ditulis ke log API dan tidak dikirim. Production wajib mengisinya.
- Kode benar:
  - Email belum terdaftar → buat akun `buyer`, aktif, `email_verified_at = now()`. Nama diambil dari bagian sebelum `@`: tanda `._-+` menjadi spasi, angka dibuang, kapital di awal kata. Contoh `budi.santoso@mail.com` → "Budi Santoso". Jika hasilnya kosong → "Pengguna JD Sign".
  - Email sudah terdaftar tetapi belum terverifikasi → tandai terverifikasi.
  - Akun nonaktif → tolak: "Akun ini sedang dinonaktifkan. Hubungi tim JD Sign untuk bantuan."
  - Buat sesi baru, lalu kembali ke halaman yang dituju sebelumnya (default `/account`).

### 4.2 Google

- OAuth 2.0 Authorization Code dengan **PKCE**, `state`, dan `nonce`. Ketiganya disimpan di cookie HttpOnly berumur 10 menit.
- ID token diverifikasi (`iss`, `aud`, `exp`, `nonce`). Wajib `email_verified = true`. Jika tidak: tolak dan arahkan ke halaman login dengan pesan.
- Urutan pencocokan: `google_sub` → email (lalu simpan `google_sub`) → buat akun `buyer` baru seperti OTP.
- Callback memasang cookie sesi langsung, lalu redirect ke frontend. Versi lama menukar kode lewat URL karena frontend dan API beda domain; itu tidak diperlukan lagi.
- Sesi dari Google memakai masa tidak aktif 30 hari, sama seperti "ingat saya".
- Login Google nonaktif sampai `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` diisi; tombolnya lalu kembali ke `/login?error=google_unavailable`.
- `state` atau `nonce` tidak cocok, login dibatalkan, atau akun nonaktif → redirect ke `/login?error=...` dengan pesan Bahasa Indonesia.

### 4.3 Sesi

- Token acak 32 byte di cookie `jdsign_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). Database hanya menyimpan hash SHA-256-nya.
- Masa tidak aktif **2 jam** (diperpanjang setiap request). Dengan "ingat saya": **30 hari**.
- Sesi diganti baru setiap login. Logout menghapus baris sesi.
- Perlindungan CSRF: request yang mengubah data harus punya header `Origin` sama dengan `APP_URL`. Pengecualian: webhook Midtrans.

### 4.4 TOTP untuk admin

Keputusan pengguna (16 November 2026): admin **wajib** memakai kode dari aplikasi authenticator, selain kode email atau Google.

- TOTP sesuai RFC 6238: 6 digit, periode 30 detik, toleransi satu periode sebelum dan sesudahnya.
- Rahasia TOTP (20 byte acak) disimpan terenkripsi di `users.totp_secret`.
- **Pemasangan:** admin yang belum memasang TOTP diarahkan ke halaman pemasangan yang menampilkan QR (`otpauth://totp/JD%20Sign:<email>?issuer=JD%20Sign`) dan rahasianya. TOTP aktif (`totp_confirmed_at` terisi) setelah admin memasukkan satu kode yang benar. Rahasia hanya ditampilkan selama belum dikonfirmasi.
- **Setiap sesi baru** harus memasukkan kode TOTP sebelum membuka area admin. Setelah berhasil, `sessions.mfa_verified_at` terisi. Area pembeli dan penjual tidak memerlukan TOTP.
- Kode yang sama tidak bisa dipakai dua kali (`users.totp_last_step` menyimpan periode terakhir yang dipakai).
- Batas laju 5 percobaan per menit per pengguna. Pesan: "Kode authenticator salah." / "Terlalu banyak percobaan. Tunggu satu menit, lalu coba lagi."
- Jika authenticator hilang: jalankan `jdsign admin reset-totp --email ...` di server. Perintah ini mengosongkan TOTP, menghapus semua sesi admin itu, dan mencatat log audit `user.totp_reset`.

## 5. Katalog publik

"Tayang" berarti: template `approved`, belum diarsipkan, penjualnya aktif, dan profil tokonya `approved`. Semua tampilan publik hanya menampilkan template tayang.

- **Beranda:** 4 template tayang terbaru, dan semua kategori beserta jumlah template **tayang** saja. Ada tampilan kosong jika belum ada template. Beranda mengajak membeli, tidak mengajak menjadi penjual.
- **Katalog:** `q` (maks. 100 karakter) dicocokkan tanpa membedakan huruf besar/kecil pada judul atau teknologi. Filter `category` memakai slug. Urutan `newest` (default, id turun), `price-low` (harga naik lalu id), `price-high` (harga turun lalu id). **9 per halaman.**
- **Halaman template:** 404 jika tidak tayang. Ditambah 3 template tayang lain dari kategori yang sama.
- **Halaman toko:** hanya toko `approved` dengan pemilik aktif. Menampilkan template tayang, **12 per halaman**.
- **Sampul:** bisa dilihat publik jika template tayang. Pemilik dan admin selalu bisa melihat. Selain itu 404. Header `X-Content-Type-Options: nosniff`.
- Deskripsi template ditampilkan sebagai teks biasa yang di-escape. Jangan pernah memakai `dangerouslySetInnerHTML`.
- Halaman login juga menampilkan 6 template tayang terbaru sebagai etalase.

## 6. Toko penjual

- Boleh mengajukan atau menyimpan profil toko jika akun aktif dan:
  - tokonya sudah `approved` (selalu boleh memperbarui), **atau**
  - `SELLER_APPLICATIONS_OPEN = true`, **atau**
  - email ada di `SELLER_APPLICATION_EMAILS` (dipisah koma, dibandingkan dalam huruf kecil).
- Saat pendaftaran ditutup, halaman profil toko menjelaskan hal itu. Halaman akun hanya menampilkan link toko kepada orang yang boleh mengajukan.
- Isian dan validasinya:

  | Field | Aturan |
  |---|---|
  | `shop_name` | wajib, maks. 100 |
  | `bio` | wajib, 20–2000 |
  | `bank_name` | wajib, maks. 80 |
  | `account_name` | wajib, maks. 100 |
  | `account_number` | wajib, `^[0-9]{6,30}$` |

- Rekening disimpan sebagai JSON terenkripsi AES-256-GCM di `bank_details`, dan tidak pernah dikirim balik dalam bentuk utuh kecuali ke admin di layar pencairan.
- Profil baru mendapat slug `slug(shop_name)-<6 karakter acak>`.
- Menyimpan profil yang belum `approved` mengembalikan status ke `pending` dan menghapus catatan admin. Menyimpan profil **tidak pernah** mengubah peran pengguna.

## 7. Template

### 7.1 Membuat dan mengubah

- Hanya penjual yang sah (lihat bagian 3), dan hanya untuk template miliknya sendiri.
- Validasi:

  | Field | Aturan |
  |---|---|
  | `category_id` | wajib, kategori yang ada |
  | `title` | wajib, maks. 160 |
  | `summary` | wajib, maks. 240 |
  | `description` | wajib, 30–20.000 |
  | `price` | wajib, bilangan bulat Rp10.000–Rp100.000.000 |
  | `version` | wajib, maks. 40 |
  | `technology` | wajib, maks. 80 |
  | `preview_url` | opsional, harus `https://`, maks. 500 |
  | `status` | hanya `draft` atau `pending` (tidak pernah `approved`) |
  | `archive` | wajib saat membuat, opsional saat mengubah; ZIP maks. 50 MB |
  | `cover` | wajib saat membuat, opsional saat mengubah; JPG/PNG/WebP (bukan SVG), maks. 2 MB, maks. 4000×4000 px |

- Template baru mendapat slug `slug(title)-<8 karakter acak>` dan `license_type = 'Standard'`.
- **Setiap penyimpanan** mengembalikan template ke `draft` atau `pending`, serta mengosongkan `approved_at`, `approved_by`, dan `admin_note`. Artinya, setiap perubahan harus dimoderasi ulang.
- Jika penyimpanan gagal di tengah jalan, file yang baru diunggah dihapus kembali.

### 7.2 Validasi ZIP

ZIP ditolak, dan tidak ada file yang disimpan, jika:

- tidak bisa dibuka;
- jumlah entri di luar 1–5.000;
- ada nama entri yang diawali `/`, diawali huruf drive (`C:`), memuat segmen `..`, atau memuat byte NUL (`\` dianggap `/`);
- ada entri terenkripsi;
- total ukuran setelah diekstrak melebihi **250 MB** (262.144.000 byte).

Aplikasi **tidak pernah mengekstrak atau menjalankan** isi ZIP.

### 7.3 Penyimpanan file

- Disk privat di VPS (`STORAGE_DIR`), di luar folder web:
  - ZIP: `templates/<seller_id>/<acak>.zip`
  - Sampul: `covers/<seller_id>/<uuid>.webp`
- Sampul selalu dikodekan ulang ke WebP kualitas 85, sehingga metadata dan muatan tersembunyi terbuang.
- File ZIP lama **tidak boleh dihapus** selama masih dirujuk oleh `order_items.archive_path`. Pembeli tetap mengunduh versi yang mereka beli walaupun penjual sudah mengganti ZIP-nya.
- Menghapus template sama dengan mengarsipkannya (`deleted_at`). Pembelian lama tidak terpengaruh.

### 7.4 Unduhan untuk pemeriksaan

Pemilik template dan admin bisa mengunduh ZIP terbaru dengan nama `review-<slug judul>.zip`. Selain itu 404.

## 8. Moderasi admin

- **Toko disetujui:** status `approved`, isi `approved_at`, peran pengguna menjadi `seller` (kecuali admin). Log audit `seller.approved`.
- **Toko ditolak atau dihentikan:** catatan wajib (maks. 2000), status `rejected`, peran kembali `buyer` (kecuali admin). Log audit `seller.rejected`.
- **Template disetujui** hanya jika penjualnya aktif, tokonya `approved`, serta file ZIP dan sampulnya ada. Jika tidak: "Seller harus aktif dan disetujui, serta sampul dan ZIP harus tersedia." Isi `approved_at` dan `approved_by`. Log audit `template.approved`.
- **Template ditolak:** catatan wajib, status `rejected`. Log audit `template.rejected`.
- Setiap tindakan moderasi mengunci baris yang terlibat dalam satu transaksi database.

## 9. Keranjang dan favorit

- Hanya template tayang yang bisa dimasukkan (selain itu 404). Pembeli tidak bisa memasukkan template miliknya sendiri: "Anda tidak dapat membeli template sendiri."
- Keranjang maksimal **20** item: "Keranjang mencapai batas 20 produk." Batas ini dicek sambil mengunci baris pengguna.
- Template yang sama tidak bisa dimasukkan dua kali (kombinasi pengguna dan template unik).
- Halaman keranjang mengirim `checkout_key` (UUID baru) setiap kali dimuat.
- Daftar favorit hanya menampilkan template yang masih tayang, **12 per halaman**.

## 10. Checkout

Dalam satu transaksi database, dengan percobaan ulang hingga 3 kali jika terjadi konflik:

1. Cek pembayaran sedang aktif (lihat 11.1). Jika tidak: "Pembayaran sedang tidak tersedia. Silakan coba lagi nanti."
2. Kunci baris pembeli. Jika sudah ada pesanan dengan `checkout_key` yang sama, kembalikan pesanan itu. Ini membuat checkout idempoten.
3. Keranjang tidak boleh kosong dan maksimal 20 item.
4. Kunci baris template. Setiap template harus tayang, bukan milik pembeli, punya file ZIP, bukan template demo saat `APP_ENV=production`, dan belum pernah dibeli pembeli ini dalam pesanan `paid`.
5. Buat pesanan:
   - nomor `JD-<ULID huruf besar>`
   - `total` = jumlah harga dari database (harga dari browser tidak pernah dipakai)
   - status `pending`
6. Untuk setiap template, buat item dengan salinan judul, versi, lisensi, harga, dan `archive_path`, ditambah `license_key` (UUID):
   - `platform_fee = floor(price × COMMISSION_BPS / 10000)`
   - `seller_net = price − platform_fee`

Setelah pesanan dibuat, langsung siapkan pembayaran (10.1). Jika penyiapan gagal, pembeli diarahkan ke halaman pesanan dengan pesan kesalahan, dan bisa mencoba lagi dari sana.

### 10.1 Menyiapkan pembayaran Snap

- Memakai kunci per pesanan (`pg_advisory_xact_lock`). Pesanan harus `pending`: jika tidak, "Pesanan ini sudah tidak menunggu pembayaran."
- Jika percobaan terakhir berstatus `ready` dan punya `redirect_url`, pakai lagi link itu.
- Jika percobaan terakhir masih `pending` dan umurnya kurang dari 2 menit: "Pembayaran sedang disiapkan. Silakan periksa kembali sebentar lagi."
- Buat percobaan baru:
  - `provider_order_id` = nomor pesanan + `-` + 8 karakter acak huruf besar
  - status `pending`
- Request ke Snap:
  - `gross_amount` = `total`
  - `item_details`: satu baris per item (`id` = template_id, `price`, `quantity` 1, nama maks. 48 karakter)
  - `customer_details`: nama maks. 50 karakter dan email
  - `callbacks.finish`: halaman pesanan
  - `expiry`: 1 jam
- Respons Snap dianggap sah hanya jika `token` tidak kosong, `redirect_url` memakai `https`, dan host-nya `app.midtrans.com` (production) atau `app.sandbox.midtrans.com` (sandbox).
- Berhasil: simpan token dan URL dalam bentuk terenkripsi, lalu status `ready`. Gagal: status `failed`, catat error, dan tampilkan "Pembayaran belum berhasil disiapkan. Anda bisa mencoba lagi dari halaman pesanan."

## 11. Pembayaran Midtrans

### 11.1 Pembayaran aktif

Pembayaran dianggap aktif jika `PAYMENTS_ENABLED = true`, `MIDTRANS_SERVER_KEY` terisi, dan (bukan `APP_ENV=production` **atau** `MIDTRANS_IS_PRODUCTION = true`). Dengan begitu production tidak pernah memakai sandbox.

### 11.2 Webhook `POST /api/v1/payments/midtrans/webhook`

1. Field `order_id`, `status_code`, `gross_amount`, dan `signature_key` harus berupa string. `signature_key` harus sama dengan `sha512(order_id + status_code + gross_amount + server_key)`, dibandingkan dalam waktu konstan.
2. Tanda tangan salah → **403**. Pesanan tidak berubah dan Midtrans **tidak dipanggil**.
3. Cari percobaan pembayaran berdasarkan `order_id` (404 jika tidak ada), lalu jalankan sinkronisasi (11.3).
4. Isi body webhook **tidak pernah** dipakai sebagai status. Status selalu diambil dari API status Midtrans.
5. Batas laju: 120/menit.

### 11.3 Sinkronisasi status

Ambil `GET /v2/<provider_order_id>/status` dari Midtrans, lalu tolak (**422**) jika:

- `order_id` tidak sama dengan `provider_order_id`;
- `gross_amount` tidak cocok dengan `^\d{1,14}(\.0{1,2})?$`, atau bagian bulatnya tidak sama dengan `orders.total`;
- `currency` bukan `IDR` (jika tidak ada, dianggap IDR);
- `transaction_id` bukan string.

Lalu, dalam satu transaksi (percobaan ulang hingga 3 kali):

1. Kunci baris pesanan dan percobaan pembayaran. Jika percobaan sudah punya `transaction_id` yang berbeda → 422.
2. Kunci baris pengguna semua penjual di pesanan itu, diurutkan berdasarkan id.
3. Simpan `transaction_id` dan `provider_status`.
4. **Dianggap lunas** jika (`settlement` dan `fraud_status` bukan `challenge`/`deny`) atau (`capture` dan `fraud_status = accept`). Jika lunas:
   - Ada percobaan lain yang sudah `paid` → percobaan ini `paid`, lalu pesanan **ditahan untuk pemeriksaan** dengan catatan "Pembayaran ganda terdeteksi; rekonsiliasi diperlukan." (kecuali pesanan sudah `refunded`).
   - Jika tidak, dan `paid_at` masih kosong serta pesanan bukan `refunded`:
     - pesanan menjadi `paid` dan `paid_at = now()`;
     - percobaan menjadi `paid`;
     - buat entri buku besar `sale:<order_item_id>` sebesar `seller_net` untuk setiap item;
     - hapus template tersebut dari keranjang pembeli;
     - antrekan email "Pembayaran diterima" di transaksi yang sama.
   - Pesanan `refunded` **tidak pernah** kembali `paid` karena status settlement yang sudah usang.
5. `refund` atau `chargeback` pada pesanan yang pernah dibayar → balik pendapatan (entri `refund:<id>` sebesar `−seller_net`, hanya untuk item yang punya entri `sale`), pesanan menjadi `refunded`, percobaan `refunded`. Idempoten.
6. `partial_refund` atau `partial_chargeback` pada pesanan yang pernah dibayar → **ditahan untuk pemeriksaan** dengan catatan "Pengembalian sebagian memerlukan rekonsiliasi per item oleh admin."
7. Pesanan belum dibayar dan bukan `refunded`:
   - `deny`, `cancel`, atau `expire` → percobaan `closed`. Jika tidak ada percobaan lain yang masih `ready`/`pending`, pesanan menjadi `expired` (untuk `expire`) atau `cancelled`.
   - `fraud_status = challenge` → pesanan menjadi `review`.
   - Status lain (misalnya `pending`) → tidak ada perubahan dan tidak ada entri buku besar.

**Ditahan untuk pemeriksaan:** jika status belum `review`, balik pendapatan seperti langkah 5, ubah status pesanan menjadi `review`, dan catat log audit `payment.review` tanpa aktor.

### 11.4 Pemulihan dan pemeriksaan manual

- **Job terjadwal setiap 5 menit:** maksimal 10 percobaan berstatus `ready`/`pending` yang dibuat antara 7 hari dan 2 menit yang lalu, mulai dari yang paling lama tidak diperbarui. Kesalahan satu percobaan tidak menghentikan yang lain.
- **Tombol "Periksa status"** di halaman pesanan (milik sendiri, 6/menit) menyinkronkan percobaan terakhir yang bukan `failed`. Jika gagal: "Status belum dapat diperiksa. Silakan coba kembali."
- **Tombol "Bayar"** (6/menit) menjalankan 10.1 untuk pesanan `pending`.

### 11.5 Status

| Pesanan | Arti |
|---|---|
| `pending` | Menunggu pembayaran |
| `paid` | Lunas (unduhan terbuka) |
| `expired` | Kedaluwarsa |
| `cancelled` | Dibatalkan |
| `refunded` | Dikembalikan |
| `review` | Perlu pemeriksaan admin (unduhan dan pendapatan ditahan) |

Percobaan pembayaran: `pending` → `ready` → `paid` / `closed` / `refunded`, atau `failed`.

## 12. Unduhan pembeli

- Hanya untuk item dari pesanan milik sendiri yang berstatus **`paid`**. Selain itu 404, termasuk untuk pesanan `review` dan `refunded`.
- File yang dikirim adalah `order_items.archive_path`, yaitu versi saat dibeli.
- Nama file `<slug judul>-<slug versi>.zip`. Header `Cache-Control: private, no-store` dan `X-Content-Type-Options: nosniff`. Batas 20/menit.

## 13. Saldo dan pencairan

- **Saldo tersedia** = jumlah semua entri buku besar − jumlah pencairan yang masih `pending`. Pencairan `pending` memesan saldo.
- **Mengajukan pencairan** (6/menit), dalam transaksi yang mengunci baris penjual:
  - harus penjual yang sah;
  - rekening di profil lengkap. Jika tidak: "Lengkapi rekening penerima pada profil toko terlebih dahulu."
  - nominal bilangan bulat ≥ `MINIMUM_PAYOUT` (Rp50.000), ≤ Rp1.000.000.000, dan ≤ saldo tersedia. Jika tidak: "Nominal pencairan tidak memenuhi minimum atau melebihi saldo tersedia."
  - rekening saat itu disalin dalam bentuk terenkripsi ke `payout_requests.bank_details`.
- **Konfirmasi transfer** (hanya admin; penjual tidak bisa mengonfirmasi pencairannya sendiri):
  - nomor referensi wajib diisi, maks. 160;
  - kunci baris penjual, lalu baris pencairan;
  - jika sudah `paid` dengan referensi yang sama, tidak ada yang berubah (idempoten);
  - harus `pending`, dan saldo tersedia penjual (yang sudah memperhitungkan pencairan ini) **≥ 0**. Jika refund terjadi setelah pengajuan dan saldo jadi minus, transfer diblokir: "Pencairan tidak lagi dapat diproses. Periksa status dan saldo penjual."
  - buat entri `payout:<id>` sebesar `−amount`, status `paid`, isi referensi dan admin, lalu catat log audit `payout.paid`.
  - Tombol ini **tidak mengirim uang**. Admin mentransfer sendiri lewat bank.
- **Tolak pencairan** (hanya admin): alasan wajib, hanya untuk yang `pending`. Saldo yang dipesan kembali tersedia. Log audit `payout.rejected`.
- Buku besar hanya boleh ditambah. Database menolak UPDATE dan DELETE.

## 14. Panel admin

| Layar | Isi dan tindakan |
|---|---|
| Ringkasan | Toko menunggu moderasi, template perlu ditinjau, total rupiah pencairan menunggu transfer, pesanan perlu rekonsiliasi (`review`) |
| Pengguna | Cari nama/email, filter peran. Aktifkan/nonaktifkan (tidak bisa untuk diri sendiri) |
| Kategori | Tambah, ubah, hapus (ditolak jika masih dipakai template). Slug huruf kecil-angka-tanda hubung, unik |
| Toko | Filter status. Lihat profil, setujui, tolak/hentikan dengan alasan |
| Template | Filter status. Periksa detail dan unduh ZIP, setujui, tolak dengan alasan |
| Pesanan | Cari nomor/email, filter status. Detail item, percobaan pembayaran, dan status Midtrans |
| Pencairan | Filter status. Lihat rekening (didekripsi), konfirmasi transfer dengan referensi, tolak dengan alasan |
| Log audit | Waktu, admin (atau "Sistem"), tindakan, jenis, ID, catatan |

## 15. Email (Resend API)

| Email | Kapan | Cara kirim |
|---|---|---|
| Kode masuk | Meminta OTP | Langsung |
| Pembayaran diterima | Pesanan menjadi `paid` | Job River, dicoba ulang 3 kali (jeda 30 detik, 2 menit, 5 menit) |

## 16. Job latar belakang (River)

| Job | Jadwal |
|---|---|
| Kirim email pembayaran diterima | Diantrekan saat pesanan lunas |
| Sinkronisasi pembayaran tertunda | Setiap 5 menit |
| Hapus kode OTP dan sesi kedaluwarsa | Setiap hari |

## 17. Konfigurasi

| Variabel | Default / contoh |
|---|---|
| `APP_ENV` | `local` / `staging` / `production` |
| `APP_URL` | `https://jd-sign.com` |
| `DATABASE_URL` | `postgres://...` |
| `ENCRYPTION_KEYS` | daftar kunci AES-256 bernomor `id:hex` dipisah koma, misalnya `2:<64 hex>,1:<64 hex>`; kunci pertama untuk enkripsi, semua kunci bisa mendekripsi. **Wajib dicadangkan** — kehilangan kunci berarti rekening, token, dan authenticator admin tidak bisa dibaca. Staging tanpa kunci: panel admin tertutup |
| `LOGIN_CODE_SECRET` | rahasia HMAC untuk kode OTP |
| `STORAGE_DIR` | folder file privat |
| `PAYMENTS_ENABLED` | `false` |
| `MIDTRANS_SERVER_KEY`, `MIDTRANS_IS_PRODUCTION` | — , `false` |
| `COMMISSION_BPS` | `1000` (10%) |
| `MINIMUM_PAYOUT` | `50000` |
| `MAX_CART_ITEMS` | `20` |
| `MAX_ARCHIVE_MB` | `50` |
| `SELLER_APPLICATIONS_OPEN` | `false` |
| `SELLER_APPLICATION_EMAILS` | kosong |
| `RESEND_API_KEY`, `MAIL_FROM` | — , `JD Sign <hello@jd-sign.com>` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — |

## 18. Format API

- Basis `/api/v1`, JSON, nama field camelCase.
- Error: `{"error": {"code": "validation_failed", "message": "...", "fields": {"price": "..."}}}`. Validasi 422, belum login 401, dilarang 403, tidak ditemukan 404, batas laju 429. Semua pesan dalam Bahasa Indonesia.
- Daftar berhalaman: `{"data": [...], "page": 1, "perPage": 9, "total": 42}`.
- Field privat tidak pernah dikirim ke klien: `archive_path`, `cover_path`, `bank_details` (kecuali admin di layar pencairan), `snap_token`, `redirect_url`, `totp_secret`.

## 19. Endpoint

### Publik

| Metode | Path | Catatan |
|---|---|---|
| GET | `/home` | 4 template terbaru + kategori dengan jumlah tayang |
| GET | `/categories` | |
| GET | `/templates` | `q`, `category`, `sort`, `page` (9 per halaman) |
| GET | `/templates/{slug}` | Detail + 3 template terkait |
| GET | `/templates/{slug}/cover` | Gambar (tayang, atau pemilik/admin) |
| GET | `/shops/{slug}` | Toko + template tayang (12 per halaman) |
| POST | `/payments/midtrans/webhook` | Tanpa sesi, tanda tangan wajib |

### Login dan akun

| Metode | Path | Catatan |
|---|---|---|
| POST | `/auth/code` | `{email}` → kirim kode, kembalikan `secondsUntilResend` |
| POST | `/auth/code/verify` | `{email, code, remember}` → pasang cookie sesi |
| GET | `/auth/google` | Redirect ke Google |
| GET | `/auth/google/callback` | Pasang cookie sesi, redirect ke frontend |
| POST | `/auth/logout` | |
| GET | `/me` | Profil, peran, status toko, `canApplyAsSeller`, 3 pesanan terakhir |
| PATCH | `/me` | `{name}` |

### Pembeli (login)

| Metode | Path | Catatan |
|---|---|---|
| GET | `/cart` | Item, total, `checkoutKey` baru |
| POST | `/cart` | `{templateSlug}` (30/menit) |
| DELETE | `/cart/{id}` | |
| GET | `/wishlist` | 12 per halaman |
| POST | `/wishlist` | `{templateSlug}` (30/menit) |
| DELETE | `/wishlist/{id}` | |
| POST | `/checkout` | `{checkoutKey}` → `{orderNumber, paymentUrl?}` (6/menit) |
| GET | `/orders` | 10 per halaman |
| GET | `/orders/{number}` | Item dan status pembayaran |
| POST | `/orders/{number}/pay` | → `{paymentUrl}` (6/menit) |
| POST | `/orders/{number}/refresh` | Sinkronkan status (6/menit) |
| GET | `/downloads/{orderItemId}` | File ZIP (20/menit) |

### Penjual

| Metode | Path | Catatan |
|---|---|---|
| GET | `/seller/profile` | Juga untuk calon penjual |
| PUT | `/seller/profile` | Ajukan atau perbarui toko (10/menit) |
| GET | `/seller/dashboard` | Jumlah penjualan, pendapatan bersih, saldo tersedia, 5 penjualan terakhir |
| GET | `/seller/templates` | 10 per halaman |
| POST | `/seller/templates` | Multipart: field + `archive` + `cover` (30/menit) |
| PUT | `/seller/templates/{slug}` | Multipart, file opsional |
| DELETE | `/seller/templates/{slug}` | Arsipkan |
| GET | `/seller/templates/{slug}/archive` | ZIP untuk pemeriksaan (20/menit) |
| GET | `/seller/payouts` | Saldo tersedia + riwayat (10 per halaman) |
| POST | `/seller/payouts` | `{amount}` (6/menit) |

### Admin

Semua endpoint admin, kecuali tiga endpoint TOTP, mensyaratkan `sessions.mfa_verified_at` terisi.

| Metode | Path |
|---|---|
| GET | `/admin/mfa/setup` → `{otpauthUri, secret}` (hanya jika TOTP belum dikonfirmasi) |
| POST | `/admin/mfa/setup` `{code}` → konfirmasi pemasangan |
| POST | `/admin/mfa/verify` `{code}` → verifikasi untuk sesi ini |
| GET | `/admin/overview` |
| GET | `/admin/users` · POST `/admin/users/{id}/toggle-active` |
| GET, POST | `/admin/categories` · PUT, DELETE `/admin/categories/{id}` |
| GET | `/admin/sellers` · `/admin/sellers/{id}` · POST `/approve` · POST `/reject` `{note}` |
| GET | `/admin/templates` · `/admin/templates/{id}` · `/admin/templates/{id}/archive` · POST `/approve` · POST `/reject` `{note}` |
| GET | `/admin/orders` · `/admin/orders/{number}` |
| GET | `/admin/payouts` · `/admin/payouts/{id}` · POST `/mark-paid` `{reference}` · POST `/reject` `{note}` |
| GET | `/admin/audit-logs` |

Batas ukuran body di Caddy dan Go: 60 MB untuk endpoint upload, 1 MB untuk endpoint lain.

## 20. Daftar uji penerimaan

Diterjemahkan dari 64 tes Laravel, ditambah tes login Google. Versi baru dianggap setara jika semua lulus.

**Login (16 + 4)**

1. Satu halaman menangani masuk dan daftar hanya dengan email.
2. Halaman masuk hanya menampilkan template tayang.
3. Link "daftar" membuka halaman yang sama.
4. Login dengan kata sandi tidak diterima.
5. Meminta kode mengirim 6 digit dan membuka langkah kode.
6. Email tidak valid ditolak dengan pesan jelas.
7. Langkah kode membutuhkan email yang sedang menunggu kode.
8. Kode benar memasukkan pembeli lama dan kembali ke halaman yang dituju.
9. Kode benar untuk email baru membuat akun pembeli terverifikasi.
10. Masuk dengan kode memverifikasi email yang belum terverifikasi.
11. Kode salah menampilkan sisa percobaan.
12. Kode tidak berlaku lagi setelah 5 kali salah.
13. Kode kedaluwarsa ditolak.
14. Kode baru hanya bisa diminta setelah jeda.
15. Akun nonaktif tidak bisa masuk.
16. Email kode menampilkan kode dan masa berlakunya.
17. Google dengan email terverifikasi membuat akun baru atau menautkan akun yang ada.
18. Google dengan email belum terverifikasi ditolak.
19. `state` atau `nonce` yang salah ditolak.
20. Akun nonaktif tidak bisa masuk lewat Google.

**Halaman (6)**

21. Halaman yang tidak ada menampilkan halaman 404.
22. Beranda bisa dibuka.
23. Beranda hanya menampilkan template tayang.
24. Jumlah per kategori hanya menghitung template tayang.
25. Beranda mengajak membeli template, bukan menjadi penjual.
26. Beranda menampilkan tampilan kosong jika belum ada template.

**Akses (21)**

27. Pendaftaran tidak bisa memberi peran penjual atau admin.
28. Pembeli tidak bisa masuk panel admin.
29. Pembeli tidak bisa masuk dashboard penjual.
30. Pembeli yang belum terverifikasi tidak bisa checkout.
31. Pengguna yang dinonaktifkan langsung dikeluarkan.
32. Penjual tidak bisa mengubah template penjual lain.
33. Hanya pemilik yang tokonya disetujui yang boleh mengubah template.
34. Katalog menyembunyikan produk dari toko yang masih menunggu atau dihentikan.
35. Deskripsi produk di-escape.
36. Pengajuan toko mengenkripsi rekening dan tidak pernah memberi peran.
37. Pengajuan toko hanya diizinkan saat dibuka atau email ada di daftar izin.
38. Saat pendaftaran ditutup, pengajuan dari email di luar daftar ditolak.
39. Email di daftar izin tetap bisa mengajukan saat pendaftaran ditutup.
40. Halaman akun hanya menampilkan link toko kepada yang boleh mengajukan.
41. Halaman profil toko menjelaskan bahwa pendaftaran sedang ditutup.
42. Persetujuan template mensyaratkan ZIP privat dan toko yang disetujui.
43. Persetujuan admin mencatat log audit dan menayangkan produk.
44. Unduhan ditolak untuk pesanan yang belum `paid`.
45. Pembeli lain tidak bisa membaca pesanan atau mengunduh file.
46. Unduhan tetap memberi versi yang dibeli setelah penjual mengganti ZIP.
47. Semua layar admin bisa dibuka oleh admin terverifikasi.

**Pembayaran (13)**

48. Checkout memakai harga dari server, menyimpan salinan, menghitung komisi, dan idempoten.
49. Checkout menolak produk yang tidak tayang sebelum pesanan dibuat.
50. Checkout nonaktif sampai pembayaran dikonfigurasi.
51. Request Snap memakai total yang tepat dan memakai ulang link pembayaran yang ada.
52. Request Snap yang gagal tidak menghasilkan pendapatan dan aman dicoba lagi.
53. Webhook palsu tidak bisa mengubah pesanan dan tidak memanggil Midtrans.
54. Webhook sah memakai status dari Midtrans dan mengkredit penjual hanya sekali.
55. Webhook bertanda tangan sah tidak bisa menimpa status `pending` dari Midtrans.
56. Nominal dari Midtrans yang tidak sesuai ditolak.
57. Status belum dibayar atau `challenge` tidak pernah mengkredit penjual.
58. Refund idempoten, dan settlement usang tidak bisa membuka akses lagi.
59. Refund sebagian menahan unduhan dan pendapatan untuk diperiksa.
60. Pembayaran kedua yang lunas ditandai ganda tanpa kredit ganda.

**Pencairan (5)**

61. Pencairan yang menunggu memesan saldo dan mencegah penarikan melebihi saldo.
62. Konfirmasi transfer idempoten dan menjaga saldo yang dipesan.
63. Pencairan yang ditolak melepas saldo yang dipesan.
64. Refund setelah pengajuan memblokir transfer yang dananya tidak cukup.
65. Penjual tidak bisa mengonfirmasi transfernya sendiri.

**Upload (3)**

66. ZIP dengan path traversal ditolak tanpa menyimpan file apa pun.
67. Upload menyimpan file sumber secara privat dan memerlukan moderasi.
68. Penjual tidak bisa mengirim status `approved` atau sampul SVG.

## 21. Keputusan yang sudah dijawab

Dijawab pengguna pada 16 November 2026:

1. **MFA admin:** ya, TOTP wajib untuk admin (bagian 4.4).
2. **Domain:** `staging.jd-sign.com` dipasang lebih dulu di VPS `berdua-sg1`. `jd-sign.com` menyusul setelah staging teruji.
3. **Repo GitHub:** `https://github.com/jefthah/jdsign`.
