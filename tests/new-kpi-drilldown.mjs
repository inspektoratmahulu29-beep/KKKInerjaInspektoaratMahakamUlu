import assert from 'node:assert/strict';
import {buildIntegratedDetails} from '../src/integratedDetails.js';
const row=(length, entries)=>{const r=Array(length).fill('');for(const [i,v] of Object.entries(entries))r[Number(i)]=v;return r;};
const named='Reviu Laporan Kinerja';
const sheets={
 'Ringkasan Anggaran PKPT Non':{values:[[],[],[],[],row(13,{1:'6.01.02.2.01.0003',2:named,3:1000,4:900,5:300,6:600,7:0.333,8:1,9:125,10:2,11:1})]},
 'TOTAL REKAP PKPT NON 2026':{values:[[],[],[],[],[],[],[],row(9,{0:'SELURUH INSPEKTORAT',1:1,2:125,3:1000,4:900,5:300,6:600,7:1/3,8:'1 sumber tanpa pengulangan'})]},
 'Rincian Anggaran PKPT 2026':{values:[[],[],[],[],row(15,{0:1,1:'Agenda sampel',2:'Irban I',3:named,4:'6.01.02.2.01.0003',8:125})]},
 'PKPT 76 Penugasan 2026':{values:[[],[],[],[],row(24,{0:1,1:'Penugasan terperinci',3:'Irban I',4:'Sudah',7:named,8:'6.01.02.2.01.0003',14:1,15:125})]},
 'Rekap NON PKPT 2026':{values:[[],[],[],[],[],row(17,{0:1,3:'Januari',4:'Tugas A',9:'Reviu Laporan Kinerja',11:'Dalam kota',12:'Lokasi',13:5,14:'LHE',16:'Tercatat'}),row(17,{0:2,3:'Februari',4:'Tugas B',9:'Tidak ada dalam master',16:'Tercatat'})]},
 'Rekonsiliasi DPPA 2026':{values:[[],[],[],[],[],row(9,{0:1,1:named,2:1000,3:900,4:-100,5:300,6:0.333,8:'Selisih'})]}
};
const report=buildIntegratedDetails(sheets,['Ringkasan Anggaran PKPT Non','TOTAL REKAP PKPT NON 2026','Rincian Anggaran PKPT 2026','Rekap NON PKPT 2026','Rekonsiliasi DPPA 2026']);
assert.equal(report.unique.budget,900);assert.equal(report.unique.financial,300);assert.equal(report.agenda.length,1);assert.equal(report.budgetPackages.length,1);assert.equal(report.pkptPackageBudgetTotal,125);assert.equal(report.agenda[0].name,'Penugasan terperinci');
assert.equal(report.nonPkpt.length,2);assert.equal(report.nonPkptMappedCount,1);
assert.equal(report.nonPkpt[0].fundingBudget,900);assert.equal(report.nonPkpt[0].fundingFinancial,300);
assert.equal(report.nonPkpt[1].fundingMapped,undefined,'Unknown or changed funding must NOT inherit another subactivity budget');
assert.equal(report.dppaDifference,-100);assert.equal(report.dppaDifferences.length,1);
assert.equal(report.sheetList.filter(x=>x.available).length,5);
// A user-inserted column does not disrupt original source-column mappings when the importer provides schema anchors.
const original=sheets['Rekap NON PKPT 2026'].values;
const shifted=original.map(r=>[...r.slice(0,4),'KOLOM BARU',...r.slice(4)]);
sheets['Rekap NON PKPT 2026']={values:shifted,schemaColumns:Array.from({length:17},(_,i)=>({original:i,current:i>=4?i+1:i}))};
const moved=buildIntegratedDetails(sheets,[]);assert.equal(moved.nonPkpt[0].activity,'Tugas A');assert.equal(moved.nonPkpt[0].fundingBudget,900);assert.equal(moved.nonPkpt.length,2);
console.log('PASS: new KPI master PKPT/Non-PKPT budgets are not duplicated, non-exact funding is unknown, DPPA delta is preserved, shifted columns still resolve.');
