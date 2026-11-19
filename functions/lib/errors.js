// Never return credentials or full upstream errors in public/untrusted routes.
export function classifyBackendError(error, fallback = 'Permintaan Google Sheets gagal') {
  const raw = String(error?.message || '').trim();
  const status = Number(error?.status || 0);
  const auth = /OAuth|invalid_grant|invalid jwt|private key|service account.*JSON/i.test(raw);
  const config = /belum diatur|belum dikonfigurasi|tidak valid|tidak lengkap/i.test(raw) && /GOOGLE_|service account|google sheets/i.test(raw);
  if(config) return {code:'GOOGLE_CONFIG_INVALID',status:503,message:'Konfigurasi Google Sheets belum lengkap atau format Service Account JSON tidak valid.'};
  if(auth) return {code:'GOOGLE_AUTH_FAILED',status:503,message:'Autentikasi Service Account Google gagal. Periksa JSON, private_key, status kunci, dan Google Sheets API.'};
  if(status === 401) return {code:'GOOGLE_AUTH_FAILED',status:503,message:'Token Google ditolak. Periksa konfigurasi Service Account.'};
  if(status === 403) return {code:'GOOGLE_ACCESS_DENIED',status:503,message:'Google menolak akses. Bagikan spreadsheet kepada client_email Service Account sebagai Editor, aktifkan Sheets API dan periksa protected range.'};
  if(status === 404) return {code:'SPREADSHEET_NOT_FOUND',status:503,message:'Spreadsheet tidak ditemukan atau belum dibagikan kepada Service Account. Periksa Spreadsheet ID dan izin akses.'};
  if(status === 429) return {code:'GOOGLE_RATE_LIMIT',status:503,message:'Google Sheets membatasi jumlah permintaan. Simpan ditahan; periksa kuota dan coba kembali sesudah jeda.'};
  if(status === 400) return {code:'SHEET_WRITE_INVALID',status:503,message:`Google menolak operasi sheet (400): ${raw.slice(0,240) || 'range/rumus/format tidak valid'}`};
  if(status === 409) return {code:'SHEET_STRUCTURE_CONFLICT',status:409,message:raw || 'Struktur sheet berubah. Muat ulang sebelum mengedit.'};
  if(status === 504 || /timeout|abort/i.test(raw)) return {code:'GOOGLE_TIMEOUT',status:503,message:'Google Sheets tidak merespons dalam batas waktu. Perubahan lokal belum tersimpan.'};
  return {code:'GOOGLE_WRITE_FAILED',status:503,message:raw && !/PRIVATE KEY|BEGIN |password|bearer |authorization/i.test(raw) ? raw.slice(0,250) : fallback};
}
