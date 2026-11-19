import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {normalizePeriod,periodTitle,resolveExistingTitle,remapFormula,writeSheetsBatch,readWorkbook,writeSingleSheet} from '../functions/lib/sheets.js';
for(let m=1;m<=12;m++) assert.equal(periodTitle(2026,'IKU',`month-${String(m).padStart(2,'0')}`),`2026__M${String(m).padStart(2,'0')}__IKU`);
for(let q=1;q<=4;q++)assert.equal(periodTitle(2026,'IKU',`quarter-${q}`),`2026__Q${q}__IKU`);
for(let s=1;s<=2;s++)assert.equal(periodTitle(2026,'IKU',`semester-${s}`),`2026__S${s}__IKU`);
assert.equal(periodTitle(2026,'IKU'),'2026__IKU');
for(const p of ['month-00','month-13','quarter-5','semester-3','foo','M01'])assert.throws(()=>normalizePeriod(p));
const names=['2026__IKU','2026__M01__IKU','2026__M01__Report','2026__Report'];
assert.equal(resolveExistingTitle(2026,'IKU',names,'month-01'),'2026__M01__IKU');
assert.equal(resolveExistingTitle(2026,'IKU',names,'month-02'),null);
assert.equal(resolveExistingTitle(2026,'IKU',names,'annual'),'2026__IKU');
assert.equal(remapFormula("='IKU'!A1+\"IKU! A1\"",{IKU:'2026__M01__IKU'}),"='2026__M01__IKU'!A1+\"IKU! A1\"");
const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pk=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const env={GOOGLE_SHEETS_SPREADSHEET_ID:'period-test',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:'test@example.invalid',private_key:`-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`})};
let nextId=100;
const meta={properties:{locale:'en_US'},namedRanges:[],sheets:[{properties:{sheetId:1,title:'2026__IKU',gridProperties:{rowCount:1000,columnCount:26}}},{properties:{sheetId:2,title:'2026__Report',gridProperties:{rowCount:1000,columnCount:26}}}]};
let calls=[];
globalThis.fetch=async(url,init={})=>{
  const u=String(url);let body=null;try{body=init.body?JSON.parse(init.body):null;}catch{};calls.push({url:u,body});
  if(u.includes('oauth2'))return Response.json({access_token:'mock',expires_in:3600});
  if(u.includes('includeGridData'))return Response.json({sheets:[]});
  if(u.includes('/values:batchGet')){
    const raw=u.includes('valueRenderOption=FORMULA');
    return Response.json({valueRanges:[{values:[[raw?"='2026__M01__IKU'!A1":42]]},{values:[[raw?"='2026__M01__IKU'!A1":42]]}]});
  }
  if(u.includes(':batchUpdate') && body?.requests){
    for(const x of body.requests){
      if(x.addSheet){const p=x.addSheet.properties;meta.sheets.push({properties:{sheetId:nextId++,title:p.title,gridProperties:p.gridProperties}});}
      if(x.addNamedRange){meta.namedRanges.push({...x.addNamedRange.namedRange,namedRangeId:'nr'+meta.namedRanges.length});}
    }
  }
  return Response.json(u.includes(':batchUpdate')?{}:meta);
};
const source={IKU:{name:'IKU',cols:30,grid:{rowCount:1000,columnCount:30},values:[[99]],formulas:{}},Report:{name:'Report',cols:2,values:[[123]],formulas:{A1:"='IKU'!A1"}}};
const result=await writeSheetsBatch(env,source,2026,{period:'month-01'});
assert.equal(result.created,2);
assert.deepEqual(meta.sheets.slice(-2).map(x=>x.properties.title),['2026__M01__IKU','2026__M01__Report']);
assert.equal(meta.sheets.at(-2).properties.gridProperties.columnCount,30,'New period must support >26 columns');
const values=calls.find(x=>x.url.includes('/values:batchUpdate'))?.body?.data||[];
assert.equal(values.at(-1).values[0][0],"='2026__M01__IKU'!A1",'Formula must point to same-period sheet');
assert.ok(values.every(x=>x.range.includes('2026__M01__')),'Do not overwrite annual sheets');
const wb=await readWorkbook(env,['IKU','Report'],2026,'month-01');
assert.equal(wb.sheets.IKU.googleTitle,'2026__M01__IKU');
assert.equal(wb.sheets.Report.formulas.A1,"='IKU'!A1",'Roundtrip must use canonical formula title');
const snapRanges=calls.filter(x=>x.url.includes('includeGridData')).at(-1).url;
assert.ok(snapRanges.includes('A1')&&!snapRanges.includes('1000'),'Format preview must be bounded for performance');
const annualCount=calls.filter(x=>x.body?.data?.some(r=>r.range?.includes('2026__Report')&&!r.range.includes('__M01__'))).length;
assert.equal(annualCount,0,'Monthly write must never touch original annual data');
console.log('PASS: 19 periods + annual, invalid selection, 30-column creation, period-isolated Google writes, crosssheet formula remap, formula readback, limited formatting fetch.');
