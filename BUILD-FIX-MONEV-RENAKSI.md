# Build Fix Monev Renaksi

Perbaikan ini ditujukan untuk error JSX pada `src/monevReport.jsx` yang menyebabkan Vite/esbuild membaca tag `tr/thead/table/div/section` tidak berpasangan.

Perubahan:
- JSX halaman Monev Renaksi dipecah menjadi struktur multi-baris yang jelas.
- `src/monevReport.jsx` tetap menjadi sumber komponen Monev Renaksi.
- `vite.config.js` ditambahkan untuk memastikan `@vitejs/plugin-react` aktif.
- `wrangler.toml` menggunakan `pages_build_output_dir = "dist"` untuk konfigurasi Cloudflare Pages.

Jalankan `npm install` lalu `npm run build`.
