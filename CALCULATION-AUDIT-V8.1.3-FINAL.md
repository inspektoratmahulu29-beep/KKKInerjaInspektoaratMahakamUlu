# Calculation Audit V8.1.3 Final

## Realisasi Fisik & Keu
- C = Anggaran (detail input; ringkasan otomatis)
- D = Bobot otomatis
- E = Realisasi Fisik (detail input dari sumber Excel; ringkasan otomatis berbobot)
- F = Fisik Tertimbang otomatis: D × E ÷ 100
- G = Realisasi Keuangan (detail input dari sumber Excel; ringkasan otomatis)
- H = % Keuangan otomatis: G ÷ C × 100
- I = Keuangan Tertimbang otomatis: H × D ÷ 100
- J = Sisa Dana otomatis: C − G
- Total dashboard mengambil baris kantor/summary program tingkat atas saja untuk mencegah double-counting.

## Capaian 6 level
Semua baris data yang memiliki target dan realisasi mempunyai formula capaian dan realisasi anggaran. Formula tidak diterapkan pada baris kosong/spacer.

## Capaian SUBKegiatan (P)
Kolom M = Pagu Anggaran dan N = Realisasi Anggaran diselaraskan dengan sheet Capaian Sasaran Kegiatan(Penun) yang menjadi pasangan sumber. Kolom O = N ÷ M.

## Output KPI
- Output utama = SUM kolom L pada Monev output Subkegiatan Utama.
- Output penunjang = SUM kolom K pada Monev Subkegiatan Penunjang.
- Tidak lagi menghitung berdasarkan teks aktivitas saja.
