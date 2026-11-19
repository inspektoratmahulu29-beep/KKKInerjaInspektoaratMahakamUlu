import {getCookie,json,verifySession} from '../../lib/security.js';
import {getSpreadsheet} from '../../lib/sheets.js';
import {getDriveFileModifiedTime} from '../../lib/google.js';
import {classifyBackendError} from '../../lib/errors.js';
const fingerprint=async value=>{if(!value)return null;const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value).trim()));return Array.from(new Uint8Array(b)).slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('');};
export async function onRequestGet({request,env}) {
 if(!await verifySession(env,getCookie(request,'__Host-kk_session'))) return json({ok:false,message:'Unauthorized'},401);
 let clientEmail=null;try{const sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON||'{}');clientEmail=sa.client_email||null;}catch{}
 const connectionIdentity={spreadsheetFingerprint:await fingerprint(env.GOOGLE_SHEETS_SPREADSHEET_ID),serviceAccountFingerprint:await fingerprint(clientEmail)};
 const configured={ADMIN_USERNAME:Boolean(env.ADMIN_USERNAME),ADMIN_PASSWORD:Boolean(env.ADMIN_PASSWORD),SESSION_SECRET:Boolean(env.SESSION_SECRET),GOOGLE_SERVICE_ACCOUNT_JSON:Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),GOOGLE_SHEETS_SPREADSHEET_ID:Boolean(env.GOOGLE_SHEETS_SPREADSHEET_ID),DEFAULT_YEAR:Boolean(env.DEFAULT_YEAR),DB:Boolean(env.DB)};
 const required=['ADMIN_USERNAME','ADMIN_PASSWORD','SESSION_SECRET','GOOGLE_SERVICE_ACCOUNT_JSON','GOOGLE_SHEETS_SPREADSHEET_ID'];
 const missing=required.filter(k=>!configured[k]);
 if(missing.length) return json({ok:false,code:'CONFIG_MISSING',configured,...connectionIdentity,missing,message:'Lengkapi Variables dan Secrets yang masih kosong.'},503);
 try {
   const spreadsheet=await getSpreadsheet(env);
   const titles=(spreadsheet.sheets||[]).map(x=>x.properties?.title).filter(Boolean);
   const drive=await getDriveFileModifiedTime(env).then(x=>({available:true,canEdit:x.canEdit})).catch(()=>({available:false,canEdit:null}));
   const requiredSheets=['IKU','Rencana Aksi','Realisasi Fisik & Keu','Rekap realisasi PKPT'];
   const missingCore=requiredSheets.filter(n=>!titles.includes(n)&&!titles.includes(`2026__${n}`));
   return json({ok:true,code:'GOOGLE_READ_OK',configured,...connectionIdentity,googleRead:'success',sheetCount:titles.length,missingCore,year:Number(env.DEFAULT_YEAR||2026),driveMetadata:drive,writeAccess:drive.canEdit===false?'denied':drive.canEdit===true?'likely':'not_verified',message:'Google Sheets dapat dibaca. Izin Editor perlu diuji dengan menyimpan satu sel yang aman; pembacaan tidak membuktikan akses tulis.'});
 } catch(e) {
   const detail=classifyBackendError(e,'Gagal menguji koneksi Google Sheets');
   return json({ok:false,configured,...connectionIdentity,googleRead:'failed',...detail},detail.status);
 }
}
