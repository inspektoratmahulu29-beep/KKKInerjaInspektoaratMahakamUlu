import {resolveExistingTitle} from '../functions/lib/sheets.js';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { SEED_WORKBOOK } from '../functions/lib/seed.js';
import { TEMPLATE_2026_XLSX_BASE64 } from '../functions/lib/template2026.js';
import { compatibleSheetNames, officialReportName, summarizeOfficialMonev, OFFICIAL_REPORT_2026 } from '../functions/lib/report-schema.js';
import {calculateMetrics} from '../functions/lib/metrics.js';
import { createSession } from '../functions/lib/security.js';
import { onRequestPost } from '../functions/api/admin/official-monev.js';
import {createHash} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const official=SEED_WORKBOOK.sheets[OFFICIAL_REPORT_2026];
assert.equal(Object.keys(SEED_WORKBOOK.sheets).length,28);
assert.equal(official.cols,24);
assert.equal(official.rows,22);
assert.equal(official.values.flat().filter(v=>v!==''&&v!==null).length,180);
assert.equal(official.presentation.merges.length,46);
assert.equal(Object.values(SEED_WORKBOOK.sheets).reduce((a,s)=>a+Object.keys(s.formulas||{}).length,0),2388);
const report=summarizeOfficialMonev(official);
assert.equal(report.activities,12);
assert.equal(report.plannedBudget,2846194538);
assert.equal(report.realizedBudget,1232815268);
assert.equal(report.missingRealizations,0);
assert.equal(compatibleSheetNames('Laporan Monev Renaksi',OFFICIAL_REPORT_2026),false);
assert.equal(compatibleSheetNames(OFFICIAL_REPORT_2026,officialReportName(2027)),false);
assert.equal(compatibleSheetNames('Monev Program','Monev_Program'),true);
const metrics=calculateMetrics(SEED_WORKBOOK.sheets);
assert.equal(metrics.monevResmi.plannedBudget,2846194538);
assert.equal(metrics.totalAnggaran,17643979587,'Official report must not be double-counted in general KPI');
// Ensure latest exact XLSX is embedded as the protected download artifact.
const templateDigest=createHash('sha256').update(Buffer.from(TEMPLATE_2026_XLSX_BASE64,'base64')).digest('hex');
assert.equal(templateDigest,'30fc95deb415b5b7d7de83fb34b8b1013c368a461a71c2aeddfe011d58c53c15', 'Bundled Excel template must match the latest user-provided reference byte for byte.');
// Mock Google Cloud/Sheets: adding the official report must never issue a
// values update for IKU or any existing worksheet.
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pk=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const env={ADMIN_USERNAME:'operator',SESSION_SECRET:'test-secret-for-migration',GOOGLE_SHEETS_SPREADSHEET_ID:'test-migration',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`})};
const session=await createSession(env);
const meta={properties:{locale:'en_US'},namedRanges:[],sheets:[{properties:{title:'IKU',sheetId:1,gridProperties:{rowCount:1000,columnCount:26}}}]};
const calls=[];
let sequence=2;
globalThis.fetch=async(url,init={})=>{
 const href=String(url);let body=null;try{body=init.body?JSON.parse(init.body):null;}catch{}calls.push({url:href,body});
 if(href.includes('oauth2'))return Response.json({access_token:'token',expires_in:3600});
 if(href.includes(':batchUpdate')&&body?.requests){for(const req of body.requests){
   if(req.addSheet){const p=req.addSheet.properties;meta.sheets.push({properties:{title:p.title,sheetId:sequence++,gridProperties:p.gridProperties}});}
   if(req.addNamedRange){meta.namedRanges.push({...req.addNamedRange.namedRange,namedRangeId:'n'+meta.namedRanges.length});}
 }}
 return Response.json(href.includes(':batchUpdate')?{}:meta);
};
const post=()=>onRequestPost({request:new Request('https://test.invalid/api/admin/official-monev',{method:'POST',headers:{Cookie:`__Host-kk_session=${encodeURIComponent(session)}`},body:JSON.stringify({year:2026,period:'annual'})}),env});
const result=await post();assert.equal(result.status,200);assert.equal((await result.json()).created,true);
assert.equal(meta.sheets.length,3,'Migration creates official report and hidden _KK_SYNC revision sheet');
assert.equal(meta.sheets[1].properties.title,'2026__Laporan_Monev_Renaksi_2026');
assert.equal(meta.sheets[2].properties.title,'_KK_SYNC');
const writes=calls.filter(x=>x.body?.data?.length).flatMap(x=>x.body.data);
assert.ok(writes.length,'Report should be persisted to Google Sheets');
assert.ok(writes.every(x=>x.range.includes('Laporan_Monev_Renaksi_2026')),'Migration must not write to existing user worksheets');
assert.equal(writes[0].values[8][19],194820000);
const firstWriteCount=calls.filter(x=>x.body?.data?.length).length;
assert.ok(firstWriteCount>=1,'Raw values and formulas may be separate safe writes');
const again=await post();assert.equal((await again.json()).created,false);
assert.equal(calls.filter(x=>x.body?.data?.length).length,firstWriteCount,'Repeated migration must not rewrite report');
console.log('PASS official Monev: 28 sheets, 2388 formulas, 180 report cells, 46 merges, original XLSX byte-exact, independent KPI, and one-shot protected no-overwrite migration.');

assert.equal(resolveExistingTitle(2026,'Laporan Monev Renaksi',['Laporan_Monev_Renaksi_2026']),null,'Laporan analitik must never alias official Excel sheet');
