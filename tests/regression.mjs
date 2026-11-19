import assert from 'node:assert/strict';
import {SEED_WORKBOOK as p} from '../functions/lib/seed.js';
import {calculateMetrics} from '../functions/lib/metrics.js';
import {dimensionRequests,rowsMatrix,normalizeFormulaSeparators,remapFormula,resolveExistingTitle} from '../functions/lib/sheets.js';
let checks=0;const ok=(fn)=>{fn();checks++;};
ok(()=>assert.equal(Object.keys(p.sheets).length,15));
ok(()=>assert.equal(Object.values(p.sheets).reduce((a,s)=>a+Object.keys(s.formulas).length,0),340));
for(const sheet of Object.values(p.sheets)){const matrix=rowsMatrix(sheet);for(const [a,f] of Object.entries(sheet.formulas)){const [,col,row]=a.match(/([A-Z]+)(\d+)/);const c=[...col].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;ok(()=>assert.equal(matrix[Number(row)-1][c],f));}}
const k=calculateMetrics(p.sheets);
ok(()=>assert.equal(k.totalAnggaran,28172392109));ok(()=>assert.equal(k.realisasiKeuangan,22873934360));ok(()=>assert.ok(Math.abs(k.realisasiFisik-81.19273035637131)<1e-9));ok(()=>assert.equal(k.penugasan,76));ok(()=>assert.equal(k.selesai+k.berjalan+k.belum+k.lainnya,k.penugasan));
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
// Independent formula parser evaluates ALL original formulas against the cached Excel values.
for(const [name,s] of Object.entries(p.sheets)){
 const memo={},active=new Set();
 const val=a=>{a=a.replace(/\$/g,'');if(a in memo)return memo[a];const [,letters,row]=a.match(/([A-Z]+)(\d+)/);const c=[...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
 if(!s.formulas[a])return s.values[Number(row)-1]?.[c]??'';if(active.has(a))throw new Error('Circular '+a);active.add(a);const result=parse(s.formulas[a]);active.delete(a);memo[a]=result;return result;};
 const num=x=>typeof x==='number'?x:x===''?0:Number(x);
 function parse(formula){const tokens=formula.slice(1).match(/\$?[A-Z]+\$?\d+|[A-Z_]+|\d+(?:\.\d+)?|"(?:[^"]|"")*"|[()+\-*/:,=]/g);let i=0;
 function atom(){const t=tokens[i++];if(t==='('){const x=expr(0);assert.equal(tokens[i++],')');return x;}if(t.startsWith('"'))return t.slice(1,-1).replace(/""/g,'"');if(/^\d/.test(t))return Number(t);if(/\d$/.test(t)){if(tokens[i]===':'){i++;const end=tokens[i++];const [,c,r1]=t.match(/(\$?[A-Z]+)\$?(\d+)/),r2=Number(end.match(/\d+/)[0]);return Array.from({length:r2-Number(r1)+1},(_,j)=>val(c+(Number(r1)+j)));}return val(t);}
 assert.equal(tokens[i++],'(');const args=[];if(tokens[i]!==')'){do{args.push(expr(0));if(tokens[i]!==',')break;i++;}while(true);}assert.equal(tokens[i++],')');const numbers=args.flat().filter(x=>typeof x==='number');switch(t){case 'IF':return args[0]?args[1]:args[2];case 'OR':return args.some(Boolean);case 'IFERROR':return typeof args[0]==='number'&&!Number.isFinite(args[0])?args[1]:args[0];case 'SUM':return numbers.reduce((a,b)=>a+b,0);case 'AVERAGE':return numbers.reduce((a,b)=>a+b,0)/numbers.length;case 'SUMPRODUCT':return args[0].reduce((a,x,j)=>a+num(x)*num(args[1][j]),0);default:throw new Error(t);}}
 const prec={'=':1,'+':2,'-':2,'*':3,'/':3};function expr(min){let left=atom();while((prec[tokens[i]]||0)>min){const op=tokens[i++],right=expr(prec[op]);left=op==='='?left===right:op==='+'?num(left)+num(right):op==='-'?num(left)-num(right):op==='*'?num(left)*num(right):num(left)/num(right);}return left;}
 const result=expr(0);assert.equal(i,tokens.length);return result;}
 for(const a of Object.keys(s.formulas)){const [,letters,row]=a.match(/([A-Z]+)(\d+)/);const c=[...letters].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;const expected=s.values[Number(row)-1]?.[c]??'',actual=val(a);ok(()=>{if(typeof expected==='number')assert.ok(Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-10),`${name}!${a}: ${actual} != ${expected}`);else assert.equal(actual,expected,`${name}!${a}`);});}
}
console.log(JSON.stringify({checks,status:'PASS',formulaCells:340,kpi:k},null,2));
