# PEMBARUAN TERPADU 2026 — SIKAP DASHBOARD + KERTAS KERJA (28 SHEET)

**Sumber otoritatif:** `2026_Kertas_Kerja_Inspektorat_Mahakam_Ulu_PKPT_TRIWULAN_DILENGKAPI TERBARU.xlsx`; periode keuangan **Oktober 2026**. Berkas Excel terakhir ini bukan sekadar acuan tampilan: template unduhan Web Kertas Kerja sekarang berasal **byte demi byte** dari unggahan ini (SHA-256 `30fc95deb415b5b7d7de83fb34b8b1013c368a461a71c2aeddfe011d58c53c15`).

## Fitur yang telah diperbarui

1. **Kedua aplikasi memakai 28 sumber yang sama** di spreadsheet Google bersama. 14 sheet dasar dipertahankan, ditambah laporan Monev Renaksi resmi dan 13 sheet rekonsiliasi, penugasan, bukti, klasifikasi, indikator DPA, serta rincian PKPT.
2. **Web Kertas Kerja:** seed data 28 sheet dan 2.388 sel rumus asli, unduh XLSX sumber terbaru melalui rute operator terlindungi, edit/penambahan baris/kolom serta impor Excel sesuai alur lama; sheet tambahan diketahui oleh backend dan tersedia di menu kertas kerja. Kolom berformula otomatis ditandai **hanya baca pada editor sel**. Prosedur impor menulis nilai terlebih dahulu, lalu rumus sesudah seluruh tab ada, sehingga referensi antarsheet dapat terselesaikan.
3. **Web Dashboard publik:** menu baru **Analitik Terpadu**, berisi grafik batang animatif subkegiatan, daftar rincian subkegiatan, penugasan/Irban, jadwal PKPT dan biaya rencana, catatan validasi dan register bukti, status ST belum terklasifikasi/terpetakan, dan status keterbacaan 28 sheet. Pencarian dan filter aktif, dengan tabel yang dapat digulir di HP.
4. **Rekonsiliasi:** nilai anggaran PKPT, Non-PKPT, dan Dipakai Bersama merupakan pengelompokan beririsan; **tidak boleh dijumlahkan** sebagai pagu total. Pagu unik berasal dari baris **SELURUH INSPEKTORAT** pada sheet `TOTAL REKAP PKPT NON 2026`. Serapan keuangan bukan tingkat penyelesaian keluaran.
5. **Pembedaan sumber fisik:** Fisik Rekap Oktober 2026 = **54,4920847157%**; fisik menurut SMPEQ = **41,38%**. Dashboard baru memperlihatkan keduanya terpisah dan tidak mengganti fakta satu sama lain.
6. **Fleksibilitas:** pembacaan sheet Google mempertahankan pemetaan kolom bernama (saat kolom disisipkan) serta batas pembacaan adaptif. Tab tambahan dari impor tahun/periode ditemukan di Web Kertas Kerja. Periode bulanan/triwulanan tetap terisolasi dari periode tahunan. Menu analitik menggunakan data periode yang dipilih jika tersedia, bukan menyalin otomatis angka tahunan.
7. Fungsi yang sudah ada seperti login, pengaturan tahun, editor inline, penyimpanan dan retry, ekspor, laporan, grafik dan rincian PKPT/keuangan **dipertahankan**; tidak ada fitur yang sengaja dihapus.

## Rujukan angka dari workbook Oktober 2026

| Besaran | Nilai berdasarkan sumber Excel |
| --- | ---: |
| Pagu Inspektorat unik | Rp17.643.979.587 |
| Realisasi keuangan | Rp9.614.349.692 |
| Sisa pagu | Rp8.029.629.895 |
| Pagu rencana agenda PKPT | Rp3.531.979.288 |
| Subkegiatan unik | 30 |
| Agenda perencanaan PKPT | 56 |
| Surat Tugas Non-PKPT terdaftar | 82 |
| Surat Tugas belum diklasifikasi | 43 |
| Surat Tugas yang masih perlu pemetaan | 18 |
| Realisasi fisik versi rekap | 54,4920847157% |
| Realisasi fisik versi SMPEQ | 41,38% |

