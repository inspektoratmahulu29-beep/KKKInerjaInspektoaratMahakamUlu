# Web 2 — Kertas Kerja Internal Mahakam Ulu V9

Portal internal untuk 14 kertas kerja. Fitur editor tetap mempertahankan inline edit, tambah/duplikat/hapus baris, auto-wrap, formula otomatis, import/export Excel, multi-tahun, preview/validasi import, rollback, dan audit.

## Mode produksi
Frontend dan backend berada dalam satu repository. Backend Cloudflare Pages Functions memverifikasi sesi operator dan menjadi satu-satunya jalur ke Google Sheets.

## Deploy Cloudflare
- Framework: React (Vite)
- Build: `npm run build`
- Output: `dist`
- Root directory: kosong
- Git branch: `main`

## Secrets / Variables
Variables:
- `ADMIN_USERNAME=ItdaKinerja2026`
- `GOOGLE_SHEETS_SPREADSHEET_ID=<ID spreadsheet pusat>`
- `DEFAULT_YEAR=2026`

Secrets:
- `ADMIN_PASSWORD` (isi di Cloudflare, jangan di Git)
- `SESSION_SECRET` (random string panjang)
- `GOOGLE_SERVICE_ACCOUNT_JSON` (isi seluruh JSON service account)

## Google Sheets
Share spreadsheet pusat kepada `client_email` dari Service Account sebagai Editor. Backend membaca 14 sheet kanonik dan menulis perubahan melalui Sheets API.

## Uji setelah deploy
1. Buka `/api/health`.
2. Buka website dan login.
3. Pilih sheet.
4. Edit satu sel.
5. Klik Simpan.
6. Verifikasi perubahan masuk ke Google Sheets.

### Audit D1 (opsional tetapi disarankan)
Tambahkan D1 binding bernama `DB` lalu jalankan `migrations/0001_init.sql`. Audit tetap dapat diterima tanpa binding, tetapi tanpa D1 audit hanya di sesi browser/backend response.


## Google Sheets tahun & import
- TA 2026 menggunakan nama sheet kanonik bila sudah ada.
- Tahun selain 2026 otomatis menggunakan nama `YYYY__Nama Sheet`.
- Import Excel memperbarui/membuat tab Google Sheets secara otomatis melalui backend.
- Browser tidak menyimpan credential Google.
