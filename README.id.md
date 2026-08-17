# RetainedSampleQC2 — Database Sampel Retained QC

Aplikasi web modern dan scalable untuk mengelola catatan sampel retained QC (Quality Control). RetainedSampleQC2 mengalihkan database Access legacy ke sistem cloud-native yang dibangun di Firebase, dirancang untuk menangani ratusan ribu catatan dengan pencarian real-time, penyaringan, pelacakan peminjaman, dan pelaporan otomatis.

## Apa Itu Ini?

RetainedSampleQC2 melacak sampel fisik yang disimpan untuk tujuan quality control — biasanya batch bahan baku, produk antara, atau barang jadi yang disimpan untuk verifikasi, pengujian, atau kepatuhan. Sistem mempertahankan jejak audit lengkap dari:

- **Metadata sampel**: nomor batch, kode produk, lokasi kotak, tanggal entri, klasifikasi grup (FG/SF/Filling)
- **Status peminjaman**: siapa yang meminjam apa, kapan, berapa lama — dengan penandaan otomatis untuk overdue
- **Integritas data**: deteksi batch placeholder, pencegahan duplikat, soft-delete dengan kemampuan undelete
- **Catatan historis**: 10+ tahun data sampel, dapat dicari di berbagai jendela waktu (30 hari hingga semua waktu)

## Fitur Utama

### Pencarian & Penyaringan Real-Time
- **Pencarian prefix multi-field** di nomor batch, kode produk, dan lokasi kotak
- **Jendela waktu berjenjang** (30/60/120 hari, 1/3/5/10 tahun, semua waktu) untuk menjaga hasil tetap cepat bahkan dalam skala besar
- **Pencocokkan tidak peka huruf** — ketik `sf66p` atau `SF66P`, keduanya berfungsi
- **Pencegahan duplikat langsung** — melihat apakah batch sudah ada saat Anda mengetik
- **Peringatan pemotongan** — memberi tahu Anda jika hasil dipotong sehingga Anda tahu untuk mempersempit pencarian

### Pelacakan Peminjaman & Status (Dipinjam)
- Tandai sampel sebagai dipinjam dengan nama peminjam, tanggal, dan catatan opsional
- Lacak umur: menunjukkan berapa hari sampel sudah dikeluarkan, menandai overdue (>30 hari secara default)
- Pengembalian instan: tandai sampel yang dikembalikan dan kembalikan status mereka ke "Tersedia"
- Tampilan terpilter: lihat hanya sampel yang dipinjam dengan jendela waktu + penyaringan status bawaan

### Dashboard & Analytics
- **Hitung entri langsung** dengan tren bulan-ke-bulan (indikator ↑/↓)
- **Rincian grup produk** (FG/SF/Filling) dengan penyaringan click-through
- **Distribusi status** (Tersedia/Dipinjam) dengan visibilitas umur
- **Bendera kualitas data** — tampilkan nomor batch placeholder untuk pass pembersihan
- **Entri terakhir** — 8 sampel terbaru untuk verifikasi cepat

### Cetak & Ekspor
- **Cetak per kotak** — ekspor PDF offline dari semua sampel dalam kotak penyimpanan
- **Cetak per batch/kode** — laporan ad-hoc dikelompokkan per produk
- **Ekspor CSV** — unduh tampilan yang disaring untuk analisis spreadsheet
- Semua template cetak di-style untuk desktop dan mobile

### Pemeliharaan Statistik Otomatis
- **Rebuild terjadwal mingguan** (Senin 03:00 Jakarta time) melalui Cloud Scheduler
- Menjaga angka dashboard tetap akurat bahkan ketika catatan dihapus
- Pemicu manual tersedia untuk perhitungan ulang segera
- Penyembuhan mandiri: tidak ada drift memori seiring waktu

### Desain Mobile-First
- **Tata letak responsif** untuk ponsel, tablet, dan desktop
- Navigasi laci di layar kecil, sidebar di desktop
- Tombol ramah sentuh dan bidang input (minimum 48px)
- Kemampuan offline melalui Service Worker untuk data cache

---

## Arsitektur

### Frontend
- **Framework**: Custom `dc-runtime` (seperti React, single-page architecture)
- **File**: `QC2.dc.html` (~2.000 baris, self-contained)
- **Bahasa**: Label UI Bahasa Indonesia, dokumentasi bilingual

### Backend & Database
- **Hosting**: Firebase App Hosting (Cloud Run, auto-scaling)
- **Database**: Firestore (region default, nam5)
- **Auth**: App Check (tidak ada login pengguna; hanya akses jaringan internal)
- **Indexes**: 9 composite index yang dioptimalkan untuk grup/status/date/sort combinations

### Data Layer
- **Local state**: `qc2-store.js` (~1.000 baris) — hybrid IndexedDB + Firestore
- **Pola akses data**: Query paginated server-side (165k record terlalu besar untuk loading client-side)
- **Cache statistik**: dokumen `meta/stats` untuk metrik dashboard O(1)

