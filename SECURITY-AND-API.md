# Web 2 — Kertas Kerja Internal V9

## Arsitektur
- React/Vite frontend + Cloudflare Pages Functions dalam satu repository.
- Semua edit/import/save menggunakan backend `/api/admin/*` setelah login.
- Data pusat dibaca/ditulis melalui Google Sheets API server-side.
- Credential Google hanya berada di Cloudflare Secrets.
- Workbook Excel tidak diletakkan di `public/` agar tidak dapat diunduh langsung.

## Routes
- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/admin/state?year=2026`
- `PUT /api/admin/state`
- `POST /api/admin/audit`

## Cloudflare settings
Variables:
- `ADMIN_USERNAME`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `DEFAULT_YEAR`

Secrets:
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

## Catatan
Password yang diberikan untuk bootstrap akun operator hanya disimpan sebagai Secret Cloudflare. Jangan menaruh credential di GitHub.
