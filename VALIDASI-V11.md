# V11 — Validasi produksi sebelum deploy

## Perbaikan penting
- Import workbook 14 sheet tetap satu request dari browser, lalu backend membagi penulisan menjadi batch aman.
- Penulisan **tidak lagi melakukan clear terlebih dahulu**. Data lama baru dibersihkan setelah seluruh batch baru berhasil ditulis, sehingga kegagalan di tengah proses tidak meninggalkan sheet setengah kosong.
- Ekor baris/kolom lama dibersihkan setelah sukses sehingga tidak ada data sisa dari import sebelumnya.
- Edit satu sel menggunakan endpoint ringan `POST /api/admin/cell`, bukan mengirim 900+ baris setiap kali mengetik.
- Formula error dideteksi sebagai token error Excel/Sheets yang sebenarnya (`#ERROR!`, `#REF!`, `#VALUE!`, dst.), bukan semua teks yang kebetulan diawali `#`.
- Saat Web 1 membaca spreadsheet, formula yang menghasilkan error parse dan cocok dengan formula aktif dapat diperbaiki otomatis sesuai locale spreadsheet.
- Retry Google API memakai timeout, exponential backoff, jitter, dan menghormati `Retry-After`.
- Formula eksternal tidak ditulis kembali sebagai formula eksternal; nilai cache dipertahankan.

## Spreadsheet yang dilampirkan
Workbook contoh memiliki 14 sheet dan 338 formula. Pemeriksaan token error aktual menghasilkan 0 error. Teks seperti `# Audit Kinerja ...` pada kolom H **bukan** error dan sekarang tidak lagi dihitung sebagai error.

## Sinkronisasi
- Web 1 -> Google Sheets: autosave sel cepat sekitar 700 ms untuk perubahan sel biasa; operasi baris/import tetap memakai save penuh.
- Google Sheets -> Web 1: Web 1 memeriksa revision metadata Drive sekitar 5 detik dan mengambil ulang database saat ada perubahan eksternal.
- Web 2 tidak bergantung pada Web 1. Web 2 membaca sumber Google Sheets langsung melalui backend publik.

## Batas realtime yang realistis
Realtime publik berarti target beberapa detik, bukan zero-latency. Web 2 menggunakan edge cache pendek sehingga banyak viewer tidak membuat panggilan Google Sheet sendiri.
