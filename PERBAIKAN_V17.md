# PERBAIKAN V17 — KERTAS KERJA

Baca **PANDUAN_PENGGANTIAN_GITHUB_V17.md** yang terpisah.

File ZIP PATCH berisi hanya file baru/diubah, relatif terhadap root repository.
Pastikan repo ini tetap merupakan aplikasi terpisah dan memakai Google spreadsheet pusat yang sama dengan proyek pendamping.

## File diperbarui

```text
functions/api/admin/cell.js
functions/api/admin/import-sheet.js
functions/api/admin/sheet.js
functions/api/admin/state.js
functions/api/admin/structure.js
functions/api/admin/workbook-template.js
functions/lib/sheets.js
functions/lib/template2026.js
package.json
src/SpreadsheetEditor.jsx
src/adminApi.js
src/main.jsx
src/spreadsheet.css
src/styles.css
tests/period.mjs
```

## Validasi

Pengujian sintaks dan mock API berhasil. Full build dan uji login/Google di Cloudflare nyata harus dilakukan setelah deploy.
