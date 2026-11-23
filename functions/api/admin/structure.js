import { getCookie,json,verifySession } from '../../lib/security.js';
import { changeStructure,normalizePeriod } from '../../lib/sheets.js';
import { publishRevision } from '../../lib/sync-revision.js';
export async function onRequestPost({request,env}){
 if(!await verifySession(env,getCookie(request,'__Host-kk_session')))return json({ok:false,message:'Unauthorized'},401);
 try{const body=await request.json();const year=Number(body.year||2026);if(!Number.isInteger(year)||year<2000||year>2100)throw new Error('Tahun tidak valid');await changeStructure(env,body,year,normalizePeriod(body.period));
 if(env.DB){try{await env.DB.prepare("INSERT INTO revision_state (id,revision,updated_at) VALUES ('global',1,?) ON CONFLICT(id) DO UPDATE SET revision=revision_state.revision+1,updated_at=excluded.updated_at").bind(new Date().toISOString()).run();}catch(auxError){console.warn(JSON.stringify({event:'optional_d1_revision_failed',source:'structure',message:String(auxError?.message||'D1 unavailable').slice(0,180)}));}}
 const sync=await publishRevision(env,{year,period:normalizePeriod(body.period),action:'structure',count:1});
 return json({ok:true,year,sync});
 }catch(e){return json({ok:false,message:e.message+' Jika koneksi terputus, muat ulang sebelum mengulangi penyisipan.'},e.status||503);}
}
