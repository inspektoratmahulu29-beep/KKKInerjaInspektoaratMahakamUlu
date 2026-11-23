/** Server-to-server ONLY: read-only projection for SIKAP.
 * This handler never exposes raw data to a browser: both Cloudflare projects
 * must configure the same long random SIKAP_SYNC_SECRET (>=32 characters).
 * Do not use this endpoint for writes or for file/SPJ retrieval.
 */
import { getGoogleAccessToken } from '../../lib/google.js';
import { request as sheetsRequest } from '../../lib/sheets.js';

const CORE = [
  'IKU','Rencana Aksi','Capaian Sasaran Strategis','Capaian Sasaran Program',
  'Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)',
  'Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)',
  'Monev Renaksi IKU','Monev Program','Monev output Subkegiatan Utama',
  'Monev Subkegiatan Penunjang','Rekap realisasi PKPT','Realisasi Fisik & Keu',
  'Rekap NON PKPT 2026','ST Belum Klasifikasi','Rekonsiliasi DPPA 2026',
  'Validasi Data 2026','Dasar Indikator DPA 2026','Jadwal PKPT dan Bukti 2026',
  'Register Bukti Capaian 2026','Audit Isian 12 Sheet 2026',
  'Capaian Detail Penunjang 2026','ST Perlu Pemetaan Okt 2026',
  'Ringkasan Anggaran PKPT Non','Rincian Anggaran PKPT 2026',
  'TOTAL REKAP PKPT NON 2026'
];
const allowedSources = new Set(CORE);
const reply = (value, status=200) => Response.json(value,{status,headers:{
  'cache-control':'no-store, private','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','vary':'x-sikap-sync-key'
}});
const boundedEqual = async (a,b) => {
  const digest = async v => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const [x,y] = await Promise.all([digest(a),digest(b)]);
  let mismatch=0;for(let i=0;i<x.length;i++)mismatch |= x[i]^y[i];
  return mismatch === 0;
};
function isApprovedRange(input){
  const found = /^'((?:[^']|'')+)'!(A:[A-Z]{1,2}|A1:F2|A1:A1)$/.exec(input);
  if(!found)return false;
  const name=found[1].replace(/''/g,"'");
  if(name==='_KK_SYNC')return found[2]==='A1:F2';
  const prefix=/^(20\d{2})__(?:(?:M(?:0[1-9]|1[0-2])|Q[1-4]|S[12])__)?/.exec(name);
  const base=prefix?name.slice(prefix[0].length):name;
  const allowed=allowedSources.has(base)||/^Laporan_Monev_Renaksi_20\d{2}$/.test(base);
  return allowed && (prefix || base===name); // legacy titles for 2026 remain supported
}
export async function onRequestPost({request,env}){
  const secret=String(env.SIKAP_SYNC_SECRET||'');
  const provided=String(request.headers.get('x-sikap-sync-key')||'');
  if(secret.length<32 || provided.length<32 || provided.length>1024 || !(await boundedEqual(secret,provided)))
    return reply({ok:false,code:'SYNC_UNAUTHORIZED'},401);
  if(!(env.GOOGLE_SHEETS_SPREADSHEET_ID&&env.GOOGLE_SERVICE_ACCOUNT_JSON))
    return reply({ok:false,code:'MASTER_GOOGLE_CONFIG_MISSING'},503);
  let body;
  try{
    if(Number(request.headers.get('content-length')||'0')>12000)return reply({ok:false,code:'INVALID_REQUEST'},413);
    const raw=await request.text();if(raw.length>12000)return reply({ok:false,code:'INVALID_REQUEST'},413);
    body=JSON.parse(raw);
  }catch{return reply({ok:false,code:'INVALID_REQUEST'},400);}
  const operation=String(body?.operation||'');
  if(!['metadata','values','revision'].includes(operation))return reply({ok:false,code:'INVALID_OPERATION'},400);
  if(operation==='values'&&(!Array.isArray(body.ranges)||body.ranges.length<1||body.ranges.length>24||body.ranges.some(r=>typeof r!=='string'||r.length>180||!isApprovedRange(r))))
    return reply({ok:false,code:'INVALID_RANGES'},400);
  try{
    const token=await getGoogleAccessToken(env);
    const id=encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID);
    if(operation==='metadata'){
      const meta=await sheetsRequest(env,`spreadsheets/${id}?fields=spreadsheetId,namedRanges,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))`,{noRetry:true},token);
      return reply({ok:true,meta});
    }
    if(operation==='revision'){
      try{
        const rev=await sheetsRequest(env,`spreadsheets/${id}/values/'_KK_SYNC'!A1:F2?valueRenderOption=UNFORMATTED_VALUE`,{noRetry:true},token);
        const row=rev.values?.[1]||[];
        return reply({ok:true,markerAvailable:Boolean(row[0]),revision:String(row[0]||'')||null,updatedAt:row[1]||null,year:Number(row[2])||null,period:String(row[3]||'annual'),action:String(row[4]||''),count:Number(row[5])||0});
      }catch(error){
        if(Number(error.status)===400 && /unable to parse range|cannot find range|sheet.*not found|range/i.test(String(error.message)))
          return reply({ok:true,markerAvailable:false,revision:null,reason:'MASTER_REVISION_NOT_INITIALIZED'});
        throw error;
      }
    }
    const params=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});
    for(const range of body.ranges)params.append('ranges',range);
    const data=await sheetsRequest(env,`spreadsheets/${id}/values:batchGet?${params}`,{noRetry:true},token);
    return reply({ok:true,data});
  }catch(error){
    const code=Number(error?.status)===403?'MASTER_GOOGLE_ACCESS_DENIED':Number(error?.status)===429?'MASTER_GOOGLE_RATE_LIMITED':Number(error?.status)===404?'MASTER_SPREADSHEET_NOT_FOUND':Number(error?.status)===504?'MASTER_GOOGLE_TIMEOUT':'MASTER_GOOGLE_UNAVAILABLE';
    console.error(JSON.stringify({event:'sikap_sync_master_read_failed',code,httpStatus:Number(error?.status||0)}));
    return reply({ok:false,code},503);
  }
}
