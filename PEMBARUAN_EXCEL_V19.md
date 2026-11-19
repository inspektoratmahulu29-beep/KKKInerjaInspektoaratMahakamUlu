# V19 — Sinkronisasi Excel resmi Laporan Monev Renaksi (2026)

## Sumber
`2026_Kertas_Kerja_Inspektorat_Mahakam_Ulu_SESUAI_PDF_MONEV_RENAKSI.xlsx` (unggahan pengguna).

## Audit terhadap Excel sebelumnya
- 14 sheet pertama mempertahankan nama, semua nilai, dan seluruh 340 rumus (satu baris lama memiliki perbedaan CRLF/LF yang diselaraskan).
- Sheet ke-15 baru: `Laporan_Monev_Renaksi_2026`, A1:X22, 161 sel tidak kosong, 46 area gabungan; **tidak ada rumus tambahan** dalam sheet ini.
- Baris 5–8 adalah header bertingkat; kegiatan berada di kolom O, pagu anggaran kolom T, realisasi kolom U, hasil Monev kolom V, tindak lanjut kolom W, penanggung jawab kolom X.
- Nilai pagu 12 kegiatan pada template berjumlah Rp2.782.912.288. Kolom U belum berisi nilai realisasi; dashboard menampilkan *Belum diisi*, bukan mengarang realisasi nol.

## Dua laporan sengaja terpisah
- `Laporan_Monev_Renaksi_2026`: sheet RESMI dari Excel; bisa diedit sesuai kolom sumber.
- `Laporan Monev Renaksi`: laporan ANALITIK yang dibangkitkan dari sumber lain, tetap dipertahankan untuk kompatibilitas.
- Perbaikan `compatibleSheetNames` memastikan import Excel tidak memetakan sheet resmi ke laporan analitik berdasarkan kemiripan nama.

## Upgrade Google Sheets tanpa menghapus data berjalan
1. Cadangkan Google Spreadsheet pusat dengan **File → Make a copy**.
2. Deploy Kertas Kerja V19. Perbaiki Variable dan Secret Cloudflare jika perlu.
3. Login operator → tampilan Tahunan 2026. Jika report baru belum ada dan 14 sheet utama sudah tersedia, gunakan tombol **Tambahkan Laporan Resmi**.
4. Tombol memakai `POST /api/admin/official-monev`, menambah **satu** sheet resmi dan tidak mengubah sheet lain. Tidak boleh dipakai untuk mengganti isi sheet laporan yang sudah ada.
5. Pastikan report terlihat dan dapat diedit pada halaman Kertas Kerja, kemudian deploy Dashboard V19. Cache lama dibedakan dengan versi 19.0.
6. Untuk semua 15 sheet dari awal, gunakan **Import Excel** dan tinjau mode serta semua peringatan sebelum menyetujui. Import seluruh workbook *bukan* prosedur upgrade yang disarankan apabila 14 sheet sudah memiliki data baru.

## Pemetaan dashboard
- 14 KPI utama tetap mengambil angka dari 14 sheet induk; angka dari report resmi **tidak ditambahkan lagi** ke total anggaran induk agar tidak terjadi double counting.
- Report resmi ditampilkan sebagai bagian terpisah, dengan jumlah kegiatan berpagu, total pagu, status realisasi dan jumlah realisasi kosong.
- Untuk periode yang belum memuat report resmi, dashboard menunjukkan status laporan belum tersedia; data periode tidak diam-diam mengambil data tahunan.
- Cakupan baris bukan ukuran kepatuhan pengisian seluruh kolom wajib. Label dashboard telah diperjelas sebagai indikator keterisian baris.

## Catatan risiko
- Fitur migrasi hanya menambahkan sheet baru dari template. Perbaikan **tidak mengubah secara otomatis** Google Sheets live sebelum operator menjalankan tindakan dengan login.
- Fitur gabungan TW/semester/tahun masih memakai snapshot terpisah, bukan agregasi otomatis.
- Build npm/Vite di Cloudflare dan izin Google nyata harus diuji setelah deploy; pengujian lokal tidak menggantikan validasi di lingkungan produksi.
- Unggahan ini adalah XLSX; tidak ada PDF terpisah yang diperiksa.