### Otomasi
- **Pekerjaan terjadwal**: `functions/` — Cloud Function menjalankan rebuild mingguan
- **Pemicu manual**: Endpoint HTTP untuk perhitungan ulang on-demand
- **Monitoring**: Firebase Cloud Logging

---

## Deployment

### Prasyarat
- Proyek Google Cloud dengan rencana Blaze (pay-as-you-go) dan billing diaktifkan
- Firebase CLI dipasang (`npm install -g firebase-tools`)
- Kunci akun layanan dengan akses Firestore

### Quick Start

1. **Clone dan navigasikan ke proyek**
   ```bash
   git clone https://github.com/your-org/RetainedSampleQC2.git
   cd RetainedSampleQC2
   ```

2. **Siapkan kredensial Firebase**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
   firebase login
   firebase use retainedsampleqc2
   ```

3. **Deploy semuanya sekaligus**
   ```bash
   # Front-end, aturan Firestore, index, dan Cloud Functions
   firebase deploy
   ```

4. **Deploy komponen tertentu saja**
   ```bash
   firebase deploy --only hosting              # Frontend saja
   firebase deploy --only functions            # Cloud Functions saja
   firebase deploy --only firestore:rules      # Security rules saja
   firebase deploy --only firestore:indexes    # Composite indexes saja
   ```

5. **Verifikasi deployment**
   - Buka `https://studio-XXXX-YYYY.web.app/` (URL ditampilkan di output deploy)
   - Dashboard harus dimuat dengan hitung entri dan sampel terakhir
   - Pencarian harus berfungsi untuk nomor batch yang ada

### Mengimpor Data Historis

Jika bermigrasi dari database Access:

1. **Ekspor dari Access** sebagai CSV atau gunakan `mdbtools` untuk ekstraksi file `.mdb`
2. **Bersihkan dan normalkan** data (hapus duplikat, perbaiki format tanggal)
3. **Jalankan script impor**
   ```bash
   node import_to_firestore.mjs
   ```
   - Mengimpor hingga 165k record dalam chunk 450-operation idempotent
   - Dapat dengan aman dijalankan ulang tanpa menduplikasi

4. **Rebuild statistik**
   ```bash
   node rebuild_stats.mjs
   ```
   - Menghitung hitung akurat untuk dashboard
   - ~5 detik untuk 165k record

### Perhitungan Ulang Statistik Manual

Jika Anda telah menghapus banyak record dan hitung dashboard meleset:

```bash
# Opsi 1: Script lokal
node rebuild_stats.mjs

# Opsi 2: Pemicu Cloud Function
curl -X POST https://your-function-url/rebuildStatsNow
```

---

## Panduan Penggunaan

### Memasukkan Sampel Baru
1. Klik **"Entri baru"** (atas-kiri banner)
2. Isi: Tanggal, Kode Produk, No. Batch, Kotak, Grup (auto-filled dari pola batch)
3. Tekan Enter atau klik Simpan
4. Sistem memeriksa duplikat secara real-time, blokir jika batch sudah ada

### Pencarian
1. Klik tombol **"Cari"** atau tekan **⌘K**
2. Ketik nomor batch, kode produk, atau kotak (tidak peka huruf, prefix-matching)
3. Klik chip jendela waktu untuk menyesuaikan rentang pencarian (default: 1 tahun terakhir)
4. Hasil muncul terbaru-dulu; klik baris untuk melihat detail

### Menandai Sampel sebagai Dipinjam
1. Buka halaman Records
2. Klik tombol **"Dipinjam"** pada baris, atau pilih beberapa baris dan gunakan tindakan bulk
3. Masukkan nama peminjam, tanggal, catatan opsional
4. Status berubah menjadi "Dipinjam", penghitung umur dimulai

### Mengembalikan Sampel yang Dipinjam
1. Buka menu sidebar **"Dipinjam"** untuk menyaring hanya sampel yang dipinjam
2. Klik **"Return"** pada baris (atau pilih beberapa)
3. Masukkan tanggal pengembalian dan catatan opsional
4. Status dipulihkan ke "Tersedia", sampel keluar dari daftar peminjaman

### Pencetakan
- **Cetak per kotak**: Sidebar > "Cetak" > pilih kotak terakhir > Export PDF
- **Cetak filter saat ini**: Halaman Records > tombol "Print report"
- **Ekspor ke CSV**: Halaman Records > tombol "Export this view (CSV)"

### Audit Peminjaman
- **Tampilan Dipinjam**: Menampilkan semua sampel yang dipinjam dengan penghitung hari-luar
- **Bendera overdue (⚠️)**: Muncul pada sampel >30 hari keluar (dapat dikonfigurasi)
- **Pelacakan peminjam**: Klik sampel overdue apa pun untuk melihat siapa yang meminjamnya dan kapan

---

## Konfigurasi

### Pengaturan yang Dapat Disesuaikan

Edit konstanta di `QC2.dc.html`:

