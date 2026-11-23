# PERBAIKAN TERPADU SIKAP + KERTAS KERJA 2026 — NOVEMBER 2026

## Sumber dan batas pengujian
Sumber proyek: SIKAPInspektoratKabMahakamUlu-main (5).zip, KKKInerjaInspektoaratMahakamUlu-main (17).zip.
Sumber angka: 2026_Kertas_Kerja_Inspektorat_Mahakam_Ulu_PKPT_TRIWULAN_DILENGKAPI TERBARU(1).xlsx, 28 worksheet.
Rekaman pendukung: Recording 2026-11-23 161128.mp4.
Perubahan berbasis file sumber yang diunggah; **tidak ada akses ke variable/secret produksi Cloudflare, log server produksi, atau akses live Google Sheets**. Karena itu, jangan menganggap ini telah di-deploy atau tersinkron langsung di situs aktif tanpa langkah validasi di bawah.

## Fitur baru pada KEDUA website
1. Kartu analitik KPI modern muncul langsung di halaman dashboard utama, bukan hanya di menu terpisah. Semua kartu yang tersedia membuka rincian tabel/diagram sesuai sumber.
2. KPI agenda PKPT RENCANA (56 dari Rincian Anggaran PKPT 2026) DIPISAH dari rekap PELAKSANAAN PKPT (76 baris Rekap realisasi PKPT). Jangan samakan 2 populasi tersebut.
3. KPI Surat Tugas NON-PKPT (82), 53 ST terpetakan secara persis terhadap nama subkegiatan anggaran, 29 baris belum cocok; sumber yang belum cocok tidak diberi angka Rp0 palsu.
4. KPI subkegiatan unik (30), pagu rencana PKPT, pagu Oktober, serapan, ST belum klasifikasi (43), ST perlu pemetaan (18), selisih DPPA, register bukti, dan kelengkapan 28 sumber.
5. Drilldown Non-PKPT menampilkan rincian penugasan per bulan, uraian, subkegiatan, kode, lokasi, durasi, target/output, status, serta konteks pagu, realisasi dan sisa dana subkegiatan YANG COCOK. **Nominal subkegiatan bukan biaya khusus per Surat Tugas.** Jangan jumlahkan ulang satu pagu untuk setiap ST.
6. Drilldown PKPT: rincian agenda, Irban, jadwal, target output, rencana biaya agenda, pagu/realisasi subkegiatan sebagai konteks; pelaksanaan PKPT menggunakan rekap aktual terpisah.
7. Rekonsiliasi: 13 baris dengan perbedaan DPPA dan pagu Oktober, total Oktober minus DPPA Rp125.424. Angka pagu rencana agenda PKPT tidak dijumlah sebagai pagu DPA.
8. Chart batang animatif distribusi PKPT per Irban, Non-PKPT per bulan, 6 subkegiatan dengan pagu terbesar, progres serapan keuangan dan rincian sumber.
9. Kedua website mempertahankan editor dan dashboard sebelumnya, dan meneruskan laporan Monev asli yang sudah ada.

## Penguatan sinkronisasi yang benar-benar diimplementasikan
- SETELAH mutasi Google Sheets berhasil, API Kertas Kerja menerbitkan revisi nyata acak bertanggal di sheet tersembunyi `_KK_SYNC` (dibuat otomatis, jangan hapus).
- Mutasi: impor Excel, simpan sel, simpan sheet, simpan workbook, perubahan struktur, dan penambahan laporan resmi; semua endpoint terkait sudah disesuaikan.
- Dashboard SIKAP membaca revisi dari Google Sheets setiap kurang lebih 18 detik ketika tab terlihat. Perubahan revisi memicu reload data master. Jika penanda belum bisa dibaca, dashboard menjalankan full refresh cadangan sekitar setiap 60 detik ketika tab terlihat; tombol Muat Ulang tetap tersedia.
- Kesalahan pasca-commit menerbitkan penanda tidak membatalkan penyimpanan Google. Web1 kini menampilkan peringatan sinkronisasi tersendiri, bukan pesan menyesatkan 'data belum tersimpan'.
- Diagnostik: Web1 `/api/admin/diagnostics` (perlu login) dan Web2 `/api/public/connection?year=2026` mengembalikan fingerprint spreadsheet yang bisa dibandingkan tanpa membocorkan Spreadsheet ID.
- Marker bukan CDC sempurna: perubahan yang dilakukan langsung di Google Sheets tanpa melalui Web1 baru terlihat ketika refresh berkala/manual. Pengujian terhadap koneksi produksi tetap perlu.

