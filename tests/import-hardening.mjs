import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {translateSharedFormula,expandExcelSharedFormulas} from '../src/excelSharedFormulas.js';
import {writeSheetsBatch,assertValidImportSheet,readWorkbook} from '../functions/lib/sheets.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

// Cell coordinates shift correctly, while absolute rows/columns, literal text,
// quoted sheet names and function names such as LOG10 remain unchanged.
assert.equal(translateSharedFormula('IFERROR(SUM(A1,$B2,C$3,$D$4),0)','E10','F11'),'IFERROR(SUM(B2,$B3,D$3,$D$4),0)');
assert.equal(translateSharedFormula('IF(\'Rencana 1\'!A1="A1",LOG10(B2),0)','C5','D7'),'IF(\'Rencana 1\'!B3="A1",LOG10(C4),0)');
assert.deepEqual(await expandExcelSharedFormulas(new Uint8Array([0xD0,0xCF,0x11,0xE0]).buffer,{}),{expanded:0,unresolved:[]});
assert.throws(()=>assertValidImportSheet({name:'Realisasi Fisik & Keu',values:[['#REF!']],formulas:{}}),/#REF!/);
assert.throws(()=>assertValidImportSheet({name:'Realisasi Fisik & Keu',values:[[1]],formulas:{A1:'=#REF!'}}),/#REF!/);

const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pk=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const env={GOOGLE_SHEETS_SPREADSHEET_ID:'import-hardening-mock',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'example@test.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`})};
const originalTitle='2026__Realisasi Fisik & Keu';
const newTitle='2026__Tambahan Baru';
const state={properties:{locale:'en_US'},sheets:[{properties:{title:originalTitle,sheetId:1,gridProperties:{rowCount:1000,columnCount:26}},merges:[{startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:2}]}],namedRanges:[{namedRangeId:'view1',name:'KKVIEW_2026_1',range:{sheetId:1,startRowIndex:0,endRowIndex:2,startColumnIndex:0,endColumnIndex:3}}]};
for(let i=0;i<3;i++)state.namedRanges.push({namedRangeId:`col${i}`,name:`KKCOL_2026_1_${i}`,range:{sheetId:1,startRowIndex:0,endRowIndex:1,startColumnIndex:i,endColumnIndex:i+1}});
const calls=[];
globalThis.fetch=async(u,i={})=>{
  const url=String(u);
  if(url.includes('oauth2'))return Response.json({access_token:'mock',expires_in:3600});
  const body=i.body?JSON.parse(i.body):null;
  calls.push({url,body});
  if(url.includes(':batchUpdate')&&body?.requests){
    for(const r of body.requests)if(r.addSheet){state.sheets.push({properties:{title:r.addSheet.properties.title,sheetId:2,gridProperties:r.addSheet.properties.gridProperties}});}
    return Response.json({});
  }
  if(url.includes('/values:batchGet')){
    const ranges=new URL(url).searchParams.getAll('ranges');
    return Response.json({valueRanges:ranges.map(r=>({range:r,values:[['kode','output','nilai'],['001','Data',14]]}))});
  }
  if(url.includes('includeGridData'))return Response.json({sheets:[]});
  if(url.includes(':batchClear')||url.includes('/values:batchUpdate'))return Response.json({});
  return Response.json(state);
};
const entries={
 'Realisasi Fisik & Keu':{name:'Realisasi Fisik & Keu',cols:3,values:[['Kode','Fisik','Keuangan'],['001',50,25]],formulas:{C2:'=B2/2'}},
 'Tambahan Baru':{name:'Tambahan Baru',cols:2,values:[['Sumber','Nilai'],['Dari Realisasi',25]],formulas:{B2:"='Realisasi Fisik & Keu'!C2"}}
};
const result=await writeSheetsBatch(env,entries,2026,{import:true,preserveFormat:true});
assert.equal(result.updated,2);assert.equal(result.created,1);assert.equal(result.formulaCells,2);
const values=calls.filter(c=>c.url.includes('/values:batchUpdate'));
const raw=values.findIndex(c=>c.body.valueInputOption==='RAW');
const formula=values.findIndex(c=>c.body.valueInputOption==='USER_ENTERED');
assert.ok(raw>=0&&formula>raw,'Write RAW input before formulas, even across sheets');
assert.equal(values[raw].body.data[0].values[1][0],'001','Preserve leading zeros in text codes');
assert.ok(values[formula].body.data.some(x=>x.range.includes('Tambahan Baru')&&x.values[0][0]=="='2026__Realisasi Fisik & Keu'!C2"));
assert.ok(!calls.some(c=>c.body?.requests?.some(r=>r.unmergeCells)),'Never unmerge existing sheet during refresh');
assert.ok(!calls.some(c=>c.body?.requests?.some(r=>r.deleteNamedRange)),'Keep valid existing column mapping');
const fresh=await readWorkbook(env,['Realisasi Fisik & Keu'],2026);
assert.ok(fresh.sheets['Tambahan Baru'],'Newly added Excel tab must be visible after reload');
console.log('PASS: shared-formula address translation, legacy XLS bypass, #REF! refusal, RAW-first formula-second import, source text precision, existing-format preservation, new sheet discoverability.');