- **`LOAN_OVERDUE_DAYS`** (baris ~842): Ambang hari untuk bendera overdue (default: 30)
- **`SEARCH_WINDOWS`** (baris ~850): Jendela waktu yang tersedia untuk penyaringan pencarian
- **`SEARCH_WINDOW_LABEL`** (baris ~859): Label Bahasa Indonesia untuk setiap jendela

Edit jadwal Cloud Function di `functions/index.js`:

- **`schedule`**: Format mirip cron (default: `'every monday 03:00'`)
- **`timeZone`**: Zona waktu IANA (default: `'Asia/Jakarta'`)
- **`memory`**: RAM untuk Cloud Function (default: `'256MiB'`)

### Aturan Keamanan Firestore

Aturan default di `firestore.rules` memungkinkan semua akses baca/tulis untuk penggunaan internal. Untuk produksi:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Batasi pada permintaan terverifikasi App Check
    match /{document=**} {
      allow read, write: if request.auth.uid != null && request.appCheck.enabled;
    }
  }
}
```

---

## Troubleshooting

### Pencarian Mengembalikan Tidak Ada Hasil
- **Periksa jendela pencarian**: Jendela sempit mungkin mengecualikan data yang lebih lama
- **Verifikasi format batch**: Kode produk peka huruf; `SF66p` dan `sf66p` keduanya berfungsi, tetapi `66SF` tidak akan cocok `SF66`
- **Periksa rentang tanggal**: Gunakan "Semua" untuk mencari semua waktu

### Dashboard Menampilkan "Loading…" atau Hitung Kosong
- Rebuild statistik: `node rebuild_stats.mjs` atau pemicu melalui Cloud Function
- Segarkan halaman (refresh penuh: **Ctrl+Shift+R** di Windows, **Cmd+Shift+R** di Mac)

### Status Peminjaman Tidak Akan Disimpan
- Pastikan Anda berada di halaman Records dalam mode server (bukan offline)
- Coba klik baris lagi untuk mengambil data segar

### Pencarian Lambat pada Batch Besar
- Persempit jendela pencarian (mis. "1 thn" daripada "Semua")
- Gunakan awalan yang lebih spesifik (mis. `SF1` daripada `SF`)
- Periksa konsol browser untuk kesalahan Firestore

---

## Catatan Teknis

### Skema Data

Setiap record berisi:
```javascript
{
  id: string,              // identifier unik
  date: string,            // tanggal ISO 8601 (YYYY-MM-DD)
  batch: string,           // uppercase ternormalisasi, kunci primer alami
  code: string,            // kode produk
  box: string,             // identifier kotak penyimpanan
  group: string,           // 'FG' | 'SF' | 'Filling' (auto-derived dari batch)
  status: string,          // 'ok' | 'borrowed' | 'lost' | 'destroyed'
  loans: array,            // [{by, out, back, note}, ...]
  statusAt: string,        // timestamp ISO 8601 ketika status terakhir berubah
  statusNote: string,      // alasan perubahan status
  updatedAt: string,       // timestamp ISO 8601 update terakhir
  deleted: boolean,        // bendera soft-delete
}
```

### Koleksi Firestore

- **`records`** — 165k+ dokumen sampel, query paginated hanya
- **`meta/stats`** — hitung dashboard, rebuilt mingguan (atau on-demand)
- **`audit`** — masa depan: log perubahan dan pelacakan aktivitas pengguna

### Indexes

9 composite index mencakup semua kombinasi pencarian+sort dengan penyaringan grup/status. Direplikasi di seluruh query untuk menjaga latensi <500ms bahkan dalam skala besar.

---

## Keamanan & Privasi

- **Tidak ada autentikasi yang diperlukan** — mengasumsikan penggunaan jaringan internal (jaringan kantor, VPN)
- **Semua baca/tulis pergi ke Firestore** — state lokal adalah cache hanya, bukan otoritatif
- **Pola soft-delete** — record ditandai `deleted: true` dikecualikan dari tampilan, tidak pernah hard-deleted
- **Jejak audit** (terencana) — log semua perubahan status dan penghapusan untuk kepatuhan
- **Kontrol ekspor** — data tetap di Google Cloud, region-locked ke nam5

---

## Dukungan & Kontribusi

Untuk bug, permintaan fitur, atau masalah deployment:

1. Periksa bagian troubleshooting di atas
2. Tinjau Firebase Cloud Logging untuk kesalahan
3. Buka issue dengan detail: browser, proyek Firebase, pesan kesalahan

Untuk pengembangan:

1. Fork repo
2. Edit `QC2.dc.html` dan `qc2-store.js` secara lokal
3. Test pada proyek Firebase staging
4. Submit PR dengan deskripsi jelas tentang perubahan

---

## Lisensi & Atribusi

RetainedSampleQC2 mengalihkan database retained-sample Microsoft Access legacy ke sistem cloud modern. Dibangun dengan Firebase, dioptimalkan untuk 165k+ record, dan dirancang untuk tim manufaktur/QC.

**Versi:** 2026-08-18  
**Penulis:** Organisasi Anda  
**Pemeliharaan:** Rebuild statistik otomatis mingguan, review keamanan bulanan direkomendasikan
