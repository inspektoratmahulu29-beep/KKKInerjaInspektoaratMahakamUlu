# FORMULA LOGIC — V8.1.3 E AUTO FIX

## Realisasi Fisik & Keu

### Source / editable
- C: Anggaran (nilai sumber)
- G: Realisasi Keuangan (nilai sumber/import untuk baris detail; subtotal program dan total otomatis dijumlahkan)
- K: Permasalahan

### Automatic
- D: Bobot
- E: Realisasi Fisik (%) — otomatis. Template Excel menuliskan E = I/D × 100. Karena I = H×D/100, bentuk ekuivalennya adalah E = H. Implementasi website memakai E = H untuk menghindari dependency/circular calculation namun menghasilkan nilai matematis yang sama.
- F: Fisik Tertimbang = D × E / 100
- H: % Keuangan = G / C × 100
- I: Keuangan Tertimbang = H × D / 100
- J: Sisa Dana = C − G

Program rows aggregate detail rows. Office total aggregates top-level program rows only to prevent double counting.
