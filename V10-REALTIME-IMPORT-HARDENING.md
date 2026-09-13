# V10 — Realtime + Excel Import Hardening

Perbaikan utama:
- Import seluruh workbook dilakukan melalui satu endpoint terautentikasi dan batched ke Google Sheets API, bukan 14 request terpisah.
- Payload penulisan dipecah konservatif sekitar 1.5 MB agar menghindari request terlalu besar dan timeout. Google merekomendasikan payload sekitar 2 MB.
- Locale spreadsheet dibaca otomatis. Untuk locale seperti `id_ID`, delimiter argumen formula diadaptasi dari koma ke titik koma saat dikirim sebagai `USER_ENTERED`, sehingga formula Excel tidak berubah menjadi parse error di Google Sheets.
- Formula yang sudah ada di Google Sheets ikut dibaca kembali menggunakan `valueRenderOption=FORMULA`, sehingga round-trip Google Sheets → Web 1 → Excel tidak meratakan formula menjadi nilai saja.
- Realtime Web 1 tetap menggunakan metadata perubahan file Google Drive sebagai revision marker, sehingga perubahan yang dibuat langsung di Google Sheets dapat ditarik kembali ke editor tanpa Web 1 harus dibuka terus-menerus.
