import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createSession} from '../functions/lib/security.js';
import {onRequestGet as getState} from '../functions/api/admin/state.js';
import {onRequestPut as putSheet} from '../functions/api/admin/sheet.js';
import {onRequestGet as getDiagnostics} from '../functions/api/admin/diagnostics.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const admin={ADMIN_USERNAME:'operator',ADMIN_PASSWORD:'test-only',SESSION_SECRET:'local-tests-secret'};
const token=await createSession(admin);
const request=(pathname, method='GET', body)=>new Request(`https://test.invalid${pathname}`,{method,headers:{Cookie:`__Host-kk_session=${encodeURIComponent(token)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const withoutConfig=await getState({request:request('/api/admin/state?year=2026'),env:admin});
assert.equal(withoutConfig.status,503,'No Google config must not return successful seeded data');
assert.equal((await withoutConfig.json()).code,'GOOGLE_CONFIG_MISSING');
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pk=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const env={...admin,DEFAULT_YEAR:'2026',GOOGLE_SHEETS_SPREADSHEET_ID:'test-document',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'probe@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`})};
let writes=0;
globalThis.fetch=async(url,init={})=>{
 const u=String(url);
 if(u.includes('oauth2.googleapis.com'))return Response.json({access_token:'mock-secret',expires_in:3600});
 if(u.includes('drive/v3/files/'))return Response.json({id:'test-document',version:'5',modifiedTime:'2026-01-01T00:00:00Z',capabilities:{canEdit:false}});
 if(u.includes('values:batchUpdate')){writes++;return Response.json({error:{message:'The caller does not have permission'}},{status:403});}
 return Response.json({properties:{locale:'en_US'},namedRanges:[],sheets:[{properties:{sheetId:1,title:'2026__IKU',gridProperties:{rowCount:1000,columnCount:26}}}]});
};
let res=await putSheet({request:request('/api/admin/sheet','PUT',{year:2026,sheet:{name:'IKU',cols:1,values:[[42]],formulas:{}}}),env});
assert.equal(res.status,503);
let result=await res.json();assert.equal(result.code,'GOOGLE_ACCESS_DENIED');
assert.match(result.message,/Editor/);
assert.equal(writes,1,'Do not repeatedly retry forbidden writes');
res=await getDiagnostics({request:request('/api/admin/diagnostics'),env});
assert.equal(res.status,200);
result=await res.json();assert.equal(result.writeAccess,'denied');
assert.equal(result.configured.GOOGLE_SERVICE_ACCOUNT_JSON,true);
assert.ok(!JSON.stringify(result).includes('BEGIN PRIVATE KEY'),'Never return keys in diagnostics');
const anonymous=await getDiagnostics({request:new Request('https://test.invalid/api/admin/diagnostics'),env});
assert.equal(anonymous.status,401,'Diagnostic details require admin login');
// Simulate optional D1 binding with unmigrated revision_state: Google write must STILL succeed.
const blockedDB={prepare(){throw new Error('D1_ERROR: no such table: revision_state')}};
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 const u=String(url);
 if(u.includes('values:batchUpdate') || u.includes('values:batchClear')) return Response.json({totalUpdatedCells:1});
 return realFetch(url,init);
};
res=await putSheet({request:request('/api/admin/sheet','PUT',{year:2026,sheet:{name:'IKU',cols:1,values:[[42]],formulas:{}}}),env:{...env,DB:blockedDB}});
assert.equal(res.status,200,'D1 failure after Sheets success may not return HTTP 503');
assert.equal((await res.json()).ok,true);

console.log('PASS: config 503 does not seed, write permission 403 classified, no retry storm, private diagnostics, D1 failure after Google success remains HTTP 200.');
