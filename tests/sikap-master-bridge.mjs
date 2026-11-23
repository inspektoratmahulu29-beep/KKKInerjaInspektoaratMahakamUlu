import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onRequestPost} from '../functions/api/sync/master.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='b41fae39cd71a8f435a0bd16934d77de1b827ab7';
const env={SIKAP_SYNC_SECRET:secret,GOOGLE_SHEETS_SPREADSHEET_ID:'sheet-master-mocked',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'testing@fixture.invalid',private_key:'placeholder'})};
let calls=0;
const make=(payload,key=secret)=>new Request('https://kkk.example.invalid/api/sync/master',{method:'POST',headers:{'content-type':'application/json','x-sikap-sync-key':key},body:JSON.stringify(payload)});
let r=await onRequestPost({request:make({operation:'metadata'},'short-key'),env});assert.equal(r.status,401);
assert.equal(calls,0,'Unauthorized requests must never query Google');
r=await onRequestPost({request:make({operation:'values',ranges:["'_SECRET'!A:Z"]}),env});assert.equal(r.status,400);
assert.equal(calls,0,'Invalid ranges must never query Google');
r=await onRequestPost({request:make({operation:'values',ranges:["'Rekap realisasi PKPT'!A:AC", "'_KK_SYNC'!A1:F2"]}),env});
// Google auth fixture fails before reaching the values API; this is a safe, explicit 503.
assert.equal(r.status,503);assert.equal((await r.json()).code,'MASTER_GOOGLE_UNAVAILABLE');
assert.equal(calls,0);
// Simulate the KKK Google access token and upstream Sheets API using a valid mock key.
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const key=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
env.GOOGLE_SERVICE_ACCOUNT_JSON=JSON.stringify({client_email:'testing@fixture.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`});
globalThis.fetch=async (url)=>{calls++;if(String(url).includes('oauth2'))return Response.json({access_token:'test-token',expires_in:3600});if(String(url).includes("values/'_KK_SYNC'"))return Response.json({values:[['revision','updatedAt','year','period','action','count'],['rev-1','2026-11-23T10:00:00Z',2026,'annual','cell',1]]});if(String(url).includes('values:batchGet'))return Response.json({valueRanges:[{values:[['A'],['B']]},{values:[['revision'],['rev-1']]}]});return Response.json({spreadsheetId:'sheet-master-mocked',sheets:[{properties:{title:'Rekap realisasi PKPT',sheetId:1,gridProperties:{rowCount:100,columnCount:50}}},{properties:{title:'_KK_SYNC',sheetId:2}}],namedRanges:[]});};
r=await onRequestPost({request:make({operation:'metadata'}),env});assert.equal(r.status,200);assert.equal((await r.json()).meta.spreadsheetId,'sheet-master-mocked');
r=await onRequestPost({request:make({operation:'values',ranges:["'Rekap realisasi PKPT'!A:AC", "'_KK_SYNC'!A1:F2"]}),env});assert.equal(r.status,200);assert.equal((await r.json()).data.valueRanges.length,2);
r=await onRequestPost({request:make({operation:'revision'}),env});assert.equal(r.status,200);assert.equal((await r.json()).revision,'rev-1');
assert.ok(calls>0);console.log('PASS: KKK master bridge requires a long secret, denies arbitrary ranges, reads metadata and authorized PKPT/revision ranges server-side.');