**Catatan:** jumlah penugasan status yang berasal dari `Rekap realisasi PKPT` adalah 76 (29 selesai, 11 berjalan, 36 belum). **Angka 76 itu berbeda objek** dengan 56 agenda rencana PKPT dan 82 surat tugas Non-PKPT. Angka tersebut tidak dicampur untuk menghasilkan progres palsu. Data output yang tidak memiliki bukti capaian tidak dianggap selesai.

## Susunan 28 sheet

01. IKU — 18 baris, 17 kolom, 0 rumus
02. Rencana Aksi — 37 baris, 13 kolom, 0 rumus
03. Capaian Sasaran Strategis — 16 baris, 11 kolom, 28 rumus
04. Capaian Sasaran Program — 13 baris, 12 kolom, 28 rumus
05. Capaian Sasaran Kegiatan Utama — 8 baris, 13 kolom, 17 rumus
06. Capaian Sasaran Kegiatan(Penun) — 12 baris, 14 kolom, 34 rumus
07. Capaian Sasaran SUBKegiatan(U) — 17 baris, 14 kolom, 53 rumus
08. Capaian Sasaran SUBKegiatan (P) — 23 baris, 15 kolom, 77 rumus
09. Monev Renaksi IKU — 34 baris, 18 kolom, 0 rumus
10. Monev Program — 36 baris, 24 kolom, 7 rumus
11. Monev output Subkegiatan Utama — 60 baris, 14 kolom, 0 rumus
12. Monev Subkegiatan Penunjang — 31 baris, 13 kolom, 0 rumus
13. Rekap realisasi PKPT — 111 baris, 27 kolom, 386 rumus
14. Realisasi Fisik & Keu — 64 baris, 11 kolom, 265 rumus
15. Laporan_Monev_Renaksi_2026 — 22 baris, 24 kolom, 24 rumus
16. Rekap NON PKPT 2026 — 92 baris, 30 kolom, 350 rumus
17. ST Belum Klasifikasi — 48 baris, 13 kolom, 1 rumus
18. Rekonsiliasi DPPA 2026 — 36 baris, 10 kolom, 156 rumus
19. Validasi Data 2026 — 24 baris, 16 kolom, 22 rumus
20. Dasar Indikator DPA 2026 — 34 baris, 16 kolom, 90 rumus
21. Jadwal PKPT dan Bukti 2026 — 61 baris, 17 kolom, 273 rumus
22. Register Bukti Capaian 2026 — 10 baris, 10 kolom, 0 rumus
23. Audit Isian 12 Sheet 2026 — 18 baris, 7 kolom, 0 rumus
24. Capaian Detail Penunjang 2026 — 23 baris, 16 kolom, 77 rumus
25. ST Perlu Pemetaan Okt 2026 — 22 baris, 7 kolom, 0 rumus
26. Ringkasan Anggaran PKPT Non — 36 baris, 13 kolom, 159 rumus
27. Rincian Anggaran PKPT 2026 — 62 baris, 16 kolom, 282 rumus
28. TOTAL REKAP PKPT NON 2026 — 36 baris, 9 kolom, 59 rumus

## Pemasangan dua repository GitHub/Cloudflare Pages

