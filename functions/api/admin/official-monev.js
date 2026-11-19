import { getCookie,json,verifySession } from '../../lib/security.js';
import { SEED_WORKBOOK } from '../../lib/seed.js';
import { getSpreadsheet,resolveExistingTitle,writeSingleSheet } from '../../lib/sheets.js';
import { OFFICIAL_REPORT_2026 } from '../../lib/report-schema.js';
import { classifyBackendError } from '../../lib/errors.js';

export async function onRequestPost({request,env}) {
  if(!await verifySession(env,getCookie(request,'__Host-kk_session')))return json({ok:false,message:'Unauthorized'},401);
  try{
    const body=await request.json().catch(()=>({}));
    if(Number(body.year)!==2026 || (body.period||'annual')!=='annual')return json({ok:false,message:'Template laporan resmi hanya untuk tahun 2026 tahunan. Tahun lain harus memakai Excel tahun yang sesuai.'},400);
    const meta=await getSpreadsheet(env);
    const titles=meta.sheets?.map(s=>s.properties.title)||[];
    if(resolveExistingTitle(2026,OFFICIAL_REPORT_2026,titles))return json({ok:true,created:false,message:'Laporan resmi sudah tersedia; tidak ada data yang ditimpa.'});
    if(!resolveExistingTitle(2026,'IKU',titles))return json({ok:false,message:'Inisialisasi 14 sheet utama terlebih dahulu melalui Import Excel; laporan tidak dibuat sendirian.'},409);
    const source=structuredClone(SEED_WORKBOOK.sheets[OFFICIAL_REPORT_2026]);
    // Prevent a second, concurrent operator request from recreating a report.
    // Google Sheets will reject duplicate titles, and no existing report is overwritten.
    const result=await writeSingleSheet(env,source,2026,{import:true,createOnly:true,period:'annual'});
    return json({ok:true,created:true,sheet:OFFICIAL_REPORT_2026,result,message:'Laporan resmi ditambahkan tanpa menimpa sheet lama.'});
  }catch(e){const err=classifyBackendError(e,'Gagal menambahkan laporan Monev resmi');return json({ok:false,...err},err.status);}
}
