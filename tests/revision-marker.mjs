import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {publishRevision} from '../functions/lib/sync-revision.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pk=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const env={GOOGLE_SHEETS_SPREADSHEET_ID:'test-revision-sheet',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'rev@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`})};
const meta={sheets:[{properties:{title:'IKU',sheetId:1}}],namedRanges:[],properties:{locale:'id_ID'}};
let denied=false;const revisions=[];let created=0;
globalThis.fetch=async (uri,init={})=>{
 const url=String(uri);let body=null;try{body=JSON.parse(init.body||'null');}catch{}
 if(url.includes('oauth2'))return Response.json({access_token:'sample-token',expires_in:3600});
 if(url.includes(':batchUpdate')&&body?.requests?.[0]?.addSheet){assert.equal(body.requests[0].addSheet.properties.hidden,true);created++;meta.sheets.push({properties:{title:'_KK_SYNC',sheetId:2}});return Response.json({});}
 if(url.includes('values/')&&String(init.method)==='PUT'){
   if(denied)return Response.json({error:{message:'Permission denied'}},{status:403});
   revisions.push(body.values[1]);return Response.json({updatedCells:12});
 }
 return Response.json(meta);
};
const one=await publishRevision(env,{year:2026,period:'annual',action:'import',count:28});
assert.equal(one.published,true);
assert.equal(created,1);
assert.equal(revisions[0][2],2026);
assert.equal(revisions[0][4],'import');
assert.equal(revisions[0][5],28);
const two=await publishRevision(env,{year:2026,period:'month-10',action:'cell',count:1});
assert.equal(two.published,true);
assert.equal(created,1);
assert.notEqual(one.revision,two.revision);
assert.equal(revisions[1][3],'month-10');
denied=true;
const failure=await publishRevision(env,{year:2026,period:'annual',action:'import'});
assert.equal(failure.published,false,'A committed master write must not be misreported as rolled back just because the marker failed');
assert.equal(failure.code,'REVISION_MARKER_FAILED');
console.log('PASS: revision publishes only after committed write, hides marker sheet, changes on save, avoids duplication, and surfaces post-commit warning.');