1. **Cadangkan** dua repository GitHub lama dan Google Spreadsheet pusat (File → Buat salinan). Jangan menghapus data produksi sebelum backup.
2. Ekstrak ZIP masing-masing. Unggah **isi folder root proyek**, termasuk `src`, `functions`, `public`, `package.json`, `package-lock.json`, dan `wrangler.toml`, ke **repository GitHub yang sesuai**. Jangan mencampurkan source code kedua proyek ke repository yang sama.
3. Di Cloudflare Pages kedua proyek: Build command `npm run build`; Build output `dist`. Folder `functions` harus ada di root repository. Gunakan Node.js modern sebagaimana konfigurasi proyek saat ini.
4. **Kedua Pages projects harus menunjuk ke Spreadsheet yang sama** melalui `GOOGLE_SHEETS_SPREADSHEET_ID`. Set `GOOGLE_SERVICE_ACCOUNT_JSON` sesuai masing-masing proyek, dan bagikan Google Spreadsheet ke alamat `client_email` service account: minimal **Editor** untuk Web Kertas Kerja dan **Viewer** untuk Web Dashboard. Jika service account berbeda, keduanya harus punya akses yang benar ke spreadsheet ID yang sama.
5. Pada **Web Kertas Kerja**, pertahankan secret autentikasi `ADMIN_USERNAME`, `ADMIN_PASSWORD`, dan `SESSION_SECRET`. Jangan pernah memasukkannya ke GitHub/source frontend. Login, lalu **unduh template resmi 28 sheet** dan cek apakah data master Google Sheets sudah berisi 28 tab sumber. Gunakan menu **Import Excel** untuk memuat file terbaru ini; pastikan periode **Tahunan/2026** dan tinjau preview, pemetaan, serta potensi dampak mode penggantian. Bila Anda punya perubahan manual penting di database lama, pertahankan backup dan rekonsiliasi per sheet sebelum memilih penggantian, sebab impor **replace** dapat menimpa isi sheet yang sama.
6. Jika hanya ada beberapa sheet lama, tersedia tombol **Lengkapi sheet yang hilang**: menambahkan sumber yang tidak ada dari template tanpa mengganti sheet yang sudah ada. Cara ini **tidak mengubah angka pada sheet lama**; untuk menyelaraskan seluruh isi dengan Excel Oktober, Anda tetap perlu impor terkontrol/reviu sesuai kewenangan.
7. Pada Web Dashboard, buka `/api/public/dashboard?year=2026&period=annual&refresh=1`. Periksa `expectedSheetCount: 28`, `missingSheets`, `formulaHealth`, `integrated.sheetList`. Dashboard harus menunjukkan `28/28` sumber hanya bila semua sheet telah disimpan dan terbaca di Google Sheets. Verifikasi `GOOGLE_SHEETS_SPREADSHEET_ID` identik pada kedua aplikasi.
8. Buka menu **Analitik Terpadu** pada kedua website, cek angka pagu unik, realisasi, 56 agenda, status surat tugas, lalu buka data sumber di Web Kertas Kerja untuk membandingkan baris dan dokumennya.

## Pengujian dan batas verifikasi

- **Lulus pada pengujian lokal berbasis Node dan mock Google API:** 28 nama sheet, 2.388 rumus dan formula refs, 30 kode subkegiatan tanpa duplikasi pagu, 56 agenda, 82 baris Non-PKPT, klasifikasi/pemetaan, pergeseran kolom, import RAW-sebelum-rumus, autentikasi API, laporan Monev resmi, tahun/periode, status sumber tidak tersedia, dan pembacaan keuangan/PKPT Web Dashboard. Pemeriksaan `scripts/check-backend.mjs` untuk kedua proyek lulus.
- **Belum dapat dijalankan pada lingkungan pengerjaan ini:** build Vite/React karena paket npm belum sepenuhnya tersedia dan pengunduhan dependency dari npm registry tidak dapat dilakukan di lingkungan ini; kedua proyek menyertakan `package-lock.json` untuk dapat dibangun di GitHub/Cloudflare. Pengujian UI visual di browser dan koneksi ke Google Sheets produksi **belum dilakukan**, karena kredensial produksi tidak tersedia.
- **Tidak ada deploy otomatis:** mengunggah ZIP ke percakapan bukan mengubah repository GitHub maupun database Cloudflare. Penggantian sumber data wajib dilakukan dan diverifikasi oleh operator setelah backup.
- Bila jumlah sheet melebihi 28 pada masa mendatang, Web Kertas Kerja dapat membaca sheet hasil impor, namun rincian khusus dashboard saat ini secara eksplisit didefinisikan untuk 28 sheet sumber 2026. Skema/data dengan nama berbeda memerlukan pemetaan baru untuk visualisasi khusus.
- Hati-hati sebelum menerbitkan data berisi nomor Surat Tugas, register bukti atau rincian anggaran di domain publik; pastikan keterbukaan informasinya sesuai kebijakan instansi. **Dashboard publik tidak menerapkan autentikasi.**

## Pengujian secara lokal (lingkungan dengan akses npm registry)

```sh
npm ci
npm run build
npm test
```

Khusus Web Kertas Kerja, `npm run test:backend` tidak membutuhkan browser. `npm test` menjalankan pula pengujian rendering yang memerlukan npm dependency lengkap. Jalankan pengujian di **masing-masing** folder secara terpisah.
