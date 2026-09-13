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


## V9.5 reliability/performance
- Import Excel is applied per sheet through `/api/admin/import-sheet` instead of sending the entire workbook in one request.
- Normal edits use `/api/admin/sheet` and are autosaved after a short idle period.
- Google access tokens are cached in the isolate to avoid re-authenticating for every sheet request.
- Sheet writes are chunked into bounded row batches with retry on transient Google 429/5xx responses.
- `/api/admin/revision` prefers Google Drive file `modifiedTime`/`version` so direct edits in the central spreadsheet can be detected by Web 2 polling.
- D1 remains optional for persistent audit/import logs and a fallback revision counter; it is not the primary Kertas Kerja datastore.
- Enable both Google Sheets API and Google Drive API in the same Google Cloud project used by the Service Account.

## V11 production hardening
Gunakan V11 untuk menghindari pola 503 berulang saat import dan autosave. Import workbook dilakukan batch aman; edit sel biasa dikirim sebagai delta; data lama tidak di-clear sebelum penulisan baru sukses; dan formula parse error dapat di-heal saat login admin.

Sebelum deploy, jalankan:
`node scripts/check-backend.mjs`
