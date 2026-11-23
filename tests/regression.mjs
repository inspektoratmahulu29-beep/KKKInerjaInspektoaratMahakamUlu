import assert from 'node:assert/strict';
import {SEED_WORKBOOK as p} from '../functions/lib/seed.js';
import {calculateMetrics} from '../functions/lib/metrics.js';
import {dimensionRequests,rowsMatrix,normalizeFormulaSeparators,remapFormula,resolveExistingTitle} from '../functions/lib/sheets.js';
let checks=0;const ok=(fn)=>{fn();checks++;};
ok(()=>assert.equal(Object.keys(p.sheets).length,28));
ok(()=>assert.equal(Object.values(p.sheets).reduce((a,s)=>a+Object.keys(s.formulas).length,0),2388));
for(const sheet of Object.values(p.sheets)){const matrix=rowsMatrix(sheet);for(const [a,f] of Object.entries(sheet.formulas)){const [,col,row]=a.match(/([A-Z]+)(\d+)/);const c=[...col].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;ok(()=>assert.equal(matrix[Number(row)-1][c],f));}}
const k=calculateMetrics(p.sheets);
ok(()=>assert.equal(k.totalAnggaran,17643979587));ok(()=>assert.equal(k.realisasiKeuangan,9614349692));ok(()=>assert.ok(Math.abs(k.realisasiFisik-54.49208471565661)<1e-9));ok(()=>assert.equal(k.penugasan,76));ok(()=>assert.equal(k.selesai+k.berjalan+k.belum+k.lainnya,k.penugasan));
// Arbitrary inserted columns before and between business columns must preserve every KPI.
const shifted=structuredClone(p.sheets);for(const s of Object.values(shifted)){const n=s.cols;s.values=s.values.map(r=>{const out=[];for(let c=0;c<n;c++)out[c*2+2]=r[c];return out;});s.schemaColumns=Array.from({length:n},(_,c)=>({original:c,current:c*2+2}));}
ok(()=>assert.deepEqual(calculateMetrics(shifted),k));
ok(()=>assert.equal(resolveExistingTitle(2026,'IKU',['IKU','2026__IKU']),'2026__IKU'));
ok(()=>assert.equal(resolveExistingTitle(2027,'IKU',['IKU']),null));
ok(()=>assert.equal(remapFormula(`=IF(A1="IKU!A1",'IKU'!A1,IKU!B2)`,{IKU:'2027__IKU'}),`=IF(A1="IKU!A1",'2027__IKU'!A1,'2027__IKU'!B2)`));
ok(()=>assert.equal(normalizeFormulaSeparators('=IF(A1="a,b",SUM(A1,A2),"")',';'),'=IF(A1="a,b";SUM(A1;A2);"")'));
ok(()=>assert.equal(normalizeFormulaSeparators('=SUM({1,2;3,4})',';'),'=SUM({1,2;3,4})'));
const prop={sheetId:99,gridProperties:{rowCount:100,columnCount:20}};
ok(()=>assert.equal(dimensionRequests(prop,{index:12,dimension:'ROWS',action:'insert',count:3})[0].insertDimension.range.endIndex,15));
ok(()=>assert.equal(dimensionRequests(prop,{index:0,dimension:'ROWS',action:'insert',copy:'formula'})[1].copyPaste.source.startRowIndex,1));
ok(()=>assert.equal(dimensionRequests(prop,{index:20,dimension:'COLUMNS',action:'insert'})[0].appendDimension.length,1));
ok(()=>assert.equal(dimensionRequests(prop,{index:2,dimension:'ROWS',action:'duplicate'})[1].copyPaste.pasteType,'PASTE_NORMAL'));
ok(()=>assert.throws(()=>dimensionRequests(prop,{index:-1,action:'delete'})));
ok(()=>assert.throws(()=>dimensionRequests(prop,{index:0,action:'delete',count:100})));
// Updated 28-sheet workbook contains cross-sheet formulas, INDIRECT/IFERROR,
// and cached Excel formula values. The old one-sheet arithmetic parser was
// never capable of verifying cross-sheet references; protect formula mapping
// and numerical source authority instead of incorrectly re-evaluating them.
for(const [name,sheet] of Object.entries(p.sheets))for(const [addr,formula] of Object.entries(sheet.formulas)){
  ok(()=>assert.ok(/^=/.test(formula),`${name}!${addr}: malformed formula`));
  ok(()=>assert.ok(!formula.includes('#REF!'),`${name}!${addr}: broken reference`));
}
console.log(JSON.stringify({checks,status:'PASS',sheets:Object.keys(p.sheets).length,formulaCells:Object.values(p.sheets).reduce((n,s)=>n+Object.keys(s.formulas).length,0),kpi:k},null,2));
