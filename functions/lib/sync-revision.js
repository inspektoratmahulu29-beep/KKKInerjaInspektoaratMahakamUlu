/** Shared Google Sheets revision marker. Created only by authenticated Web Kertas Kerja mutations.
 * If publishing fails, mutation remains committed but server reports sync.published=false.
 * Dashboard has a slower full-refresh fallback when marker is unavailable.
 */
import {getGoogleAccessToken} from './google.js';
import {getSpreadsheet, request} from './sheets.js';
export const REVISION_SHEET='_KK_SYNC';
export async function publishRevision(env,{year=2026,period='annual',action='update',count=1}={}){
 const revision=`${Date.now()}-${crypto.randomUUID()}`;
 try{
  const token=await getGoogleAccessToken(env);
  const meta=await getSpreadsheet(env,token);
  if(!(meta.sheets||[]).some(s=>s.properties?.title===REVISION_SHEET)){
   try{await request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:[{addSheet:{properties:{title:REVISION_SHEET,hidden:true,gridProperties:{rowCount:30,columnCount:8}}}}]})},token);}catch(e){
    // Concurrent writes may have already created the marker.
    if(!/already exists|nama.*ada|exists/i.test(String(e?.message||'')))throw e;
   }
  }
  const updatedAt=new Date().toISOString();
  const values=[['revision','updatedAt','year','period','action','count'],[revision,updatedAt,Number(year),String(period),String(action),Number(count)||0]];
  await request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values/'_KK_SYNC'!A1:F2?valueInputOption=RAW`,{method:'PUT',body:JSON.stringify({majorDimension:'ROWS',values})},token);
  return {published:true,revision,updatedAt};
 }catch(error){
  console.warn(JSON.stringify({event:'shared_revision_publish_failed',code:'REVISION_MARKER_FAILED',message:String(error?.message||'').slice(0,160)}));
  return {published:false,code:'REVISION_MARKER_FAILED'};
 }
}
