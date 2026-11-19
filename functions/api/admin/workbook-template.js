import {getCookie,verifySession} from '../../lib/security.js';
import {TEMPLATE_2026_XLSX_BASE64} from '../../lib/template2026.js';

// The source Excel may contain internal organizational data. Serve it only after
// the existing operator session check; never copy it into /public assets.
export async function onRequestGet({request,env}){
  if(!await verifySession(env,getCookie(request,'__Host-kk_session'))){
    return Response.json({ok:false,message:'Sesi operator dibutuhkan'},{status:401,headers:{'Cache-Control':'private,no-store'}});
  }
  const binary=atob(TEMPLATE_2026_XLSX_BASE64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Response(bytes,{headers:{
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':'attachment; filename="2026_Kertas_Kerja_Inspektorat_Mahakam_Ulu_SESUAI_FORMAT.xlsx"',
    'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'
  }});
}