## Cara deploy kedua ZIP ke GitHub/Cloudflare Pages
1. BUAT BACKUP repository GitHub masing-masing dan salinan Google Spreadsheet master sebelum mengganti source.
2. Ekstrak ZIP masing-masing. Unggah **ISI** folder repository ke akar repo yang bersangkutan (package.json, src/, functions/, public/, dll), bukan folder ZIP tambahan. Jangan tertukar Web1 (Kertas Kerja) dan Web2 (SIKAP).
3. Pastikan Cloudflare Pages **production build command** `npm run build` dan **output directory** `dist`. Pastikan root directory cocok dengan akar project/package.json, dan Pages Functions pada `functions/` terikut saat deploy.
4. Di kedua Cloudflare Pages Production Settings → Variables and Secrets, bandingkan `GOOGLE_SHEETS_SPREADSHEET_ID`: harus berisi **ID sama persis**. Jangan menampilkan ID/Secret dalam screenshot atau membagikannya dalam chat.
5. Atur `GOOGLE_SERVICE_ACCOUNT_JSON` sebagai secret masing-masing proyek dengan JSON service account valid. Bagikan Spreadsheet pada email service account Web1 dengan izin **Editor** (untuk menulis dan membuat `_KK_SYNC`); Web2 dengan izin **Viewer**. Jika kedua proyek memakai akun sama, izin Editor diperlukan.
6. Pastikan Web1 tetap memiliki `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` dengan nilai produksi terdahulu (tidak dibundel dalam ZIP).
7. Deploy kedua repository; tunggu pipeline deployment menunjukkan selesai (ini tindakan pengguna di Cloudflare, bukan proses dihasilkan dari ZIP). Lakukan hard refresh browser untuk memastikan JS baru.
8. Login Web1 lalu buka `/api/admin/diagnostics`. Pastikan `googleRead=success`, `writeAccess` tidak `denied` (tetap perlu pengujian tulis), salin **fingerprint** spreadsheet saja.
9. Buka Web2 `/api/public/connection?year=2026` lalu cocokkan `spreadsheetFingerprint` dengan Web1, `totalSourcesFound` semestinya 28 setelah impor dan status Google dapat membaca.
10. Impor workbook Excel 28-sheet terbaru melalui Web Kertas Kerja dengan pemetaan nama sheet yang cocok. **Verifikasi preview dan cadangkan rumus** sebelum menekan konfirmasi; jangan jalankan impor berulang bila terjadi koneksi terputus karena Google mungkin sudah menerima sebagian data.
11. Setelah impor/menyimpan sel, periksa Web2 `/api/public/revision`: `markerAvailable:true`, dan revisi berubah ketika Web1 menyimpan. Tinjau Dashboard SIKAP: kartu 56 PKPT rencana, 76 PKPT pelaksanaan, 82 Non-PKPT, dan 28 sheet harus tampil dari Google bukan angka demo.
12. Jika perlu, buka `/api/public/dashboard?year=2026&period=annual&refresh=1` untuk memaksa pembacaan data terbaru. Periode bulanan/triwulan adalah snapshot TERPISAH dan mungkin tidak memuat 28 lampiran; gunakan tahunan untuk menguji workbook Excel lengkap.

## Jika dashboard tetap tidak sinkron
A. `GOOGLE_CONFIG_MISSING`: lengkapi Variables & Secrets pada **Production** di kedua Pages, lalu deploy ulang.
B. `GOOGLE_ACCESS_DENIED` / HTTP 403: periksa email service account, JSON key aktif, dan akses spreadsheet.
C. Fingerprint Web1 ≠ Web2: kedua proyek membaca Spreadsheet ID berbeda; samakan sebelum impor.
D. `markerAvailable:false`: sheet `_KK_SYNC` belum dibuat atau tidak terbaca. Simpan satu sel aman dari Web1; kemudian cek Editor permission, diagnostik, dan pemuatan ulang cadangan.
E. 14/28 atau angka kosong: baru sheet inti yang tersimpan; impor sumber 28 sheet terbaru dan verifikasi nama/sumber, tahun, periode.
F. `#REF!` atau rumus hilang: jangan paksa impor; cek preview/diagnostik sumber, bandingkan nama sheet, impor tanpa merusak kolom sumber, dan pulihkan dari backup jika diperlukan.
G. Data berubah langsung di Google Sheets tanpa melalui Web1: penanda tidak ikut berubah; gunakan refresh cadangan/manual, lalu edit/simpan aman lewat Web1 untuk menerbitkan penanda.
H. Masih menampilkan UI lama: pastikan ZIP terbaru sudah di-commit dan di-deploy pada project/domain yang benar, serta bersihkan cache browser.

## Verifikasi yang telah dilakukan secara lokal
- `npm run check:backend` — PASS pada kedua proyek (13 modul public; 27 modul KKK).
- `npm test` (SIKAP) dan `npm run test:backend` (KKK) — PASS, termasuk pengujian penanda revisi dan pemetaan detail PKPT/Non-PKPT serta selisih anggaran.
- Parsing JSX pada tiga modul frontend yang berubah di kedua website — PASS tanpa error sintaks parser TypeScript.
- Pembacaan workbook aktual menggunakan fixture lokal untuk pengujian — 28 sheet; 30 subkeg; 56 rencana PKPT; 82 NonPKPT; 53/82 pemetaan identik; 13 selisih DPPA; Rp125.424 selisih total.
- Full Vite/React browser build dan deployment Cloudflare produksi **BELUM dapat diuji** karena dependensi npm tidak tersedia secara offline di environment ini. Cloudflare build pipeline dan browser produksi harus diverifikasi setelah upload.
- Pengujian dengan mock API tidak menggantikan verifikasi izin, kuota, dan konsistensi spreadsheet produksi.

## File kode penting
Kertas Kerja Web1:
- `functions/lib/sync-revision.js` BARU; `functions/lib/google.js`
- `functions/api/admin/{import-sheet,cell,sheet,state,structure,official-monev,diagnostics}.js`
- `src/{main.jsx,integratedDetails.js,IntegratedExplorer.jsx,MasterInsights.jsx,master-insights.css,integrated-explorer.css,styles.css}`
- `tests/{revision-marker,new-kpi-drilldown}.mjs`, `tests/official-monev.mjs`, `package.json`.
SIKAP Web2:
- `functions/api/public/{revision,connection}.js`
- `functions/lib/integrated-details.js`
- `src/{main.jsx,IntegratedExplorer.jsx,MasterInsights.jsx,master-insights.css,integrated-explorer.css}`
- `tests/{revision-marker,new-kpi-drilldown}.mjs`, `package.json`.

**Penting:** file Excel asli tetap menjadi master isian; ZIP mengganti source code saja. Angka Rp yang terlihat di dashboard berasal dari Google Sheets setelah impor dan bukan dari fixture pengujian.
