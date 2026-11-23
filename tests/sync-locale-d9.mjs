import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { normalizeFormulaSeparators, canonicalizeGoogleFormula, rowsMatrix, rewriteFormulaCells } from '../functions/lib/sheets.js';
import { SEED_WORKBOOK } from '../functions/lib/seed.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const check=(f,expected)=>assert.equal(normalizeFormulaSeparators(f,';'),expected);
check('=41.38/100','=41,38/100');
check('=ROUND(41.38/100,2)','=ROUND(41,38/100;2)');
check('=IF(A1>0,1,0)','=IF(A1>0;1;0)');
check('="Rp41.38"&\'Tahun.2027\'!A1','="Rp41.38"&\'Tahun.2027\'!A1');
assert.equal(canonicalizeGoogleFormula('=ROUND(41,38/100;2)','id_ID'),'=ROUND(41.38/100,2)');
assert.equal(SEED_WORKBOOK.sheets['Validasi Data 2026'].formulas.D9,'=4138/10000');
const rows=rowsMatrix({values:[[null,null,null,0.4138]],formulas:{D1:'=41.38/100'},cols:4},';');
assert.equal(rows[0][3],'=41,38/100');
// Mock authenticating a KKK editor with Google, and assert the 2026 November
// repair modifies November only, never another month's D9 or the annual D9.
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const privateKey=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64');
const env={GOOGLE_SHEETS_SPREADSHEET_ID:'test-sync-locale',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`})};
const writes=[];
globalThis.fetch=async(url,opts={})=>{
  const endpoint=String(url);
  if(endpoint.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'token',expires_in:3600});
  if(endpoint.includes('values:batchUpdate')){writes.push(JSON.parse(opts.body));return Response.json({responses:[{}]});}
  return Response.json({properties:{locale:'id_ID'},sheets:[
    {properties:{sheetId:1,title:'2026__Validasi Data 2026'}},
    {properties:{sheetId:2,title:'2026__M11__Validasi Data 2026'}}
  ]});
};
const result=await rewriteFormulaCells(env,[{canonical:'Validasi Data 2026',cell:'D9',formula:'=4138/10000',year:2026,period:'month-11'}]);
assert.equal(result.updated,1);assert.equal(writes.length,1);
assert.equal(writes[0].data[0].range,"'2026__M11__Validasi Data 2026'!D9");
assert.equal(writes[0].data[0].values[0][0],'=4138/10000');
console.log('PASS: decimal formula locale conversions, preserved text/sheet names, template D9 portable, monthly D9 repair scoped to selected year+period.');
