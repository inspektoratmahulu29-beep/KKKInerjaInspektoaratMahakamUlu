# PERBAIKAN V23 — IMPOR EXCEL FLEKSIBEL DAN CEPAT (WEB 1)

## Tujuan
Mengurangi kemungkinan munculnya `#REF!` setelah pembaruan Excel, menjaga keutuhan seluruh sheet/rumus, serta mengurangi jumlah permintaan API Google Sheets saat tombol **Validasi → OK → Simpan** digunakan. Perubahan ini spesifik untuk Kertas Kerja Inspektorat Kabupaten Mahakam Ulu dan tidak mengubah metode login maupun identitas akun.

## Penyesuaian
1. **Shared formula Excel.** File `.xlsx` dapat memuat satu rumus induk bersama dan puluhan rumus turunan tanpa teks formula tersendiri. `src/excelSharedFormulas.js` membaca bagian OOXML secara lokal (browser) untuk mengembalikan rumus turunan dengan referensi relatif/absolut yang tepat, sebelum preview/import dilakukan. File `.xls` lama tetap menggunakan pembaca BIFF pada library Excel.
2. **Validasi defensif.** Sumber berisi nilai atau rumus `#REF!` ditolak sebelum penulisan. Rumus bersama yang tidak memiliki induk juga ditolak. Validasi diulang ketika pengguna menekan OK, bukan hanya saat preview.
3. **Simpan per sheet yang diimpor.** Hanya sheet yang ada dan dipilih dari Excel yang ditulis ulang; sheet analisis lainnya tetap utuh. Jika terdapat sheet baru dengan nama baru, backend menyimpan tab baru dan pembaca menampilkannya kembali setelah reload. Sheet bulan/triwulan/semester tetap terpisah dari tahunan.
4. **Urutan simpan aman.** Semua data disimpan dengan opsi `RAW` dahulu; setelah data selesai, semua rumus disimpan dalam batch `USER_ENTERED`. Ini membantu menghindari referensi sementara yang terputus antar-sheet dan mencegah kode teks (misal `001`) berubah menjadi angka/tanggal.
5. **Mempertahankan format.** Pada sheet Google yang sudah ada, impor biasa tidak menghapus dan menyusun ulang merge, gaya, ukuran, dan seluruh format. Untuk sheet baru, format Excel tetap ditulis. Pembaruan named range/kolom hanya dikirim apabila mapping berubah.
6. **Efisiensi.** Penulisan Google Sheets memakai batch; simpan beberapa sheet sekaligus memakai satu endpoint; pencatatan impor D1 memakai batch jika tersedia. Tombol impor dicegah diklik berulang sebelum operasi selesai.
7. **Verifikasi hasil.** Setelah simpan, website memuat ulang data Google Sheets dan memeriksa sel rumus terhadap nilai error. Apabila ditemukan error, muncul lokasi sel dan pesan kegagalan verifikasi; website tidak mengklaim terjadi rollback otomatis. Backup lokal pra-impor tetap tersedia.

## File GitHub yang berubah
- `src/excelSharedFormulas.js` **BARU**
- `src/main.jsx`
- `src/adminApi.js`
- `functions/lib/sheets.js`
- `functions/api/admin/import-sheet.js`
- `tests/import-hardening.mjs` **BARU**
- `package.json` dan `package-lock.json`
- `PERBAIKAN_IMPORT_EXCEL_V23.md` **BARU**

## Langkah pasang
1. **Cadangkan** repository dan Google Spreadsheet yang sudah berisi data sebelum deployment.
2. Ganti file yang tercantum di atas dengan isi ZIP patch, **pertahankan path relatif**. Alternatif: gunakan seluruh ZIP Web 1 sebagai sumber branch GitHub pengganti.
3. Deploy ulang proyek Cloudflare Pages **Web 1** (build: `npm run build`, output: `dist`, root: direktori repository).
4. Pastikan variabel/secrets Cloudflare yang sudah berfungsi tidak berubah (`GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, autentikasi, D1 jika digunakan).
5. Pada website, login, buka impor Excel, pilih file yang baru, periksa preview nama sheet/mapping/rumus, klik validasi/simpan **sekali**, lalu tunggu notifikasi pembacaan ulang.
6. Cek sheet `Realisasi Fisik & Keu` dan laporan lain, lalu cek Web 2. Jika browser masih menampilkan berkas lama, lakukan hard refresh.

## Lingkup pengujian
- Uji regresi backend: `npm run test:backend` (termasuk kasus teks `001`, formula relative/absolute, referensi antar sheet, source `#REF!`, penambahan tab).
- Validasi file XLSX April lampiran secara independen: 15 sheet, 412 elemen rumus, 79 shared-formula children, tanpa orphan anchor dan tanpa error `#REF!` yang tersimpan dalam cache file. Angka formula berbeda dari template yang lebih lama dan **tidak** berarti rumus pasti dapat dievaluasi di Google Sheets tanpa koneksi live.
- Uji endpoint/lokal **tidak setara dengan** uji langsung pada Spreadsheet produksi. Setelah deployment, uji dengan salinan Spreadsheet sebelum mengimpor ke data kerja.
- Paket dibuat tanpa mengunggah atau menyertakan file Excel pengguna, rekaman, password, ataupun kredensial.
