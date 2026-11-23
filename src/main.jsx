import { remapFormula } from '../functions/lib/sheets.js';
import { expandExcelSharedFormulas } from './excelSharedFormulas.js';
import { SpreadsheetEditor } from './SpreadsheetEditor.jsx';
import IntegratedExplorer from './IntegratedExplorer.jsx';
import MasterInsights from './MasterInsights.jsx';
import {buildIntegratedDetails} from './integratedDetails.js';
import { calculateMetrics, capaianMeta, capaianMetric } from '../functions/lib/metrics.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';
import { adminMe, adminLogin, adminLogout, fetchState, saveState, saveSheet, saveCells, importSheet, importSheets, fetchRevision, pushAudit, changeStructure, fetchTemplate, addOfficialMonev } from './adminApi.js';
import { OFFICIAL_REPORT_2026,compatibleSheetNames,isOfficialReportName,officialReportName } from '../functions/lib/report-schema.js';
import { MONEV_REPORT_SHEET, ensureMonevReport, prepareBlankMonevReport, isMonevReportComputedCell, MonevRenaksiPage } from './monevReport.jsx';

const STORAGE_KEY = 'mahulu-dashboard-realisasi-v8';
const PERIOD_OPTIONS = [
  {value:'annual',label:'Tahunan'},
  ...Array.from({length:12},(_,i)=>({value:`month-${String(i+1).padStart(2,'0')}`,label:`Bulanan · ${new Intl.DateTimeFormat('id-ID',{month:'long'}).format(new Date(2026,i,1))}`})),
  ...Array.from({length:4},(_,i)=>({value:`quarter-${i+1}`,label:`Triwulan ${i+1}`})),
  ...Array.from({length:2},(_,i)=>({value:`semester-${i+1}`,label:`Semester ${i+1}`}))
];
const queryPeriod = new URLSearchParams(window.location.search).get('period')||'annual';
const INITIAL_PERIOD=PERIOD_OPTIONS.some(p=>p.value===queryPeriod)?queryPeriod:'annual';
// Same 14 core sources consumed by the public SIKAP dashboard.
const REQUIRED_DASHBOARD_SHEETS=['IKU','Rencana Aksi','Capaian Sasaran Strategis','Capaian Sasaran Program','Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)','Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)','Monev Renaksi IKU','Monev Program','Monev output Subkegiatan Utama','Monev Subkegiatan Penunjang','Rekap realisasi PKPT','Realisasi Fisik & Keu'];

// Tiga belas sheet pelengkap Excel terbaru; laporan resmi bersifat dinamis menurut tahun.
const ADDITIONAL_DASHBOARD_SHEETS = ["Rekap NON PKPT 2026", "ST Belum Klasifikasi", "Rekonsiliasi DPPA 2026", "Validasi Data 2026", "Dasar Indikator DPA 2026", "Jadwal PKPT dan Bukti 2026", "Register Bukti Capaian 2026", "Audit Isian 12 Sheet 2026", "Capaian Detail Penunjang 2026", "ST Perlu Pemetaan Okt 2026", "Ringkasan Anggaran PKPT Non", "Rincian Anggaran PKPT 2026", "TOTAL REKAP PKPT NON 2026"];
const expectedSourceSheets=year=>[...REQUIRED_DASHBOARD_SHEETS,...ADDITIONAL_DASHBOARD_SHEETS,officialReportName(year)];
const IMPORT_AUDIT_KEY = `${STORAGE_KEY}:importAudit`;
const IMPORT_BACKUP_KEY = `${STORAGE_KEY}:importBackup`;
const IMPORT_TEMPLATE_KEY = `${STORAGE_KEY}:excelTemplate`;
const IDB_DB = 'mahulu-dashboard-realisasi-v81';
const IDB_STORE = 'store';
const MAX_IMPORT_AUDIT = 80;
let auditCache = [];
let importBackupCache = null;
let templateCache = null;
function openAppDB(){ return new Promise((resolve,reject)=>{ if(!('indexedDB' in window)) return reject(new Error('IndexedDB tidak tersedia di browser ini')); const req=indexedDB.open(IDB_DB,1); req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); }; req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('Gagal membuka IndexedDB')); }); }
async function idbGet(key){ const db=await openAppDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction(IDB_STORE,'readonly'); const req=tx.objectStore(IDB_STORE).get(key); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
async function idbSet(key,value){ const db=await openAppDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put(value,key); tx.oncomplete=()=>resolve(true); tx.onerror=()=>reject(tx.error||new Error('Gagal menyimpan database lokal')); }); }
async function idbDel(key){ const db=await openAppDB(); return new Promise((resolve,reject)=>{ const tx=db.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete=()=>resolve(true); tx.onerror=()=>reject(tx.error); }); }
async function loadStoredDatabase(){ const modern=await idbGet('database').catch(()=>null); if(modern?.years) return modern; try{ const raw=localStorage.getItem(STORAGE_KEY); if(raw){ const parsed=JSON.parse(raw); if(parsed?.years){ await idbSet('database',parsed); try{localStorage.removeItem(STORAGE_KEY);}catch{} return parsed; } } }catch{} return null; }
function countMeaningfulRows(sheet){ const values=sheet?.values||[]; return values.filter(r=>(r||[]).some(v=>cleanText(v))).length; }
function countMeaningfulCells(sheet){ let n=0; for(const r of (sheet?.values||[])) for(const v of (r||[])) if(cleanText(v)) n++; return n; }
function repairStoredDatabaseFromSource(saved, source, baseYear){
  if(!saved?.years || !source?.sheets) return {changed:false, database:saved};
  const years={...saved.years};
  let changed=false;
  const storedYear=years[baseYear];
  if(!storedYear?.sheets) { years[baseYear]=clone(source); changed=true; }
  else {
    const repaired=clone(storedYear);
    repaired.sheets={...(repaired.sheets||{})};
    for(const [name,baseSheet] of Object.entries(source.sheets||{})){
      const current=repaired.sheets[name];
      const baseCells=countMeaningfulCells(baseSheet);
      const currentCells=countMeaningfulCells(current);
      const currentRows=countMeaningfulRows(current);
      // Only auto-heal clearly empty/missing stored sheets; never overwrite non-empty operator data.
      if(!current || (currentRows===0 && baseCells>0) || (currentCells===0 && baseCells>0)){
        repaired.sheets[name]=clone(baseSheet);
        changed=true;
      }
    }
    repaired.meta={...(repaired.meta||{}),year:Number(baseYear),sheetCount:Object.keys(repaired.sheets||{}).length};
    years[baseYear]=repaired;
  }
  return {changed,database:{...saved,years,updatedAt:new Date().toISOString()}};
}
async function saveStoredDatabase(value){ await idbSet('database',value); try{localStorage.setItem(`${STORAGE_KEY}:activeYear`,String(value?.activeYear||''));}catch{} }
async function loadActiveYear(){ try{ const raw=localStorage.getItem(`${STORAGE_KEY}:activeYear`); return raw?Number(raw):null; }catch{return null} }
async function clearLegacyStorage(){ try{localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(IMPORT_AUDIT_KEY);localStorage.removeItem(IMPORT_BACKUP_KEY);localStorage.removeItem(IMPORT_TEMPLATE_KEY);}catch{} }
const ORG = 'INSPEKTORAT DAERAH KABUPATEN MAHAKAM ULU';
const money = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const moneyParts = (n) => { const formatted = money(n).replace(/\u00a0/g, ' '); const m = formatted.match(/^Rp\s*(.*)$/); return { symbol: m ? 'Rp' : '', amount: m ? m[1] : formatted }; };
const number = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const pct = (n) => `${(Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const cell = (v) => v === null || v === undefined ? '' : String(v);
const cleanText = (v) => cell(v).replace(/\s+/g, ' ').trim();
const parseNumber = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = cleanText(v).replace(/\s/g, '');
  if (!s) return null;
  if (/^-?\d+[,.]?\d*$/.test(s)) {
    if (s.includes('.') && s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
    if ((s.match(/\./g) || []).length > 1) return Number(s.replace(/\./g, ''));
    return Number(s.replace(',', '.'));
  }
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
};
const colName = (index) => { let s = ''; let n = index + 1; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const isError = (v) => typeof v === 'string' && /^\s*#(ERROR!|REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)(?:\s*)$/i.test(v);
const isNum = (v) => parseNumber(v) !== null && !isError(v);

const sheetMeta = {
  'IKU': { group: 'Perencanaan Strategis', role: 'Indikator Kinerja Utama', dataStart: 7 },
  'Rencana Aksi': { group: 'Perencanaan Strategis', role: 'Rencana aksi pencapaian target', dataStart: 6 },
  'Capaian Sasaran Strategis': { group: 'Capaian Kinerja', role: 'Capaian sasaran strategis', dataStart: 3, target: 4, real: 5, achieve: 6, budget: 8, budgetReal: 9, budgetPct: 10 },
  'Capaian Sasaran Program': { group: 'Capaian Kinerja', role: 'Capaian sasaran program', dataStart: 3, target: 5, real: 6, achieve: 7, budget: 9, budgetReal: 10, budgetPct: 11 },
  'Capaian Sasaran Kegiatan Utama': { group: 'Capaian Kinerja', role: 'Capaian kegiatan utama', dataStart: 3, target: 6, real: 7, achieve: 8, budget: 10, budgetReal: 11, budgetPct: 12 },
  'Capaian Sasaran Kegiatan(Penun)': { group: 'Capaian Kinerja', role: 'Capaian kegiatan penunjang', dataStart: 3, target: 7, real: 8, achieve: 9, budget: 11, budgetReal: 12, budgetPct: 13 },
  'Capaian Sasaran SUBKegiatan(U)': { group: 'Capaian Kinerja', role: 'Capaian subkegiatan utama', dataStart: 3, target: 7, real: 8, achieve: 9, budget: 11, budgetReal: 12, budgetPct: 13 },
  'Capaian Sasaran SUBKegiatan (P)': { group: 'Capaian Kinerja', role: 'Capaian subkegiatan penunjang', dataStart: 3, target: 8, real: 9, achieve: 10, budget: 12, budgetReal: 13, budgetPct: 14 },
  'Monev Renaksi IKU': { group: 'Monitoring & Evaluasi', role: 'Monev pencapaian IKU', dataStart: 8, targetCols: [5, 6, 7, 8], realCols: [9, 10, 11, 12] },
  'Monev Program': { group: 'Monitoring & Evaluasi', role: 'Monev rencana aksi program', dataStart: 8, targetCols: [7, 8, 9, 10], realCols: [11, 12, 13, 14], budget: 18, budgetReal: 19 },
  'Monev output Subkegiatan Utama': { group: 'Monitoring & Evaluasi', role: 'Monev output subkegiatan utama', dataStart: 6, activityCol: 7, outputCol: 11 },
  'Monev Subkegiatan Penunjang': { group: 'Monitoring & Evaluasi', role: 'Monev output subkegiatan penunjang', dataStart: 6, activityCol: 7, outputCol: 10 },
  'Rekap realisasi PKPT': { group: 'Penugasan', role: 'Rekap penugasan pembinaan dan pengawasan', dataStart: 6, statusCol: 4, activityCol: 3 },
  'Realisasi Fisik & Keu': { group: 'Realisasi', role: 'Realisasi fisik dan keuangan', dataStart: 9, budget: 2, physical: 4, financial: 6, financialPct: 7, weightedPhysical: 5, weightedFinancial: 8, remaining: 9, weight: 3 },
  [OFFICIAL_REPORT_2026]: { group: 'Monitoring & Evaluasi', role: 'Laporan Monev Renaksi resmi: sasaran, TW1–TW4, pagu, realisasi, catatan, tindak lanjut, dan penanggung jawab (Excel 2026)', dataStart: 8, budget: 19, budgetReal: 20 },
  [MONEV_REPORT_SHEET]: { group: 'Monitoring & Evaluasi', role: 'Analitik Monev otomatis (terpisah dari laporan resmi)', dataStart: 0 },
  'Rekap NON PKPT 2026': {group:'Penugasan & Surat Tugas',role:'Rekap pelaksanaan Non-PKPT berikut surat tugas, lokasi, PPTK, dan output',dataStart:5},
  'ST Belum Klasifikasi': {group:'Penugasan & Surat Tugas',role:'Daftar Surat Tugas yang klasifikasi PKPT/Non-PKPT belum dibuktikan',dataStart:5},
  'Rekonsiliasi DPPA 2026': {group:'Rekonsiliasi Anggaran',role:'Rekonsiliasi pagu DPA terhadap laporan realisasi anggaran',dataStart:5},
  'Validasi Data 2026': {group:'Validasi & Eviden',role:'Validasi jumlah, keuangan, fisik, dan keterlacakan sumber',dataStart:5},
  'Dasar Indikator DPA 2026': {group:'Target DPA',role:'Indikator keluaran resmi DPPA per kode subkegiatan',dataStart:4},
  'Jadwal PKPT dan Bukti 2026': {group:'PKPT & Pengawasan',role:'Jadwal rencana pengawasan serta status pembuktian dokumen',dataStart:4},
  'Register Bukti Capaian 2026': {group:'Validasi & Eviden',role:'Register dokumen bukti, status dan dampak pengukuran',dataStart:4},
  'Audit Isian 12 Sheet 2026': {group:'Validasi & Eviden',role:'Audit sumber dan kesesuaian isian 12 sheet inti',dataStart:3},
  'Capaian Detail Penunjang 2026': {group:'Capaian Kinerja',role:'18 subkegiatan penunjang: target, output sah, anggaran dan ST',dataStart:4},
  'ST Perlu Pemetaan Okt 2026': {group:'Penugasan & Surat Tugas',role:'Surat Tugas belum dapat dipetakan terhadap kode subkegiatan',dataStart:4},
  'Ringkasan Anggaran PKPT Non': {group:'Rekonsiliasi Anggaran',role:'Pagu dan realisasi setiap subkegiatan tanpa penghitungan ganda',dataStart:4},
  'Rincian Anggaran PKPT 2026': {group:'PKPT & Pengawasan',role:'56 paket rencana biaya PKPT yang dapat dipakai bersama beberapa penugasan',dataStart:4},
  'TOTAL REKAP PKPT NON 2026': {group:'Rekonsiliasi Anggaran',role:'Rekap pagu, realisasi, dan pembiayaan PKPT–Non-PKPT yang beririsan',dataStart:7}
};


const knownSheetRanges = {
  "Rekap NON PKPT 2026":'A1:AD92',
  "ST Belum Klasifikasi":'A1:M48',
  "Rekonsiliasi DPPA 2026":'A1:J36',
  "Validasi Data 2026":'A1:P24',
  "Dasar Indikator DPA 2026":'A1:P34',
  "Jadwal PKPT dan Bukti 2026":'A1:Q61',
  "Register Bukti Capaian 2026":'A1:J10',
  "Audit Isian 12 Sheet 2026":'A1:G18',
  "Capaian Detail Penunjang 2026":'A1:P23',
  "ST Perlu Pemetaan Okt 2026":'A1:G22',
  "Ringkasan Anggaran PKPT Non":'A1:M36',
  "Rincian Anggaran PKPT 2026":'A1:P62',
  "TOTAL REKAP PKPT NON 2026":'A1:I36',
  'IKU':'A1:Q18','Rencana Aksi':'A1:M37','Capaian Sasaran Strategis':'A1:K16','Capaian Sasaran Program':'A1:L13','Capaian Sasaran Kegiatan Utama':'A1:M8','Capaian Sasaran Kegiatan(Penun)':'A1:N12','Capaian Sasaran SUBKegiatan(U)':'A1:N17','Capaian Sasaran SUBKegiatan (P)':'A1:O23','Monev Renaksi IKU':'A1:R34','Monev Program':'A1:X36','Monev output Subkegiatan Utama':'A1:N60','Monev Subkegiatan Penunjang':'A1:M31','Rekap realisasi PKPT':'A1:AW212','Realisasi Fisik & Keu':'A1:K64',[OFFICIAL_REPORT_2026]:'A1:X22'
};
const formulaSpecs = {
  'IKU': { inputs: ['A:L'], computed: [], note: 'Indikator kinerja utama dan target tahunan merupakan input sumber.' },
  'Rencana Aksi': { inputs: ['A:M'], computed: [], note: 'Target/realiasi triwulanan diisi sebagai input monitoring.' },
  'Capaian Sasaran Strategis': { inputs: ['E:F','I:J'], computed: ['G','K'], note: 'G = F ÷ E (displayed as %); K = J ÷ I (displayed as %).' },
  'Capaian Sasaran Program': { inputs: ['F:G','J:K'], computed: ['H','L'], note: 'H = G ÷ F dan L = K ÷ J (ditampilkan sebagai %); kolom J/K mengikuti referensi keuangan sumber.' },
  'Capaian Sasaran Kegiatan Utama': { inputs: ['G:H','K:L'], computed: ['I','M'], note: 'I = H ÷ G (displayed as %); M = L ÷ K (displayed as %).' },
  'Capaian Sasaran Kegiatan(Penun)': { inputs: ['H:I','L:M'], computed: ['J','N'], note: 'J = I ÷ H (displayed as %); N = M ÷ L (displayed as %).' },
  'Capaian Sasaran SUBKegiatan(U)': { inputs: ['H:I','L:M'], computed: ['J','N'], note: 'J = I ÷ H (displayed as %); N = M ÷ L (displayed as %).' },
  'Capaian Sasaran SUBKegiatan (P)': { inputs: ['I:J','M:N'], computed: ['K','O'], note: 'K = J ÷ I (displayed as %); O = N ÷ M (displayed as %).' },
  'Monev Renaksi IKU': { inputs: ['F:I','J:M'], computed: ['Virtual % per TW'], note: 'Capaian triwulan = realisasi TW ÷ target TW × 100. Tidak menimpa input.' },
  'Monev Program': { inputs: ['H:K','L:O','R:S'], computed: ['Virtual % per TW','% Realisasi Anggaran'], note: 'Capaian TW dan % anggaran dihitung untuk monitoring tanpa menimpa input.' },
  'Monev output Subkegiatan Utama': { inputs: ['H','J','K','L','M','N'], computed: ['Virtual output count'], note: 'Aktivitas, pelaksana, dasar penugasan, jumlah output, kendala, dan solusi merupakan input; jumlah output dipakai otomatis untuk KPI.' },
  'Monev Subkegiatan Penunjang': { inputs: ['H','I','J','K','L','M'], computed: ['Virtual output count'], note: 'Aktivitas, pengampu, PPTK, jumlah output, kendala, dan solusi merupakan input; jumlah output dipakai otomatis untuk KPI.' },
  'Rekap realisasi PKPT': { inputs: ['D:E','J:L','Y','AL:AQ','AT:AU'], computed: ['AR:AS','Virtual % penyelesaian'], note: 'Rekap 76 penugasan: AB:AK pemetaan paket; Y adalah SPJ penugasan; AL:AQ input identitas dan bukti SPJ; AR:AS status/nilai terverifikasi otomatis.' },
  'Realisasi Fisik & Keu': { inputs: ['C','K'], computed: ['D','E','F','H','I','J'], note: 'C anggaran dan K permasalahan dapat diedit. E realisasi fisik dihitung otomatis dari H sesuai rumus template (I/D x 100 secara aljabar = H). G realisasi keuangan adalah nilai sumber/hasil import pada detail; G pada baris program dan total dijumlahkan otomatis. D/F/H/I/J dihitung otomatis.' },
  [OFFICIAL_REPORT_2026]: { inputs: ['F:M','O:X'], computed: [], note: 'Sheet laporan resmi sumber Excel 2026, tanpa rumus tambahan. Kolom U (realisasi) kosong dalam file sumber; isi aktual ketika tersedia. Jangan samakan data kosong dengan nol.' },
  [MONEV_REPORT_SHEET]: { inputs: ['C:F pada tabel bulanan'], computed: ['KPI per TW','Serapan bulanan','Rekap TW'], note: 'KPI per TW diselaraskan dari Monev Renaksi IKU. Target/realisasi fisik dan keuangan diinput per bulan; serapan dan rekap TW dihitung otomatis.' }
};

function addr(row, col) { return `${colName(col)}${row + 1}`; }
function putFormula(sheet, rowIndex, colIndex, formula, value) {
  const s = sheet; if (!s.formulas) s.formulas = {};
  const a = addr(rowIndex, colIndex); s.formulas[a] = formula;
  s.values[rowIndex][colIndex] = value ?? '';
}
function clampPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }
function isExternalFormula(formula) { return /\[[^\]]+\]|#REF!|#NAME\?/i.test(String(formula || '')); }

function recalculateCapaian(s, meta) {
  for (let ri = meta.dataStart; ri < s.values.length; ri++) {
    const r = s.values[ri] || [];
    const t = parseNumber(r[meta.target]), real = parseNumber(r[meta.real]);
    const b = parseNumber(r[meta.budget]), br = parseNumber(r[meta.budgetReal]);
    if (meta.achieve !== undefined) {
      const v = t !== null && real !== null && t !== 0 ? +(real / t).toFixed(6) : '';
      putFormula(s, ri, meta.achieve, `=IF(OR(${colName(meta.target)}${ri+1}="",${colName(meta.real)}${ri+1}="",${colName(meta.target)}${ri+1}=0),"",${colName(meta.real)}${ri+1}/${colName(meta.target)}${ri+1})`, v);
    }
    if (meta.budgetPct !== undefined) {
      const v = b !== null && br !== null && b !== 0 ? +(br / b).toFixed(6) : '';
      putFormula(s, ri, meta.budgetPct, `=IF(OR(${colName(meta.budget)}${ri+1}="",${colName(meta.budgetReal)}${ri+1}="",${colName(meta.budget)}${ri+1}=0),"",${colName(meta.budgetReal)}${ri+1}/${colName(meta.budget)}${ri+1})`, v);
    }
  }
}


function isProgramHeaderValue(v) {
  return cleanText(v).toUpperCase().startsWith('PROGRAM ');
}
function findRealisasiStructure(values) {
  const rows = values || [];
  let officeRow = rows.findIndex(r => cleanText(r?.[0]).toUpperCase() === 'I' && cleanText(r?.[1]).toUpperCase().includes('INSPEKTORAT'));
  if (officeRow < 0) officeRow = Math.min(9, Math.max(0, rows.length - 1));
  let totalRow = rows.findIndex(r => cleanText(r?.[0]).toUpperCase() === 'JUMLAH BELANJA');
  const end = totalRow >= 0 ? totalRow : rows.length;
  const programRows = [];
  for (let i = officeRow + 1; i < end; i++) {
    const a = cleanText(rows[i]?.[0]);
    const b = cleanText(rows[i]?.[1]);
    if (/^\d+$/.test(a) && isProgramHeaderValue(b)) programRows.push(i + 1);
  }
  return { officeRow: officeRow + 1, totalRow: totalRow + 1, programRows };
}
function getRealisasiTotals(values) {
  const rows = values || [];
  const { officeRow, totalRow, programRows } = findRealisasiStructure(rows);
  const top = [];
  for (let i = 0; i < programRows.length; i++) {
    const sr = programRows[i];
    const next = programRows[i + 1] || (totalRow > 0 ? totalRow : rows.length + 1);
    const summary = rows[sr - 1] || [];
    let budget = parseNumber(summary[2]);
    let fin = parseNumber(summary[6]);
    if (budget === null || fin === null) {
      const detailRows = [];
      for (let rr = sr + 1; rr < next; rr++) {
        const r = rows[rr - 1] || [];
        if (cleanText(r[1]) === '') continue;
        if (parseNumber(r[2]) !== null || parseNumber(r[6]) !== null) detailRows.push(r);
      }
      if (budget === null) budget = detailRows.reduce((a,r) => a + (parseNumber(r[2]) || 0), 0);
      if (fin === null) fin = detailRows.reduce((a,r) => a + (parseNumber(r[6]) || 0), 0);
    }
    top.push({ summary: sr, next, budget: budget ?? 0, fin: fin ?? 0 });
  }
  const office = rows[officeRow - 1] || [];
  const officialTotal = parseNumber(office[2]);
  const officialFin = parseNumber(office[6]);
  const fallbackBudget = top.reduce((a,g) => a + (g.budget || 0), 0);
  const fallbackFin = top.reduce((a,g) => a + (g.fin || 0), 0);
  const budgetTotal = officialTotal !== null ? officialTotal : fallbackBudget;
  const financialTotal = officialFin !== null ? officialFin : fallbackFin;
  const officialPhysical = parseNumber(office[4]);
  const derivedPhysical = (() => {
    // KPI fisik harus bersumber dari detail yang benar-benar terisi. Jangan
    // percaya nilai E10 lama jika formula kantor pernah tersimpan sebagai 0
    // atau error setelah import/refresh. Pada template ini E = I/D*100 dan
    // I = H*D/100, sehingga E secara aljabar sama dengan H. H menjadi fallback
    // yang stabil ketika hasil E belum ter-render oleh Google Sheets.
    const items = [];
    for (const g of top) {
      for (let rr = g.summary + 1; rr < g.next; rr++) {
        const r = rows[rr - 1] || [];
        if (cleanText(r[1]) === '') continue;
        const b = parseNumber(r[2]);
        const p = parseNumber(r[4]) ?? parseNumber(r[7]);
        if (b !== null && b > 0 && p !== null && Number.isFinite(p)) items.push({ b, p });
      }
    }
    // Fallback level program bila detail fisik benar-benar belum tersedia.
    if (!items.length) {
      for (const g of top) {
        const r = rows[g.summary - 1] || [];
        const b = parseNumber(r[2]);
        const p = parseNumber(r[4]) ?? parseNumber(r[7]);
        if (b !== null && b > 0 && p !== null && Number.isFinite(p)) items.push({ b, p });
      }
    }
    return items.length ? items.reduce((a,x) => a + x.b*x.p, 0) / items.reduce((a,x) => a + x.b, 0) : null;
  })();
  return {
    officeRow, totalRow, programRows, top,
    budgetTotal, financialTotal,
    financialRate: budgetTotal ? financialTotal / budgetTotal * 100 : 0,
    // Jangan memilih 0 sebagai nilai resmi bila masih ada data fisik valid.
    // Ini yang mencegah KPI kembali ke 0 sesudah refresh/re-login.
    physicalRate: derivedPhysical !== null ? derivedPhysical : (officialPhysical !== null ? officialPhysical : 0),
    officialPhysical
  };
}

function recalculateRealisasi(s) {
  const rows = s.values || [];
  // E = REALISASI FISIK is automatic in this workbook.
  // The template expresses E as I/D*100, which algebraically equals H.
  // We store the equivalent non-circular formula E = H so the calculation stays automatic.
  const info = getRealisasiTotals(rows);
  const officeRow = info.officeRow;
  const totalRow = info.totalRow;
  const top = info.top;
  const totalBudget = info.budgetTotal;
  const totalFin = info.financialTotal;

  // Fill only missing top-level program amounts from their child rows.
  for (const g of top) {
    const src = rows[g.summary - 1] || [];
    if (parseNumber(src[2]) === null) {
      putFormula(s, g.summary - 1, 2, `=SUM(C${g.summary + 1}:C${g.next - 1})`, g.budget || '');
    }
    if (parseNumber(src[6]) === null) {
      putFormula(s, g.summary - 1, 6, `=SUM(G${g.summary + 1}:G${g.next - 1})`, g.fin || '');
    }
  }

  // Calculate each top-level program and its children.
  for (const g of top) {
    const summaryRow = g.summary;
    const parentBudget = parseNumber((rows[summaryRow - 1] || [])[2]) ?? g.budget;
    const currentPhys = parseNumber((rows[summaryRow - 1] || [])[4]);
    const detailPhysical = [];
    for (let rr = summaryRow + 1; rr < g.next; rr++) {
      const dr = rows[rr - 1] || [];
      const db = parseNumber(dr[2]), dp = parseNumber(dr[4]);
      if (cleanText(dr[1]) !== '' && db !== null && db > 0 && dp !== null) detailPhysical.push({row:rr,b:db,p:dp});
    }
    const phys = currentPhys !== null
      ? currentPhys
      : (detailPhysical.length ? detailPhysical.reduce((a,x)=>a+x.b*x.p,0)/detailPhysical.reduce((a,x)=>a+x.b,0) : null);
    const weight = totalBudget ? parentBudget/totalBudget*100 : null;
    const rate = parentBudget && g.fin !== null ? g.fin/parentBudget*100 : null;
    putFormula(s, summaryRow - 1, 3, `=IF($C$${officeRow}=0,"",C${summaryRow}/$C$${officeRow}*100)`, weight===null?'':+weight.toFixed(6));
    if (currentPhys === null && detailPhysical.length) {
      const physFormula = detailPhysical.length===1
        ? `=E${detailPhysical[0].row}`
        : `=IFERROR((${detailPhysical.map(x=>`C${x.row}*E${x.row}`).join('+')})/C${summaryRow},"")`;
      putFormula(s, summaryRow - 1, 4, physFormula, +phys.toFixed(6));
    }
    if (phys !== null) putFormula(s, summaryRow - 1, 5, `=IF(OR(D${summaryRow}="",E${summaryRow}=""),"",D${summaryRow}*E${summaryRow}/100)`, weight!==null?+(weight*phys/100).toFixed(6):'');
    putFormula(s, summaryRow - 1, 7, `=IF(OR(C${summaryRow}="",G${summaryRow}="",C${summaryRow}=0),"",G${summaryRow}/C${summaryRow}*100)`, rate===null?'':+rate.toFixed(6));
    putFormula(s, summaryRow - 1, 8, `=IF(OR(H${summaryRow}="",D${summaryRow}=""),"",H${summaryRow}*D${summaryRow}/100)`, rate!==null&&weight!==null?+(rate*weight/100).toFixed(6):'');
    putFormula(s, summaryRow - 1, 9, `=IF(OR(C${summaryRow}="",G${summaryRow}=""),"",C${summaryRow}-G${summaryRow})`, parentBudget!==null&&g.fin!==null?parentBudget-g.fin:'');

    for (let rr = summaryRow + 1; rr < g.next; rr++) {
      const row = rows[rr - 1] || [];
      const b = parseNumber(row[2]), p = parseNumber(row[4]), fin = parseNumber(row[6]);
      if (cleanText(row[1]) === '' || (b === null && p === null && fin === null)) continue;
      const d = parentBudget !== null && parentBudget !== 0 && b !== null ? b/parentBudget*100 : null;
      const h = b !== null && b !== 0 && fin !== null ? fin/b*100 : null;
      putFormula(s, rr-1, 3, `=IF(OR($C$${summaryRow}=0,C${rr}=""),"",C${rr}/$C$${summaryRow}*100)`, d===null?'':+d.toFixed(6));
      putFormula(s, rr-1, 4, `=IF(H${rr}="","",H${rr})`, h===null?'':+h.toFixed(6));
      putFormula(s, rr-1, 5, `=IF(OR(D${rr}="",E${rr}=""),"",D${rr}*E${rr}/100)`, d!==null&&h!==null?+(d*h/100).toFixed(6):'');
      putFormula(s, rr-1, 7, `=IF(OR(C${rr}="",G${rr}="",C${rr}=0),"",G${rr}/C${rr}*100)`, h===null?'':+h.toFixed(6));
      putFormula(s, rr-1, 8, `=IF(OR(H${rr}="",D${rr}=""),"",H${rr}*D${rr}/100)`, h!==null&&d!==null?+(h*d/100).toFixed(6):'');
      putFormula(s, rr-1, 9, `=IF(OR(C${rr}="",G${rr}=""),"",C${rr}-G${rr})`, b!==null&&fin!==null?b-fin:'');
    }
  }

  // Office totals: only sum top-level program summaries. Never sum children here.
  if (officeRow > 0 && rows[officeRow-1]) {
    const budgetFormula = top.length ? `=SUM(${top.map(g=>`C${g.summary}`).join(',')})` : '=0';
    const finFormula = top.length ? `=SUM(${top.map(g=>`G${g.summary}`).join(',')})` : '=0';
    putFormula(s, officeRow-1, 2, budgetFormula, totalBudget || '');
    putFormula(s, officeRow-1, 3, `=IF(C${officeRow}=0,"",100)`, totalBudget ? 100 : '');
    const officePhys = parseNumber((rows[officeRow-1]||[])[4]);
    const phys = officePhys !== null ? officePhys : info.physicalRate;
    if (officePhys === null && top.length && phys !== null) {
      const expr = top.map(g=>`C${g.summary}*E${g.summary}`).join('+');
      putFormula(s, officeRow-1, 4, `=IFERROR((${expr})/C${officeRow},"")`, +phys.toFixed(6));
    }
    if (phys !== null) putFormula(s, officeRow-1, 5, `=IF(OR(D${officeRow}="",E${officeRow}=""),"",D${officeRow}*E${officeRow}/100)`, +phys.toFixed(6));
    putFormula(s, officeRow-1, 6, finFormula, totalFin || '');
    const tr = totalBudget ? totalFin/totalBudget*100 : null;
    putFormula(s, officeRow-1, 7, `=IF(C${officeRow}=0,"",G${officeRow}/C${officeRow}*100)`, tr===null?'':+tr.toFixed(6));
    putFormula(s, officeRow-1, 8, `=IF(OR(H${officeRow}="",D${officeRow}=""),"",H${officeRow}*D${officeRow}/100)`, tr===null?'':+tr.toFixed(6));
    putFormula(s, officeRow-1, 9, `=IF(OR(C${officeRow}="",G${officeRow}=""),"",C${officeRow}-G${officeRow})`, totalBudget-totalFin);
  }
  if (totalRow > 0 && rows[totalRow-1]) {
    putFormula(s, totalRow-1, 2, `=C${officeRow}`, totalBudget || '');
    putFormula(s, totalRow-1, 6, `=G${officeRow}`, totalFin || '');
    const tr = totalBudget ? totalFin/totalBudget*100 : null;
    putFormula(s, totalRow-1, 7, `=IF(C${totalRow}=0,"",G${totalRow}/C${totalRow}*100)`, tr===null?'':+tr.toFixed(6));
    putFormula(s, totalRow-1, 9, `=IF(OR(C${totalRow}="",G${totalRow}=""),"",C${totalRow}-G${totalRow})`, totalBudget-totalFin);
  }
}

function recalculatePayload(payload) { const out=clone(payload); for(const name of Object.keys(out.sheets||{})) applyAutoCalculations(out,name); return out; }
function formulaAudit(payload) {
  const issues=[]; let errors=0, external=0, formulaCount=0;
  for(const [name,s] of Object.entries(payload.sheets||{})){
    for(let ri=0;ri<(s.values||[]).length;ri++) for(let ci=0;ci<(s.values[ri]||[]).length;ci++) if(isError(s.values[ri][ci])) { errors++; if(issues.length<60) issues.push({sheet:name,cell:addr(ri,ci),kind:'ERROR',value:s.values[ri][ci]}); }
    for(const [a,f] of Object.entries(s.formulas||{})){ formulaCount++; if(isExternalFormula(f)){external++; if(issues.length<60) issues.push({sheet:name,cell:a,kind:'EXTERNAL',value:f});}}
  }
  return {errors,external,formulaCount,issues};
}
function normalizeImportedSheet(name, values, formulas) {
  const cols=Math.max(values.reduce((m,r)=>Math.max(m,r.length),0),1); const out=values.map(r=>Array.from({length:cols},(_,i)=>r?.[i] ?? ''));
  return {name,rows:out.length,cols,values:out,formulas:formulas||{}};
}

function normalizeSheetKey(name) {
  return cleanText(name).toLowerCase()
    .replace(/[()\[\]{}]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/subkegiatan/g, 'subkegiatan')
    .replace(/penun/g, 'penunjang')
    .replace(/output/g, 'output');
}

function similarity(a,b){
  a=normalizeSheetKey(a); b=normalizeSheetKey(b); if(a===b) return 1;
  const grams=(x,n=2)=>{const out=[];for(let i=0;i<x.length-n+1;i++)out.push(x.slice(i,i+n));return out;};
  const A=new Set(grams(a)), B=new Set(grams(b)); if(!A.size||!B.size) return 0;
  let inter=0; A.forEach(x=>{if(B.has(x))inter++;}); return (2*inter)/(A.size+B.size);
}
function buildSchemaMapping(importedPayload, currentPayload){
  const currentNames=Object.keys(currentPayload?.sheets||{});
  const importedNames=Object.keys(importedPayload?.sheets||{});
  const unmatched=importedNames.filter(n=>!currentNames.includes(n));
  const missing=currentNames.filter(n=>!importedNames.includes(n));
  const candidates=[];
  for(const expected of missing) for(const actual of unmatched){
    if(!compatibleSheetNames(expected,actual)) continue;
    const score=similarity(expected,actual);
    if(score>=0.82)candidates.push({expected,actual,score,status:'fuzzy'});
  }
  const used=new Set();
  const rows=currentNames.map(expected=>{
    if(importedNames.includes(expected)){
      used.add(expected);
      return {expected,actual:expected,score:1,status:'exact'};
    }
    const matches=candidates.filter(m=>m.expected===expected).sort((a,b)=>b.score-a.score);
    const best=matches[0];
    if(best && best.score!==matches[1]?.score &&
       !candidates.some(m=>m!==best && m.actual===best.actual && m.score>=best.score)){
      used.add(best.actual);return best;
    }
    return {expected,actual:'',score:0,status:'missing'};
  });
  for(const actual of importedNames.filter(n=>!used.has(n)))rows.push({expected:'',actual,score:0,status:'new'});
  return rows;
}
function importSchemaStats(mapping){
  return {exact:mapping.filter(x=>x.status==='exact').length,fuzzy:mapping.filter(x=>x.status==='fuzzy').length,missing:mapping.filter(x=>x.status==='missing').length,newSheets:mapping.filter(x=>x.status==='new').length};
}
function extractWorkbookPresentation(wb){
  const sheets={};
  for(const name of wb.SheetNames){
    const ws=wb.Sheets[name];
    const extent=XLSX.utils.decode_range(ws['!ref']||'A1').e;
    sheets[name]={
      ref: ws['!ref']||'A1',
      merges: (ws['!merges']||[]).map(m=>({s:{r:m.s.r,c:m.s.c},e:{r:m.e.r,c:m.e.c}})),
      cols: (ws['!cols']||[]).slice(0,extent.c+1).map(c=>c?({...c}):null),
      rows: (ws['!rows']||[]).slice(0,extent.r+1).map(r=>r?({...r}):null),
      hidden: !!ws['!hidden'],
      formats: Object.fromEntries(Object.entries(ws).filter(([a,c])=>a[0]!=='!'&&c.z&&c.z!=='General'&&(c.v!==undefined||c.f)).map(([a,c])=>[a,{numberFormat:c.z}])),
      views: ws['!views'] ? clone(ws['!views']) : null,
      autoFilter: ws['!autofilter'] ? clone(ws['!autofilter']) : null,
    };
  }
  return sheets;
}
function arrayBufferToBase64(buf){ const bytes=new Uint8Array(buf); const chunk=0x8000; let out=''; for(let i=0;i<bytes.length;i+=chunk){ out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length))); } return btoa(out); }
function workbookToBase64(wb){
  try{return XLSX.write(wb,{bookType:'xlsx',type:'base64',compression:true});}catch{return null;}
}
function updateWorkbookFromPayload(templateWb,payload, mapping){
  const map=new Map(mapping.filter(x=>x.actual).map(x=>[x.expected,x.actual]));
  for(const [logicalName,s] of Object.entries(payload.sheets||{})){
    const physicalName=map.get(logicalName)||logicalName;
    const ws=templateWb.Sheets[physicalName]; if(!ws) continue;
    const values=s.values||[]; const formulas=s.formulas||{};
    const range=XLSX.utils.decode_range(s.ref||ws['!ref']||`A1:${colName(Math.max(0,(s.cols||1)-1))}${Math.max(1,values.length)}`);
    for(let r=range.s.r;r<=Math.max(range.e.r,values.length-1);r++){
      for(let c=range.s.c;c<=Math.max(range.e.c,(s.cols||1)-1);c++){
        const a=XLSX.utils.encode_cell({r,c}); const v=values?.[r]?.[c] ?? '';
        const f=formulas?.[a];
        if(f){ ws[a] = ws[a] || {}; ws[a].f=String(f).replace(/^=/,''); ws[a].v = typeof v==='number'?v:v; ws[a].t=typeof v==='number'?'n':'s'; }
        else if(ws[a]){ ws[a].v=v; if(v===''||v===null){ delete ws[a].f; ws[a].v=''; ws[a].t='s'; } else { ws[a].t=typeof v==='number'?'n':'s'; delete ws[a].f; } }
        else if(v!=='' && v!==null){ ws[a]={t:typeof v==='number'?'n':'s',v}; }
      }
    }
    ws['!ref']=s.ref||ws['!ref'];
    if(s.presentation){
      if(s.presentation.merges) ws['!merges']=s.presentation.merges.map(m=>({s:m.s,e:m.e}));
      if(s.presentation.cols) ws['!cols']=s.presentation.cols.map(c=>c?({...c}):null);
      if(s.presentation.rows) ws['!rows']=s.presentation.rows.map(r=>r?({...r}):null);
      if(s.presentation.views) ws['!views']=clone(s.presentation.views);
      if(s.presentation.autoFilter) ws['!autofilter']=clone(s.presentation.autoFilter);
    }
  }
  return templateWb;
}
function buildPreviewRows(importedPayload,currentPayload,mapping=buildSchemaMapping(importedPayload,currentPayload)){
  const current=currentPayload?.sheets||{}; const imported=importedPayload?.sheets||{};
  return mapping.map(m=>{
    if(m.status==='new') return {...m,importRows:imported[m.actual]?.rows||0,currentRows:0,importCols:imported[m.actual]?.cols||0,currentCols:0,formulaCount:Object.keys(imported[m.actual]?.formulas||{}).length};
    const i=imported[m.actual], c=current[m.expected];
    return {...m,importRows:i?.rows||0,currentRows:c?.rows||0,importCols:i?.cols||0,currentCols:c?.cols||0,formulaCount:Object.keys(i?.formulas||{}).length};
  });
}
function validateImportPlan(importedPayload,currentPayload,mode,mapping,opts={}){
  const stats=importSchemaStats(mapping); const warnings=[]; const errors=[];
  if(stats.missing>0 && mode!=='merge') warnings.push(`${stats.missing} sheet dari database saat ini tidak ditemukan di file import.`);
  if(stats.fuzzy>0) warnings.push(`${stats.fuzzy} sheet dipetakan berdasarkan kemiripan nama.`);
  if(stats.newSheets>0) warnings.push(`${stats.newSheets} sheet baru ditemukan dan akan ditambahkan dengan nama aslinya. Pastikan tidak ada nama yang salah sebelum mengimpor.`);
  const cached=importedPayload.meta?.sharedFormulaCached||[];
  if(cached.length)warnings.unshift(`${cached.length} sel memakai nilai terakhir Excel karena rumus bersama tidak konsisten. Sel ini akan disimpan sebagai nilai tetap: ${cached.join(', ')}.`);
  const audit=formulaAudit(importedPayload);
  if(audit.errors>0) warnings.push(`${audit.errors} nilai error terdeteksi di file import.`);
  const cellRefErrors=audit.issues.filter(i=>i.kind==='ERROR'&&String(i.value).trim().toUpperCase()==='#REF!');
  if(cellRefErrors.length) errors.push(`File Excel berisi nilai #REF! (${cellRefErrors.slice(0,4).map(i=>i.sheet+'!'+i.cell).join(', ')}). Impor dibatalkan.`);
  const brokenReferences=Object.entries(importedPayload?.sheets||{}).flatMap(([name,s])=>Object.entries(s.formulas||{}).filter(([,f])=>/#REF!/i.test(String(f))).map(([cell])=>`${name}!${cell}`));
  if(brokenReferences.length) errors.push(`Terdapat ${brokenReferences.length} rumus dengan referensi #REF! di file sumber (${brokenReferences.slice(0,4).join(', ')}). Perbaiki Excel sebelum mengimpor.`);
  if(audit.external>0) warnings.push(`${audit.external} formula eksternal terdeteksi; nilai cache akan dipertahankan bila tersedia.`);
  for(const x of mapping){
    if(x.status==='fuzzy' && x.score<0.60) warnings.push(`Pemetaan ${x.actual} → ${x.expected} memiliki keyakinan rendah (${Math.round(x.score*100)}%).`);
  }
  if(!Object.keys(importedPayload?.sheets||{}).length) errors.push('Tidak ada sheet yang dapat diimpor.');
  return {ok:errors.length===0,errors,warnings,stats,audit,preserveFormat:opts.preserveFormat!==false};
}
function makeAuditEntry(action,details){ return {id:`IMP-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,at:new Date().toISOString(),action,details}; }
async function initLocalStores(){ auditCache=await idbGet('audit').catch(()=>null) || []; importBackupCache=await idbGet('backup').catch(()=>null) || null; templateCache=await idbGet('template').catch(()=>null) || null; }
function readAudit(){ return auditCache; }
function writeAudit(entry){ auditCache=[entry,...auditCache].slice(0,MAX_IMPORT_AUDIT); void idbSet('audit',auditCache).catch(()=>{}); void pushAudit(entry); }
async function saveImportBackup(year,payload,years){ importBackupCache={year,payload,years,at:new Date().toISOString()}; await idbSet('backup',importBackupCache); }
async function loadImportBackup(){ if(importBackupCache) return importBackupCache; importBackupCache=await idbGet('backup').catch(()=>null); return importBackupCache; }
async function saveTemplateBase64(base64,meta){ templateCache={base64,meta,at:new Date().toISOString()}; await idbSet('template',templateCache); }
function loadTemplateBase64(){ return templateCache; }
function detectYearInValues(values) { for(const row of (values||[]).slice(0,8)) for(const v of row||[]){ const m=String(v??'').match(/\b(20\d{2})\b/); if(m) return Number(m[1]); } return null; }
function parseExcelWorkbook(file) {
  return file.arrayBuffer().then(async buf=>{
    const wb=XLSX.read(buf,{type:'array',cellFormula:true,cellNF:true,cellStyles:true,cellHTML:false}); const sharedFormulaCheck=await expandExcelSharedFormulas(buf,wb);
    if(sharedFormulaCheck.unresolved.length)throw new Error(`Rumus bersama Excel tidak lengkap: ${sharedFormulaCheck.unresolved.slice(0,3).join(', ')}. Import dibatalkan agar rumus tidak hilang.`);
    const sheets={}; let year=null;
    wb.SheetNames.forEach(name=>{
      const ws=wb.Sheets[name], ref=ws['!ref'];
      const values=[], formulas={};
      for(const [a,c] of Object.entries(ws)){
        if(a.startsWith('!') || (!c.f && (c.v==null || c.t==='z')))continue;
        const {r,c:col}=XLSX.utils.decode_cell(a);
        values[r] ||= [];
        values[r][col]=c.t==='e' ? (c.w||'#ERROR!') : (c.v??'');
        if(c.f)formulas[a]='='+c.f;
      }
      for(let r=0;r<values.length;r++)values[r] ||= [];
      const metaSheet=normalizeImportedSheet(name,values,formulas); metaSheet.ref=ref||'A1'; metaSheet.cols=Math.max(metaSheet.cols, XLSX.utils.decode_range(ref||'A1:A1').e.c+1); metaSheet.presentation=extractWorkbookPresentation({SheetNames:[name],Sheets:{[name]:ws}})[name];
      sheets[name]=metaSheet; for(const row of values.slice(0,8))for(const v of row){const m=String(v).match(/(?:TAHUN ANGGARAN|TA)\s*(20\d{2})/i);if(m)year=Number(m[1]);}
      for(const [a,f] of Object.entries(formulas)) if(isExternalFormula(f)){ const v=ws[a]?.v; if(v!==undefined && !isError(v)) { const rc=XLSX.utils.decode_cell(a); metaSheet.values[rc.r][rc.c]=v; } }
    });
    return {version:'8.1.5',source:file.name,meta:{organization:ORG,year:year||new Date().getFullYear(),sheetCount:wb.SheetNames.length,preserveFormat:true,sharedFormulaCached:sharedFormulaCheck.cached||[],sharedFormulasRestored:sharedFormulaCheck.expanded},sheets,_templateBase64:arrayBufferToBase64(buf)};
  });
}

function safeSheetName(name){ return String(name).replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'Sheet'; }
function aoaFromSheet(s){ return (s.values||[]).map(r=>Array.from({length:s.cols||0},(_,i)=>r?.[i]??'')); }
function applyFormulaObjects(ws, s){ for(const [a,f] of Object.entries(s.formulas||{})){ if(!ws[a]) ws[a]={t:'s',v:s.values?.[XLSX.utils.decode_cell(a).r]?.[XLSX.utils.decode_cell(a).c]??''}; ws[a].f=String(f).replace(/^=/,''); } }
function downloadBlob(blob, filename){ const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000); }
function exportExcelPayload(payload, year, onlySheet=null){
  const template=null; // Export live dimensions and formulas, never stale template coordinates.
  let wb=null;
  if(template?.base64){ try{wb=XLSX.read(template.base64,{type:'base64',cellFormula:true,cellNF:true,cellStyles:true});}catch{wb=null;} }
  if(!wb) wb=XLSX.utils.book_new();
  if(template?.base64){
    const mapping=buildSchemaMapping(payload,payload);
    updateWorkbookFromPayload(wb,payload,mapping);
    if(onlySheet){ const keep=new Set([onlySheet]); wb.SheetNames=wb.SheetNames.filter(n=>keep.has(n)); }
    if(!onlySheet){
      const d=derive(payload); const sum=[['DATABASE REALISASI KINERJA',''],['Organisasi',ORG],['Tahun',year],[],['KPI','Nilai'],['Total Anggaran',d.budgetTotal],['Realisasi Keuangan',d.financialTotal],['Serapan Keuangan',d.financialRate/100],['Rata-rata Fisik',d.physicalRate/100],['Penugasan PKPT',d.pkptCount],['Selesai',d.done],['Berjalan',d.progress],['Belum',d.pending],['Output Utama',d.outputUtama],['Output Penunjang',d.outputPenunjang],['Kelengkapan Database',d.overallCompleteness/100],['Rata-rata Capaian',d.avgCapaian===null?'':d.avgCapaian/100]]; if(!wb.Sheets['Dashboard']) XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sum),'Dashboard'); else wb.Sheets['Dashboard']=XLSX.utils.aoa_to_sheet(sum); if(!wb.SheetNames.includes('Dashboard')) wb.SheetNames.unshift('Dashboard'); }
  } else {
    const entries=onlySheet ? [[onlySheet,payload.sheets[onlySheet]]] : Object.entries(payload.sheets||{});
    if(!onlySheet){const d=derive(payload);const summary=[['DATABASE REALISASI KINERJA',''],['Organisasi',ORG],['Tahun',year],[],['KPI','Nilai'],['Total Anggaran',d.budgetTotal],['Realisasi Keuangan',d.financialTotal],['Serapan Keuangan',d.financialRate/100],['Rata-rata Fisik',d.physicalRate/100],['Penugasan PKPT',d.pkptCount],['Selesai',d.done],['Berjalan',d.progress],['Belum',d.pending],['Output Utama',d.outputUtama],['Output Penunjang',d.outputPenunjang],['Kelengkapan Database',d.overallCompleteness/100],['Rata-rata Capaian',d.avgCapaian===null?'':d.avgCapaian/100]];XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Dashboard');}
    const used={}; entries.forEach(([name,s])=>{if(!s)return;let sn=safeSheetName(name),base=sn,i=2;while(used[sn])sn=(base.slice(0,27)+`_${i++}`).slice(0,31);used[sn]=1;const ws=XLSX.utils.aoa_to_sheet(aoaFromSheet(s));applyFormulaObjects(ws,s);if(s.presentation){if(s.presentation.merges)ws['!merges']=s.presentation.merges.map(m=>({s:m.s,e:m.e}));if(s.presentation.cols)ws['!cols']=s.presentation.cols.map(c=>c?({...c}):null);if(s.presentation.rows)ws['!rows']=s.presentation.rows.map(r=>r?({...r}):null);}XLSX.utils.book_append_sheet(wb,ws,sn);});
  }
  const arr=XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true}); downloadBlob(new Blob([arr],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), onlySheet?`Kertas-Kerja-${onlySheet}-${year}.xlsx`:`Database-Realisasi-Kinerja-TA-${year}.xlsx`);
}

function yearFromPayload(payload) {
  const direct = payload?.meta?.year;
  if (direct) return Number(direct);
  for (const s of Object.values(payload?.sheets || {})) {
    for (const row of (s.values || []).slice(0, 5)) for (const v of row) {
      const m = cell(v).match(/\b(20\d{2})\b/); if (m) return Number(m[1]);
    }
  }
  return new Date().getFullYear();
}

function updateYearStrings(value, year) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/TAHUN ANGGARAN\s+20\d{2}/gi, `TAHUN ANGGARAN ${year}`)
    .replace(/\bTA\s*20\d{2}\b/gi, `TA ${year}`)
    .replace(/Tahun\s+20\d{2}/gi, `Tahun ${year}`);
}

function normalizePayloadForYear(payload, year) {
  const out = clone(payload);
  out.meta = { ...(out.meta || {}), year: Number(year) };
  // A newly copied year must not retain the old official report name.
  // This applies when copying 2027→2028 too, not only 2026→2027.
  const renamed=officialReportName(year);
  for(const original of Object.keys(out.sheets||{})){
    if(isOfficialReportName(original)&&original!==renamed){
      out.sheets[renamed]={...out.sheets[original],name:renamed};
      delete out.sheets[original];
    }
  }
  for (const s of Object.values(out.sheets || {})) {
    s.values = (s.values || []).map((row) => row.map((v) => updateYearStrings(v, Number(year))));
    if(s.formulas){
      s.formulas=Object.fromEntries(Object.entries(s.formulas).map(([cell,formula])=>
        [cell,String(formula).replace(/Laporan_Monev_Renaksi_20\d{2}/gi,renamed)]));
    }
  }
  return out;
}

function blankDataRows(payload, year) {
  const out = normalizePayloadForYear(payload, year);
  for (const [name, s] of Object.entries(out.sheets || {})) {
    if (name === MONEV_REPORT_SHEET) {
      out.sheets[name] = prepareBlankMonevReport(s, year);
      continue;
    }
    const start = sheetMeta[name]?.dataStart ?? 3;
    if (start >= 0 && s.values.length > start) {
      const cols = Math.max(s.cols || 0, ...s.values.map(r => r.length), 0);
      const kept = s.values.slice(0, start);
      const blankCount = Math.max(1, Math.min(s.values.length - start, 20));
      for (let i = 0; i < blankCount; i++) kept.push(Array(cols).fill(''));
      s.values = kept;
      s.rows = kept.length;
      s.cols = cols;
    }
  }
  return out;
}

function headersFor(sheet) {
  const values = sheet?.values || [];
  const cols = Math.max(sheet?.cols || 0, ...values.map(r => r?.length || 0), 0);
  return Array.from({ length: cols }, (_, ci) => {
    const found = [];
    for (const row of values.slice(0, 9)) {
      const v = cleanText(row?.[ci]);
      if (!v) continue;
      if (!/^\d+$/.test(v) && !found.includes(v)) found.push(v);
    }
    return found.slice(-2).join(' / ') || `Kolom ${colName(ci)}`;
  });
}

function dataCompleteness(sheet) {
  const meta = sheetMeta[sheet?.name] || {};
  const values = sheet?.values || [];
  const start = meta.dataStart ?? 3;
  // Ignore intentional spacer rows so grouped Excel sheets do not look empty.
  const data = values.slice(start).filter(r => (r || []).some(v => cleanText(v)));
  const cols = Math.max(sheet?.cols || 0, ...data.map(r => r?.length || 0), 0);
  if (!data.length || !cols) return 0;
  let filled = 0; const total = data.length * cols;
  for (const r of data) for (let c = 0; c < cols; c++) if (cleanText(r?.[c])) filled++;
  return total ? filled / total * 100 : 0;
}

function sheetStats(name, sheet) {
  const values=sheet?.values||[]; const meta={...(sheetMeta[name]||{}),...(name.startsWith("Capaian Sasaran")?capaianMeta(values):{})}; const start=meta.dataStart??3; const rows=values.slice(start).filter(r=>!r.slice(0,2).some(v=>/^(jumlah|total|rata-rata)/i.test(cleanText(v)))); const achievement=[]; const budget=[]; let target=0, realized=0, budgetTotal=0, budgetRealized=0;
  if(meta.target!==undefined){ for(const r of rows){ const t=parseNumber(r?.[meta.target]), a=parseNumber(r?.[meta.real]); if(t!==null) target++; if(t!==null&&a!==null&&t!==0) achievement.push(a/t*100); if(a!==null) realized++; const b=parseNumber(r?.[meta.budget]), br=parseNumber(r?.[meta.budgetReal]); if(b!==null) budgetTotal+=b; if(br!==null) budgetRealized+=br; if(b!==null&&br!==null&&b!==0) budget.push(br/b*100); } }
  if(name==='Realisasi Fisik & Keu'){ const info=getRealisasiTotals(values); budgetTotal=info.budgetTotal; budgetRealized=info.financialTotal; if(info.physicalRate!==null) achievement.push(info.physicalRate); if(info.budgetTotal>0 && info.financialTotal!==null) budget.push(info.financialRate); }
  const monev=[]; if(meta.targetCols&&meta.realCols) rows.forEach(r=>{let t=0,a=0,has=false; meta.targetCols.forEach((c,i)=>{const tv=parseNumber(r?.[c]),av=parseNumber(r?.[meta.realCols[i]]);if(tv!==null&&av!==null&&tv!==0){t+=tv;a+=av;has=true;}});if(has&&t) monev.push(a/t*100);});
  if(monev.length) achievement.splice(0,achievement.length,...monev);
  const average=achievement.length?achievement.reduce((a,b)=>a+b,0)/achievement.length:null; const budgetAverage=budget.length?budget.reduce((a,b)=>a+b,0)/budget.length:(budgetTotal?budgetRealized/budgetTotal*100:null);
  return {completeness:dataCompleteness({...sheet,name}),rows:values.length,cols:sheet?.cols||0,average,budgetAverage,target,realized,budgetTotal,budgetRealized,validMetrics:achievement.length};
}
function applyAutoCalculations(payload, name) { /* Google Sheets calculates the original Excel formulas. */ }

function derive(payload){
  const sheets=payload.sheets||{}, stats=Object.entries(sheets).map(([name,s])=>({name,...sheetStats(name,s)}));
  const rf=sheets['Realisasi Fisik & Keu']?.values||[];
  const rfInfo=getRealisasiTotals(rf);
  const budgetTotal=rfInfo.budgetTotal;
  const financialTotal=rfInfo.financialTotal;
  const financialRate=rfInfo.financialRate;
  const physicalRate=rfInfo.physicalRate;

  // Physical sample count only uses detail rows, never the program summaries or office total.
  const physicalPairs=[];
  for(const g of rfInfo.top){
    for(let rr=g.summary+1; rr<g.next; rr++){
      const r=rf[rr-1]||[];
      const b=parseNumber(r[2]), p=parseNumber(r[4]) ?? parseNumber(r[7]);
      if(cleanText(r[1])!=='' && b!==null && p!==null && Number.isFinite(p)) physicalPairs.push({b,p});
    }
  }
  const physicalRowsCount=physicalPairs.length;
  const weightedPhysical=physicalRate;

  // PKPT status section ends before the "REALISASI OUTPUT PENUGASAN / SATUAN HASIL" section.
  const pk=sheets['Rekap realisasi PKPT']?.values||[];
  const outputHeader=pk.findIndex(r=>cleanText(r?.[1]).toUpperCase().includes('REALISASI OUTPUT PENUGASAN'));
  const statusEnd=outputHeader>0?outputHeader:pk.length;
  const pkItems=pk.slice(6,statusEnd).filter(r=>cleanText(r?.[3]));
  const status=pkItems.map(r=>cleanText(r?.[4]).toLowerCase());
  const done=status.filter(v=>v==='sudah'||v.includes('selesai')).length;
  const progress=status.filter(v=>v.includes('berjalan')||v.includes('proses')).length;
  const pending=status.filter(v=>v.includes('belum')||!v).length;
  const pkptOther=Math.max(0,pkItems.length-done-progress-pending);
  const pkptCompletionValues=pkItems.map(r=>{const t=parseNumber(r?.[9]),a=parseNumber(r?.[11]); return t!==null&&a!==null&&t!==0?a/t*100:null}).filter(v=>v!==null);
  const pkptCompletion=pkptCompletionValues.length?pkptCompletionValues.reduce((a,b)=>a+b,0)/pkptCompletionValues.length:null;

  const outU=sheets['Monev output Subkegiatan Utama']?.values||[];
  const outP=sheets['Monev Subkegiatan Penunjang']?.values||[];
  // KPI output follows the workbook's explicit "Jumlah Output" fields:
  // L = output utama, K = output penunjang. Activity description is optional.
  const outputUtama=outU.slice(6).reduce((sum,r)=>sum + (parseNumber(r?.[11]) || 0), 0);
  const outputPenunjang=outP.slice(6).reduce((sum,r)=>sum + (parseNumber(r?.[10]) || 0), 0);

  const formulaInfo=formulaAudit(payload);
  const capaianNames=['Capaian Sasaran Strategis','Capaian Sasaran Program','Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)','Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)'];
  const capaianCards=capaianNames.map(name=>({name,...sheetStats(name,sheets[name])}));
  const overallCompleteness=stats.length?stats.reduce((a,b)=>a+b.completeness,0)/stats.length:0;
  const av=capaianCards.filter(x=>x.average!==null);
  const avgCapaian=av.length?av.reduce((a,b)=>a+b.average,0)/av.length:null;
  const monevNames=['Monev Renaksi IKU','Monev Program'];
  const monevRates=monevNames.map(name=>{const st=sheetStats(name,sheets[name]);return {name,rate:st.average,budgetRate:st.budgetAverage}});

  const central=calculateMetrics(sheets);
  return {
    stats,physicalRowsCount,pkptCompletion,
    errorCount:formulaInfo.errors,externalFormulaCount:formulaInfo.external,formulaCount:formulaInfo.formulaCount,
    capaianCards,overallCompleteness,avgCapaian,monevRates,formulaIssues:formulaInfo.issues,
    budgetTotal:central.totalAnggaran,financialTotal:central.realisasiKeuangan,financialRate:central.serapan,physicalRate:central.realisasiFisik,weightedPhysical:central.realisasiFisik,
    pkptCount:central.penugasan,done:central.selesai,progress:central.berjalan,pending:central.belum,pkptOther:central.lainnya,outputUtama:central.outputUtama,outputPenunjang:central.outputPenunjang,
    calculationAudit:{
      realisasiSource:'Realisasi Fisik & Keu',
      budgetBasis:'Office total C10 / fallback sum of top-level program summary rows only',
      financialBasis:'Office total G10 / fallback sum of top-level program summary rows only',
      doubleCountProtection:true,
      officeRow:rfInfo.officeRow,
      totalRow:rfInfo.totalRow,
      topProgramRows:rfInfo.programRows,
      topProgramBudgets:rfInfo.top.map(g=>g.budget),
      topProgramFinancials:rfInfo.top.map(g=>g.fin)
    }
  };
}
function prepareImportedForMode(imported,current,mapping,mode,targetYear){
  const sheets=mode==='newyear'?{}:{...current?.sheets};
  const names=Object.fromEntries(mapping.filter(m=>m.actual).map(m=>{
    const name=m.expected||m.actual;
    return [m.actual,mode==='newyear' && isOfficialReportName(name)?officialReportName(targetYear):name];
  }));
  const aliases=Object.fromEntries(Object.entries(names).filter(([src,dst])=>src!==dst));
  for(const [actual,name] of Object.entries(names)){
    const source=imported.sheets[actual];
    if(!source.rows && sheets[name])continue;
    let formulas=source.formulas;
    if(Object.keys(aliases).length)formulas=Object.fromEntries(Object.entries(formulas||{}).map(
      ([a,f])=>[a,remapFormula(f,aliases)]));
    sheets[name]={...source,name,formulas};
  }
  return {version:imported.version,source:imported.source,meta:{...imported.meta,year:targetYear,sheetCount:Object.keys(sheets).length},sheets};
}
function payloadDiffSummary(before,after){
  const bs=before?.sheets||{}, as=after?.sheets||{}; let sheetsChanged=0,cellsChanged=0,rowsAdded=0,rowsRemoved=0;
  const names=new Set([...Object.keys(bs),...Object.keys(as)]);
  for(const name of names){ const bv=bs[name]?.values||[], av=as[name]?.values||[]; if(bv.length!==av.length) {rowsAdded+=Math.max(0,av.length-bv.length); rowsRemoved+=Math.max(0,bv.length-av.length); sheetsChanged++;}
    const rows=Math.max(bv.length,av.length); for(let r=0;r<rows;r++){const br=bv[r]||[], ar=av[r]||[]; const cols=Math.max(br.length,ar.length); for(let c=0;c<cols;c++) if(cell(br[c])!==cell(ar[c])) cellsChanged++;}
  }
  return {sheetsChanged,cellsChanged,rowsAdded,rowsRemoved};
}
function EditorApp(){
  const [officialReportMissing,setOfficialReportMissing]=useState(false),[reportInstalling,setReportInstalling]=useState(false),[importBusy,setImportBusy]=useState(false),[payload,setPayload]=useState(null),[baseline,setBaseline]=useState(null),[years,setYears]=useState({}),[year,setYear]=useState(null),[active,setActive]=useState('dashboard'),[selectedSheet,setSelectedSheet]=useState('Realisasi Fisik & Keu'),[query,setQuery]=useState(''),[selectedRow,setSelectedRow]=useState(null),[dirty,setDirty]=useState(false),[saveError,setSaveError]=useState(''),[syncNotice,setSyncNotice]=useState(''),[insightTab,setInsightTab]=useState('ringkasan'),[period,setPeriod]=useState(INITIAL_PERIOD),[periodMissing,setPeriodMissing]=useState(false),[periodBusy,setPeriodBusy]=useState(false),[toast,setToast]=useState(''),[sidebarOpen,setSidebarOpen]=useState(false),[yearModal,setYearModal]=useState(false),[rowModal,setRowModal]=useState(null),[yearEditModal,setYearEditModal]=useState(false),[importModal,setImportModal]=useState(null),[auditModal,setAuditModal]=useState(false),[auditEntries,setAuditEntries]=useState([]),fileRef=useRef(null),xlsxRef=useRef(null),pendingSheetsRef=useRef(new Map()),pendingCellsRef=useRef(new Map()),cellVersionsRef=useRef(new Map()),savingRef=useRef(false),cellSavingRef=useRef(false),remoteRevisionRef=useRef(''),editVersionRef=useRef(0),saveBlockedRef=useRef(false),formulaTimerRef=useRef(null),activeScopeRef=useRef({year:null,period:INITIAL_PERIOD});
  useEffect(()=>{(async()=>{try{await initLocalStores();setAuditEntries(auditCache);const me=await adminMe();if(!me.ok) throw Object.assign(new Error('Sesi admin tidak valid. Silakan login kembali.'),{status:401});const urlYear=Number(new URLSearchParams(window.location.search).get('year'));const target=(Number.isInteger(urlYear)&&urlYear>=2000&&urlYear<=2100?urlYear:0)||Number(localStorage.getItem(`${STORAGE_KEY}:activeYear`))||2026;const resp=await fetchState(target,INITIAL_PERIOD);if(!resp.ok||!resp.payload?.sheets) throw Object.assign(new Error(resp.message||'Database backend tidak mengembalikan sheet'),{status:resp.status||500});const selectedYear=Number(resp.year||target);setOfficialReportMissing(Boolean(resp.officialMonevMissing)&&!resp.needsImport);const ensured=ensureMonevReport(recalculatePayload(resp.payload),selectedYear);const base=recalculatePayload(ensured.payload);setBaseline(clone(base));const current=recalculatePayload(clone(ensured.payload));setYears({[selectedYear]:current});setYear(selectedYear);setSelectedSheet(current.sheets?.['Realisasi Fisik & Keu']?'Realisasi Fisik & Keu':Object.keys(current.sheets||{})[0]||'');setPayload(current);setPeriodMissing(Boolean(resp.needsImport&&INITIAL_PERIOD!=='annual'));if(ensured.changed) { pendingSheetsRef.current.set(MONEV_REPORT_SHEET,1); setDirty(true); } else setDirty(false);setToast(resp.needsImport?'Spreadsheet siap — TA ini belum diinisialisasi, gunakan Import Excel.':resp.source==='google-sheets'?'Terhubung ke database Google Sheets':'Mode seed server');}catch(e){if(e?.status===401) window.dispatchEvent(new CustomEvent('admin-auth-required'));setToast('Memuat database gagal: '+e.message);setPayload(null)}})()},[]);
useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),3200);return()=>clearTimeout(t)},[toast]);
  useEffect(()=>()=>{if(formulaTimerRef.current)clearTimeout(formulaTimerRef.current);},[]);
  useEffect(()=>{activeScopeRef.current={year,period};if(formulaTimerRef.current){clearTimeout(formulaTimerRef.current);formulaTimerRef.current=null;}},[year,period]);

  useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]); useEffect(()=>{document.title=`${ORG} — Dashboard Realisasi Kinerja`},[]);
  useEffect(()=>{const h=e=>{const d=e.detail||{};if(d.sheet!==undefined)setRowModal({sheet:d.sheet,row:d.row})};window.addEventListener('open-row-editor',h);return()=>window.removeEventListener('open-row-editor',h)},[]);
  // Refresh computed Google formula outputs once editing has gone idle.
  // The previous implementation fetched all 15 sheets after EVERY cell write,
  // amplifying latency and requests during ordinary typing.
  const queueFormulaRefresh=(version,savedYear,savedPeriod)=>{
    if(formulaTimerRef.current)clearTimeout(formulaTimerRef.current);
    formulaTimerRef.current=setTimeout(async()=>{
      if(saveBlockedRef.current||pendingCellsRef.current.size||pendingSheetsRef.current.size||editVersionRef.current!==version||activeScopeRef.current.year!==savedYear||activeScopeRef.current.period!==savedPeriod)return;
      const fresh=await fetchState(savedYear,savedPeriod).catch(()=>null);
      if(fresh?.ok&&!fresh.needsImport&&!saveBlockedRef.current&&editVersionRef.current===version&&!pendingCellsRef.current.size&&!pendingSheetsRef.current.size&&activeScopeRef.current.year===savedYear&&activeScopeRef.current.period===savedPeriod){
        setPayload(fresh.payload);setYears(prev=>({...prev,[savedYear]:fresh.payload}));
      }
    },3500);
  };
  const monitorSync=(result,action='Penyimpanan')=>{
    if(result?.sync?.published===false)setSyncNotice(`${action} sudah berhasil di Google Sheets, tetapi penanda revisi ke Dashboard SIKAP gagal diterbitkan. Jangan ulangi penyimpanan tanpa memeriksa data; SIKAP memiliki pemuatan ulang cadangan.`);
    else if(result?.sync?.published===true)setSyncNotice('');
    return result;
  };
  const retrySave=()=>{saveBlockedRef.current=false;setSaveError('');setPayload(p=>p?({...p}):p);};
  const installOfficialReport=async()=>{
    if(year!==2026||period!=='annual'||reportInstalling)return;
    if(dirty||savingRef.current||cellSavingRef.current||pendingCellsRef.current.size||pendingSheetsRef.current.size){setToast('Simpan seluruh perubahan terlebih dahulu sebelum menambahkan laporan resmi.');return;}
    if(!window.confirm('Tambahkan HANYA sheet Laporan_Monev_Renaksi_2026 sesuai Excel terbaru? Semua sheet dan isian lain tetap dipertahankan.'))return;
    setReportInstalling(true);
    try{
      const result=monitorSync(await addOfficialMonev(),'Laporan Monev');
      const resp=await fetchState(2026,'annual');
      if(!resp?.ok)throw new Error(resp?.message||'Gagal memuat laporan terbaru');
      setPayload(resp.payload);setBaseline(clone(resp.payload));setYears(prev=>({...prev,[2026]:resp.payload}));setOfficialReportMissing(Boolean(resp.officialMonevMissing));
      setToast(result.created?'Sheet laporan Monev resmi telah ditambahkan tanpa mengubah sheet lain.':'Sheet resmi sudah tersedia.');
    }catch(e){setToast('Gagal menambahkan laporan: '+e.message);}finally{setReportInstalling(false);}
  };

useEffect(()=>{
    if(!payload||year===null||cellSavingRef.current||savingRef.current||saveBlockedRef.current||pendingCellsRef.current.size===0||periodMissing) return;
    const timer=setTimeout(async()=>{
      if(cellSavingRef.current||savingRef.current||saveBlockedRef.current) return;
      cellSavingRef.current=true;
      const atVersion=editVersionRef.current;
      const batch=[...pendingCellsRef.current.values()].slice(0,1000);
      const sent=batch.map(x=>({...x,version:cellVersionsRef.current.get(x.key)||0}));
      try{
        monitorSync(await saveCells(sent.map(({key,version,...x})=>x),year,period),'Autosave sel');
        for(const item of sent){
          if((cellVersionsRef.current.get(item.key)||0)===item.version){
            pendingCellsRef.current.delete(item.key);
          }
        }
        if(pendingCellsRef.current.size===0 && pendingSheetsRef.current.size===0 && editVersionRef.current===atVersion){
          setDirty(false);
          setToast('Perubahan tersimpan otomatis ke database pusat');
          queueFormulaRefresh(atVersion,year,period);
        }
      }catch(e){
        // Stop automatic retries after a backend error: the old 900-ms loop
        // flooded /api/admin/cell and left the editor permanently 'Menyimpan'.
        saveBlockedRef.current=true;
        setSaveError('Gagal menyimpan sel: '+(e.message||'server belum siap'));
      }finally{
        cellSavingRef.current=false;
        if(!saveBlockedRef.current&&pendingCellsRef.current.size) setTimeout(()=>setPayload(p=>p?({...p}):p),900);
      }
    },700);
    return()=>clearTimeout(timer);
  },[payload,year,period,periodMissing]);

useEffect(()=>{
    if(!payload||year===null||!dirty||savingRef.current||cellSavingRef.current||saveBlockedRef.current||pendingSheetsRef.current.size===0||periodMissing) return;
    const timer=setTimeout(async()=>{
      if(savingRef.current||cellSavingRef.current||saveBlockedRef.current) return;
      savingRef.current=true;
      const atVersion=editVersionRef.current;
      const entries=[...pendingSheetsRef.current.entries()];
      const saved=[];
      try{
        for(const [name,version] of entries){
          const sheet=payload.sheets?.[name];
          if(!sheet) continue;
          monitorSync(await saveSheet(clone(sheet),year,{period}),'Autosave sheet');
          saved.push([name,version]);
        }
        for(const [name,version] of saved){
          if(pendingSheetsRef.current.get(name)===version) pendingSheetsRef.current.delete(name);
        }
        if(pendingSheetsRef.current.size===0&&pendingCellsRef.current.size===0&&editVersionRef.current===atVersion){
          setDirty(false);
          setToast('Perubahan tersimpan otomatis ke database pusat');
        }
      }catch(e){
        saveBlockedRef.current=true;
        setSaveError('Gagal menyimpan sheet: '+(e.message||'server belum siap'));
      }finally{
        savingRef.current=false;
        if(!saveBlockedRef.current&&(pendingSheetsRef.current.size||pendingCellsRef.current.size))setTimeout(()=>setPayload(p=>p?({...p}):p),900);
      }
    },1100);
    return()=>clearTimeout(timer);
  },[payload,dirty,year,period,periodMissing]);

  useEffect(()=>{
    if(year===null||active==='dashboard'&&false) return;
    const poll=async()=>{
      const r=await fetchRevision(year).catch(()=>null);
      if(!r?.ok || !r.revision) return;
      if(remoteRevisionRef.current==='' ){ remoteRevisionRef.current=String(r.revision); return; }
      if(String(r.revision)!==String(remoteRevisionRef.current) && !dirty && !importModal && !savingRef.current){
        try{
          const resp=await fetchState(year,period);
          if(resp?.payload?.sheets){
            const ensured=ensureMonevReport(recalculatePayload(resp.payload),year);
            const current=recalculatePayload(ensured.payload);
            setBaseline(clone(current));
            setPayload(current);
            if(ensured.changed){ const v=pendingSheetsRef.current.get(MONEV_REPORT_SHEET)||0; pendingSheetsRef.current.set(MONEV_REPORT_SHEET,v+1); setDirty(true); }
            setYears(prev=>({...prev,[year]:current}));
            setToast('Kertas kerja diperbarui dari spreadsheet');
          }
          remoteRevisionRef.current=String(r.revision);
        }catch{}
      }
    };
    poll();
    const id=setInterval(poll,5000);
    return()=>clearInterval(id);
  },[year,period,dirty,importModal]);
  const derived=useMemo(()=>payload?derive(payload):null,[payload]); const integrated=useMemo(()=>payload?buildIntegratedDetails(payload.sheets||{},expectedSourceSheets(year)):null,[payload,year]); const sheetNames=useMemo(()=>payload?Object.keys(payload.sheets||{}):[],[payload]);
  const missingDashboardSheets=expectedSourceSheets(year).filter(name=>!payload?.sheets?.[name]);
  // Safe recovery for older V20 years in which only the analytical report was
  // saved remotely.  Import only missing sheets, never clear existing data.
  const repairDashboardSources=async()=>{
    if(period!=='annual'||periodBusy||dirty||pendingCellsRef.current.size||pendingSheetsRef.current.size){setToast('Selesaikan penyimpanan dan pilih periode Tahunan terlebih dahulu.');return;}
    if(!window.confirm(`Lengkapi ${missingDashboardSheets.length} sheet sumber Dashboard untuk TA ${year} dari template Excel resmi? Sheet yang sudah ada TIDAK akan ditimpa.`))return;
    setPeriodBusy(true);
    try{
      const current=await fetchState(year,'annual');
      const template=await fetchTemplate();
      if(!template?.payload?.sheets)throw new Error('Template resmi belum tersedia.');
      const source=normalizePayloadForYear(template.payload,year);
      const liveSheets=current.needsImport?{}:(current.payload?.sheets||{});
      const missing=Object.entries(source.sheets||{}).filter(([name])=>!liveSheets[name]).map(([name,sh])=>({...clone(sh),name}));
      if(!missing.length){setToast('Semua sumber Dashboard sudah tersedia.');return;}
      await importSheets(missing,year,'replace','annual');
      const refreshed=await fetchState(year,'annual');
      if(!refreshed?.ok)throw new Error('Gagal memverifikasi hasil impor.');
      const fresh=recalculatePayload(ensureMonevReport(refreshed.payload,year).payload);
      setPayload(fresh);setBaseline(clone(fresh));setYears(v=>({...v,[year]:fresh}));setDirty(false);pendingSheetsRef.current.clear();pendingCellsRef.current.clear();setSaveError('');
      const left=expectedSourceSheets(year).filter(name=>!fresh.sheets?.[name]);
      setToast(left.length?`Masih ada ${left.length} sumber yang perlu diperiksa.`:`Seluruh ${expectedSourceSheets(year).length} sumber Dashboard TA ${year} sudah tersedia di Google Sheets pusat.`);
    }catch(e){setToast('Pemulihan sumber gagal: '+e.message);}finally{setPeriodBusy(false);}
  };
  if(!payload||year===null)return <div className="loading"><div className="loading-orb"></div><div>{toast||"Memuat database kertas kerja…"}</div>{toast&&<button onClick={()=>window.location.reload()}>Coba lagi</button>}</div>;
  const update=(fn,sheetName=null,fastCell=null)=>{
    setPayload(prev=>{
      const next=fastCell&&sheetName&&prev?.sheets?.[sheetName]
        ? {...prev,sheets:{...prev.sheets,[sheetName]:{...prev.sheets[sheetName],
           values:prev.sheets[sheetName].values.map((row,idx)=>idx===fastCell.r?[...row]:row),
           formulas:{...(prev.sheets[sheetName].formulas||{})},
           formattedValues:prev.sheets[sheetName].formattedValues?.map((row,idx)=>idx===fastCell.r?[...row]:row)}}}
        : clone(prev);
      fn(next);
      if(sheetName)applyAutoCalculations(next,sheetName);
      if(sheetName==='Monev Renaksi IKU' || sheetName===MONEV_REPORT_SHEET){
        const ensured=ensureMonevReport(next,year);
        next.sheets=ensured.payload.sheets;
        next.meta=ensured.payload.meta;
      }
      return next;
    });
    if(sheetName && !fastCell){ const prevVersion=pendingSheetsRef.current.get(sheetName)||0; pendingSheetsRef.current.set(sheetName,prevVersion+1); }
    if(false){ const prevVersion=pendingSheetsRef.current.get(MONEV_REPORT_SHEET)||0; pendingSheetsRef.current.set(MONEV_REPORT_SHEET,prevVersion+1); }
    if(fastCell){
      const key=`${sheetName}!${addr(fastCell.r,fastCell.c)}`;
      const version=(cellVersionsRef.current.get(key)||0)+1;
      cellVersionsRef.current.set(key,version);
      pendingCellsRef.current.set(key,{key,name:sheetName,row:fastCell.r,col:fastCell.c,value:fastCell.v,grid:payload.sheets[sheetName]?.grid,version});
    }
    editVersionRef.current++;
    setDirty(true);
  }; const logout=async()=>{await adminLogout().catch(()=>{});window.location.reload();}; const updateCell=(sheet,r,c,v)=>{
    
    update(p=>{const s=p.sheets[sheet];while(s.values.length<=r)s.values.push([]);s.values[r][c]=v;s.formulas=s.formulas||{};if(typeof v==='string'&&v.startsWith('='))s.formulas[addr(r,c)]=v;else delete s.formulas[addr(r,c)];if(s.formattedValues?.[r])s.formattedValues[r][c]=undefined;},sheet,{r,c,v});
  };
  const updateCellsBatch=(name,changes)=>{
    setPayload(prev=>{
      const old=prev.sheets[name], values=old.values.slice(), touched=new Set(changes.map(x=>x.r));
      for(const r of touched)values[r]=[...(values[r]||[])];
      const formattedValues=old.formattedValues?.slice();
      if(formattedValues)for(const r of touched)if(formattedValues[r])formattedValues[r]=[...formattedValues[r]];
      const s={...old,values,formulas:{...(old.formulas||{})},formattedValues};
      for(const x of changes){while(s.values.length<=x.r)s.values.push([]);s.values[x.r][x.c]=x.value;const a=addr(x.r,x.c);if(typeof x.value==='string'&&x.value.startsWith('='))s.formulas[a]=x.value;else delete s.formulas[a];if(s.formattedValues?.[x.r])s.formattedValues[x.r][x.c]=undefined;}
      return {...prev,sheets:{...prev.sheets,[name]:s}};
    });
    for(const x of changes){const key=`${name}!${addr(x.r,x.c)}`,version=(cellVersionsRef.current.get(key)||0)+1;cellVersionsRef.current.set(key,version);pendingCellsRef.current.set(key,{key,name,row:x.r,col:x.c,value:x.value,grid:payload.sheets[name]?.grid,version});}editVersionRef.current++;setDirty(true);
  };
  const reloadWorkbook=async()=>{const resp=await fetchState(year,period);setOfficialReportMissing(Boolean(resp.officialMonevMissing)&&!resp.needsImport);if(!resp.ok||!resp.payload?.sheets)throw new Error(resp.message||'Gagal memuat ulang');setPayload(resp.payload);setYears(prev=>({...prev,[year]:resp.payload}));setBaseline(clone(resp.payload));return resp.payload;};
  const structure=async(operation)=>{
    if(dirty||savingRef.current||cellSavingRef.current)throw new Error('Tunggu sampai perubahan tersimpan, lalu ulangi.');
    savingRef.current=true;
    try{monitorSync(await changeStructure({...operation,grid:payload.sheets[operation.name]?.grid},year,period),'Perubahan struktur');const p=await reloadWorkbook();setToast('Struktur diperbarui; referensi rumus mengikuti Google Sheets.');return p;}
    finally{savingRef.current=false;}
  };
  // Tempel dari Excel dapat menambah dimensi sheet tanpa mengubah rumus yang sudah ada.
  // Dua tahap: perluasan struktur dan penulisan; jika penulisan gagal, data tidak
  // dilaporkan tersimpan dan editor dimuat ulang supaya pengguna tidak salah paham.
  const pasteExpand=async(name,changes,requiredRows,requiredCols)=>{
    if(dirty||savingRef.current||cellSavingRef.current)throw new Error('Tunggu hingga perubahan lain tersimpan, lalu ulangi tempel.');
    const meta=payload.sheets[name]?.grid;
    if(!meta)throw new Error('Ukuran sheet master tidak tersedia. Muat ulang data.');
    savingRef.current=true;
    try{
      let rowCount=Number(meta.rowCount||0),columnCount=Number(meta.columnCount||0),grid={...meta};
      for(let missing=requiredRows-rowCount;missing>0;){
        const count=Math.min(100,missing);
        monitorSync(await changeStructure({name,dimension:'ROWS',action:'insert',index:rowCount,count,copy:'none',grid},year,period),'Penambahan baris untuk tempel');
        rowCount+=count;grid={...grid,rowCount};missing-=count;
      }
      for(let missing=requiredCols-columnCount;missing>0;){
        const count=Math.min(100,missing);
        monitorSync(await changeStructure({name,dimension:'COLUMNS',action:'insert',index:columnCount,count,copy:'none',grid},year,period),'Penambahan kolom untuk tempel');
        columnCount+=count;grid={...grid,columnCount};missing-=count;
      }
      for(let i=0;i<changes.length;i+=500){
        const batch=changes.slice(i,i+500).map(x=>({name,row:x.r,col:x.c,value:x.value}));
        monitorSync(await saveCells(batch,year,period),'Tempel data master');
      }
      await reloadWorkbook();
      setToast(`${changes.length} sel berhasil ditempel dan struktur sheet disesuaikan.`);
    }catch(e){await reloadWorkbook().catch(()=>{});throw new Error(`Tempelan belum lengkap: ${e.message}. Periksa hasil sebelum mengulang, jangan tempel dua kali tanpa melihat master.`);}
    finally{savingRef.current=false;}
  };
  const addRow=async(sheet,values,index)=>{try{const at=index??payload.sheets[sheet].values.length;await structure({name:sheet,dimension:'ROWS',action:'insert',index:at,count:1,copy:'formula'});monitorSync(await saveCells(values.map((v,c)=>({name:sheet,row:at,col:c,value:v})).filter(x=>x.value!==''),year,period),'Penambahan baris');await reloadWorkbook();}catch(e){setToast(e.message);}};
  const deleteRow=async(sheet,row)=>{if(!window.confirm('Hapus baris ini? Referensi ke sel yang dihapus dapat menjadi #REF!.'))return;try{await structure({name:sheet,dimension:'ROWS',action:'delete',index:row});}catch(e){setToast(e.message);}};
  const duplicateRow=async(sheet,row)=>{try{await structure({name:sheet,dimension:'ROWS',action:'duplicate',index:row});}catch(e){setToast(e.message);}};
  const useTemplate=async()=>{try{
    const url='/api/admin/workbook-template';
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error(`Template Excel tidak ditemukan (HTTP ${response.status})`);
    const blob=await response.blob();const p=await parseExcelWorkbook(new File([blob],'2026_Kertas_Kerja_Inspektorat_Mahakam_Ulu_SESUAI_FORMAT.xlsx'));
    const mapping=buildSchemaMapping(p,payload);
    setImportModal({fileName:p.source,payload:p,year:2026,sheets:Object.keys(p.sheets).length,mapping,preview:buildPreviewRows(p,payload),validation:validateImportPlan(p,payload,'replace',mapping,{preserveFormat:true}),preserveFormat:true});
  }catch(e){setToast(e.message);}};
  const persistYears=async(nextPayload=payload,nextYear=year,nextYears=years)=>{
    const ensured=ensureMonevReport(nextPayload,nextYear);
    const normalized=recalculatePayload(clone(ensured.payload));
    const before=nextYears?.[nextYear]||payload;
    const diff=payloadDiffSummary(before,normalized);
    const store={...nextYears,[nextYear]:normalized};
    try{
      const entries=Object.entries(normalized.sheets||{});
      if(entries.length)monitorSync(await importSheets(entries.map(([name,sheet])=>({...clone(sheet),name})),nextYear,'replace',period),'Penyimpanan workbook');
      for(const [name] of entries)pendingSheetsRef.current.delete(name);
    }catch(err){
      setToast('Gagal menyimpan ke server: '+err.message);
      throw err;
    }
    if(diff.cellsChanged||diff.rowsAdded||diff.rowsRemoved)writeAudit(makeAuditEntry('SAVE_EDIT',{year:nextYear,...diff}));
    pendingCellsRef.current.clear();pendingSheetsRef.current.clear();
    setYears(store);setPayload(normalized);setDirty(false);
    setToast(`Data TA ${nextYear} tersimpan di database pusat`);
  }; const save=async()=>{
    saveBlockedRef.current=false;setSaveError('');
    if(cellSavingRef.current||savingRef.current)return setToast('Penyimpanan otomatis sedang berlangsung; tunggu sampai selesai.');
    if(pendingCellsRef.current.size && !pendingSheetsRef.current.size){
      cellSavingRef.current=true;
      const sent=[...pendingCellsRef.current.values()].map(x=>({...x,version:cellVersionsRef.current.get(x.key)||0}));
      try{
        for(let i=0;i<sent.length;i+=500){const part=sent.slice(i,i+500);monitorSync(await saveCells(part.map(({key,version,...x})=>x),year,period),'Simpan sel');}
        for(const x of sent)if(cellVersionsRef.current.get(x.key)===x.version)pendingCellsRef.current.delete(x.key);
        if(!pendingCellsRef.current.size){setDirty(false);setToast('Sel berhasil disimpan ke Google Sheets.');}
      }catch(e){saveBlockedRef.current=true;setSaveError('Gagal menyimpan: '+e.message);}finally{cellSavingRef.current=false;}
      return;
    }
    if(!pendingSheetsRef.current.size){setToast('Semua perubahan sudah tersimpan.');return;}
    // A full-sheet update is needed only for actions that changed the sheet structure.
    savingRef.current=true;
    const entries=[...pendingSheetsRef.current.entries()];
    try{
      if(entries.length>1){
        // One Google Sheets import transaction instead of one HTTP round-trip
        // per modified tab, important after a large Excel-driven edit.
        const changed=entries.map(([name])=>({...clone(payload.sheets[name]),name}));
        monitorSync(await importSheets(changed,year,'replace',period,true),'Simpan beberapa sheet');
        for(const [name,version] of entries)if(pendingSheetsRef.current.get(name)===version)pendingSheetsRef.current.delete(name);
      }else{
        for(const [name,version] of entries){monitorSync(await saveSheet(clone(payload.sheets[name]),year,{period}),'Simpan sheet');if(pendingSheetsRef.current.get(name)===version)pendingSheetsRef.current.delete(name);}
      }
      if(!pendingSheetsRef.current.size&&!pendingCellsRef.current.size)setDirty(false);
      setToast('Perubahan sheet tersimpan.');
    }catch(e){saveBlockedRef.current=true;setSaveError('Gagal menyimpan sheet: '+e.message)}finally{savingRef.current=false;}
  };
  const reset=async()=>{const base=baseline?normalizePayloadForYear(baseline,year):null;if(!base)return;const current=recalculatePayload(base);await persistYears(current,year,years);setToast(`TA ${year} dikembalikan ke sumber awal`)};
  const exportJson=()=>downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`database-realisasi-kinerja-${year}.json`); const exportAllYears=()=>downloadBlob(new Blob([JSON.stringify({years:{...years,[year]:payload}},null,2)],{type:'application/json'}),'database-realisasi-kinerja-semua-tahun.json');
  const importJson=e=>{const f=e.target.files?.[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(x?.years){const ys=x.years;const first=Number(Object.keys(ys).sort()[0]);const cur=recalculatePayload(ys[first]);setYears(ys);setYear(first);setPayload(cur)}else if(x?.sheets){const y=yearFromPayload(x);const cur=recalculatePayload(x);setYears(prev=>({...prev,[y]:cur}));setYear(y);setPayload(cur)}else throw new Error();setDirty(true);setToast('JSON berhasil diimpor')}catch{setToast('Import JSON gagal: format tidak valid')} };rd.readAsText(f);e.target.value=''};
  const onExcelSelected=e=>{const f=e.target.files?.[0];if(!f)return;parseExcelWorkbook(f).then(prepared=>{const mapping=buildSchemaMapping(prepared,payload);const preview=buildPreviewRows(prepared,payload,mapping);const validation=validateImportPlan(prepared,payload,'replace',mapping,{preserveFormat:true});setImportModal({fileName:f.name,payload:prepared,year:yearFromPayload(prepared),sheets:Object.keys(prepared.sheets||{}).length,mapping,preview,validation,preserveFormat:true});}).catch(err=>setToast('Import Excel gagal: '+err.message));e.target.value=''};
  const commitImported=async(mode, preserveFormat=true)=>{
    const p=importModal?.payload;
    if(!p?.sheets || importBusy)return;
    if(dirty || savingRef.current || cellSavingRef.current || pendingCellsRef.current.size || pendingSheetsRef.current.size){
      setToast('Selesaikan penyimpanan perubahan lokal sebelum mengimpor, agar tidak terjadi data tertimpa.');return;
    }
    const detected=Number(importModal.year); let targetYear=mode==='newyear'?detected:year;
    setImportBusy(true);savingRef.current=true;setSaveError('');setSyncNotice('');
    try{
      const mapping=importModal.mapping||buildSchemaMapping(p,payload);
      const validation=importModal.validation;
      if(!validation.ok)throw new Error(validation.errors.join(' '));
      const importedPrepared=prepareImportedForMode(p,payload,mapping,mode,targetYear);
      const nextPayload=ensureMonevReport(importedPrepared,targetYear).payload;
      // Import only sheets actually present in the selected Excel file. The old
      // implementation sent all 16 sheets (including old analytical sheets),
      // multiplying Google writes and risking overwriting unrelated changes.
      const affected=new Set(mapping.filter(m=>m.actual && (p.sheets[m.actual].rows || mode==='newyear' || !payload.sheets[m.expected||m.actual])).map(m=>{const name=m.expected||m.actual;return mode==='newyear'&&isOfficialReportName(name)?officialReportName(targetYear):name;}));
      const sheetEntries=Object.entries(nextPayload.sheets||{}).filter(([name])=>affected.has(name));
      if(!sheetEntries.length)throw new Error('Tidak ada sheet Excel yang cocok untuk diperbarui.');
      await saveImportBackup(year,payload,years);
      if(preserveFormat && p._templateBase64) await saveTemplateBase64(
        p._templateBase64,{source:p.source,year:targetYear,sheetNames:Object.keys(p.sheets||{})}
      );
      const total=sheetEntries.length;
      setToast(`Menulis ${total} sheet sumber ke Google Sheets…`);
      const importResult=await importSheets(sheetEntries.map(([name,sheet])=>({...sheet,name})),targetYear,mode,period,preserveFormat);
      const fresh=await fetchState(targetYear,period);if(!fresh.ok||fresh.needsImport)throw new Error(fresh.message||'Data tidak terbaca sesudah impor.');
      const affectedErrors=[];
      for(const [name,expected] of sheetEntries){
        const sheet=fresh.payload?.sheets?.[name];
        if(!sheet){affectedErrors.push(`${name}: tidak terbaca sesudah impor`);continue;}
        for(const cell of Object.keys(expected.formulas||{})){
          if(!sheet.formulas?.[cell] && affectedErrors.length<12)affectedErrors.push(`${name}!${cell}: rumus belum terbaca`);
        }
        for(const cell of Object.keys(sheet.formulas||{})){
          const point=XLSX.utils.decode_cell(cell);
          const current=sheet.values?.[point.r]?.[point.c];
          if(isError(current) && affectedErrors.length<12)affectedErrors.push(`${name}!${cell} (${current})`);
        }
      }
      setOfficialReportMissing(Boolean(fresh.officialMonevMissing)&&!fresh.needsImport);
      const store={...years,[targetYear]:fresh.payload};
      setYears(store);setYear(targetYear);setPayload(fresh.payload);setBaseline(clone(fresh.payload));setDirty(false);
      pendingSheetsRef.current.clear();pendingCellsRef.current.clear();cellVersionsRef.current.clear();remoteRevisionRef.current='';
      writeAudit(makeAuditEntry(affectedErrors.length?'IMPORT_WITH_FORMULA_ERRORS':'IMPORT_EXCEL',{file:p.source,mode,targetYear,sheetCount:total,stats:importSchemaStats(mapping),formulaAudit:validation.audit,preserveFormat,affectedErrors}));
      setImportModal(null);
      if(affectedErrors.length){
        setSyncNotice(`Impor telah tersimpan tetapi hasil pemeriksaan menunjukkan masalah rumus: ${affectedErrors.join(' • ')}. Jangan impor ulang tanpa memeriksa bagian ini. Data pusat sudah berubah; tidak ada rollback otomatis.`);
        setToast(`Impor selesai dengan ${affectedErrors.length} masalah rumus. Lihat peringatan di atas.`);
      }else if(importResult?.sync?.published===false){
        setSyncNotice('Impor sudah tersimpan, tetapi penanda revisi otomatis untuk Dashboard SIKAP tidak terpublikasi. Dashboard masih dapat memuat ulang dari Google Sheets. Periksa bahwa kedua website mengakses spreadsheet yang sama dan izin Google Editor.');
        setToast(`Impor ${total} sheet tersimpan, namun penanda sinkronisasi perlu diperiksa.`);
      }else setToast(`Import berhasil, ${total} sheet diperbarui dan penanda revisi ${importResult?.sync?.published?'diperbarui':'belum terkonfirmasi'}.`);
    }catch(err){
      // A failed network call does not prove that Google rolled back: do not
      // falsely mark the old local snapshot as safely restored remotely.
      writeAudit(makeAuditEntry('IMPORT_FAILED',{error:String(err?.message||err),year:targetYear}));
      setSaveError(`Import belum terverifikasi: ${err?.message||'Koneksi database pusat terputus.'}. Muat ulang data Google Sheets sebelum mengulang agar tidak menimpa perubahan.`);
      setToast(`Import belum dapat dikonfirmasi: ${err?.message||'Periksa koneksi.'}`);
    }finally{savingRef.current=false;setImportBusy(false);}
  };
  const rollbackLastImport=async()=>{const b=await loadImportBackup();if(!b)return setToast('Tidak ada backup import yang tersedia');const restored=recalculatePayload(clone(b.payload));setYears(b.years);setYear(b.year);setPayload(restored);pendingSheetsRef.current.clear();setDirty(true);try{await persistYears(restored,b.year,b.years);writeAudit(makeAuditEntry('ROLLBACK_IMPORT',{restoredYear:b.year,backupAt:b.at}));setToast(`Import terakhir dibatalkan; TA ${b.year} dipulihkan`)}catch(e){setToast(`Rollback lokal siap, tetapi sinkronisasi server gagal: ${e.message}`)}};
  const exportAudit=()=>downloadBlob(new Blob([JSON.stringify(readAudit(),null,2)],{type:'application/json'}),`audit-perubahan-${year}.json`);
  const switchYear=async y=>{
    y=Number(y);if(!years[y])return;
    if(dirty||cellSavingRef.current||savingRef.current||pendingCellsRef.current.size||pendingSheetsRef.current.size)return setToast('Selesaikan autosave sebelum berpindah tahun.');
    try{
      const resp=await fetchState(y,'annual');if(!resp?.ok)throw new Error(resp?.message||'Gagal memuat TA');setOfficialReportMissing(Boolean(resp.officialMonevMissing)&&!resp.needsImport);
      const ensured=ensureMonevReport(recalculatePayload(resp.payload),y);const next=recalculatePayload(ensured.payload);
      setYear(y);setPeriod('annual');setPeriodMissing(false);setPayload(next);setBaseline(clone(next));setYears(prev=>({...prev,[y]:next}));
      setSelectedRow(null);setQuery('');remoteRevisionRef.current='';
      setDirty(Boolean(ensured.changed));if(ensured.changed)pendingSheetsRef.current.set(MONEV_REPORT_SHEET,1);
      setToast(`Beralih ke TA ${y}`);
    }catch(e){setToast(e.message)}
  };
  const selectPeriod=async nextPeriod=>{
    if(nextPeriod===period)return;
    if(dirty||cellSavingRef.current||savingRef.current||pendingCellsRef.current.size||pendingSheetsRef.current.size)return setToast('Tunggu status TERSIMPAN sebelum mengganti periode.');
    setPeriodBusy(true);
    try{
      const resp=await fetchState(year,nextPeriod);if(!resp?.ok)throw new Error(resp?.message||'Periode tidak tersedia');setOfficialReportMissing(Boolean(resp.officialMonevMissing)&&!resp.needsImport);
      const current=recalculatePayload(ensureMonevReport(resp.payload,year).payload);
      setPayload(current);setBaseline(clone(current));setPeriod(nextPeriod);setPeriodMissing(Boolean(resp.needsImport&&nextPeriod!=='annual'));
      setDirty(false);setSaveError('');saveBlockedRef.current=false;remoteRevisionRef.current='';setSelectedRow(null);setQuery('');
      const url=new URL(window.location.href);url.searchParams.set('period',nextPeriod);url.searchParams.set('year',year);history.replaceState(null,'',url);
      setToast(resp.needsImport?`Periode ${nextPeriod} belum dibuat. Salin data tahunan untuk mulai.`:`Periode ${nextPeriod} ditampilkan.`);
    }catch(e){setToast('Tidak dapat membuka periode: '+e.message)}finally{setPeriodBusy(false)}
  };
  const initializePeriod=async()=>{
    if(!periodMissing||periodBusy)return;
    if(!window.confirm('Buat snapshot periode dari seluruh sheet TA utama? Data periode akan terpisah dan bisa diedit sendiri.'))return;
    setPeriodBusy(true);
    try{
      const annual=await fetchState(year,'annual');if(!annual?.ok||annual.needsImport)throw new Error('Impor Excel untuk tahun utama terlebih dahulu.');
      const source=Object.entries(annual.payload.sheets||{}).map(([name,sheet])=>({...clone(sheet),name}));
      if(!source.length)throw new Error('Tidak ada sheet sumber untuk disalin.');
      await importSheets(source,year,'replace',period);
      const loaded=await fetchState(year,period);if(!loaded?.ok||loaded.needsImport)throw new Error('Periode belum berhasil diinisialisasi.');
      setPayload(recalculatePayload(loaded.payload));setBaseline(clone(loaded.payload));setPeriodMissing(false);setDirty(false);remoteRevisionRef.current='';
      setToast(`Snapshot ${period} dibuat dari tahun utama. Perubahan berikutnya disimpan terpisah.`);
    }catch(e){setToast('Gagal membuat periode: '+e.message)}finally{setPeriodBusy(false)}
  };

  // Creating a year must PUBLISH every sheet to Google Sheets before showing
  // the new year as saved. V20 changed only the in-memory year plus one pending
  // analytical sheet, leaving public SIKAP unable to locate 2027's 14 sources.
  const publishYear=async(targetYear,mode='copy')=>{
    const y=Number(targetYear);
    if(period!=='annual')return setToast('Buat tahun baru pada periode Tahunan terlebih dahulu.');
    if(!Number.isInteger(y)||y<2000||y>2100||years[y]||periodBusy)return setToast('Tahun tidak valid, sedang diproses atau sudah tersedia.');
    if(dirty||pendingCellsRef.current.size||pendingSheetsRef.current.size||savingRef.current||cellSavingRef.current)return setToast('Selesaikan penyimpanan TA aktif sebelum membuat tahun baru.');
    setPeriodBusy(true);setToast(`Menyiapkan seluruh sheet TA ${y} pada Google Sheets pusat…`);
    try{
      // Never overwrite an existing year that another operator already made.
      const existing=await fetchState(y,'annual');
      const currentNames=new Set(existing.needsImport?[]:Object.keys(existing.payload?.sheets||{}));
      const next=mode==='blank'?blankDataRows(payload,y):normalizePayloadForYear(payload,y);
      const prepared=recalculatePayload(ensureMonevReport(next,y).payload);
      // Old V20 may have created only the analytical sheet. Add the absent
      // sources without overwriting anything already saved for the target year.
      const sheetEntries=Object.entries(prepared.sheets||{}).filter(([name])=>!currentNames.has(name)).map(([name,sheet])=>({...clone(sheet),name}));
      if(!sheetEntries.length)throw new Error(`TA ${y} sudah tersedia lengkap di Google Sheets pusat. Buka tahun tersebut, jangan timpa data yang sudah ada.`);
      await importSheets(sheetEntries,y,'replace','annual');
      const loaded=await fetchState(y,'annual');
      if(loaded.needsImport||!loaded.payload?.sheets||Object.keys(loaded.payload.sheets).length<Math.min(14,sheetEntries.length))throw new Error('Publikasi TA baru tidak lengkap. Periksa Google Sheets sebelum melanjutkan.');
      const fresh=recalculatePayload(loaded.payload);
      setYears(prev=>({...prev,[y]:fresh}));setYear(y);setPeriod('annual');setPayload(fresh);setBaseline(clone(fresh));
      pendingCellsRef.current.clear();pendingSheetsRef.current.clear();cellVersionsRef.current.clear();
      remoteRevisionRef.current='';setDirty(false);setSaveError('');setPeriodMissing(false);setYearModal(false);setYearEditModal(false);
      const url=new URL(window.location.href);url.searchParams.set('year',String(y));url.searchParams.set('period','annual');history.replaceState(null,'',url);
      setToast(`Seluruh ${Object.keys(fresh.sheets).length} sheet TA ${y} sudah tersedia di Google Sheets pusat; Dashboard SIKAP dapat membacanya.`);
    }catch(e){setToast(`TA ${y} belum berhasil dipublikasikan: ${e.message}`);}
    finally{setPeriodBusy(false);}
  };
  const createYear=(targetYear,mode)=>publishYear(targetYear,mode);
  const renameYearData=(oldYear,newYear)=>{
    // Changing a label alone does NOT rename actual Google Sheets tabs. Make a
    // new published year instead; keep the old year for audit and backup.
    return publishYear(newYear,'copy');
  };
  const openRowEditor=(sheet,row)=>setRowModal({sheet,row}); const commitRowEditor=(sheet,row,values)=>{values.forEach((v,c)=>{if(!payload.sheets[sheet].formulas?.[addr(row,c)]&&v!==payload.sheets[sheet].values[row]?.[c])updateCell(sheet,row,c,v);});setRowModal(null)};
  const exportActiveExcel=()=>exportExcelPayload(payload,year); const exportSheetExcel=()=>exportExcelPayload(payload,year,selectedSheet);
  const nav=[['dashboard','✦','Dashboard'],['realisasi','◒','Realisasi'],['kinerja','◫','Kinerja'],['renaksi','◇','Monev Renaksi'],['penugasan','◎','Penugasan'],['terpadu','▤','Analitik 28 Sheet'],['kertas','▦','Kertas Kerja'],['editor','✎','Edit & Input']];
  return <div className="app"><div className="ambient ambient-1"></div><div className="ambient ambient-2"></div><div className="ambient ambient-3"></div><div className="noise"></div>{officialReportMissing&&year===2026&&period==='annual'&&<div className="official-import-banner" role="status"><span><strong>Excel baru: laporan Monev resmi belum ada di Google Sheets.</strong> Tambahkan satu sheet resmi tanpa mengubah 14 sheet lain atau laporan analitik otomatis.</span><button disabled={reportInstalling||dirty} onClick={installOfficialReport}>{reportInstalling?'Memproses…':'Tambahkan Laporan Resmi'}</button></div>}<header className="topbar"><button className="menu-toggle" onClick={()=>setSidebarOpen(v=>!v)}>☰</button><div className="brand"><div className="brand-mark">ID</div><div><strong>{ORG}</strong><span>DATABASE REALISASI KINERJA • KERTAS KERJA & MONITORING</span></div></div><div className="top-right"><span className="live"><i></i> BACKEND • SECURE</span><button className={dirty?'save-badge dirty year-btn':'save-badge year-btn'} onClick={()=>setYearModal(true)}>{dirty?'MENYIMPAN…':'TERSIMPAN'}</button><button className="year year-btn" disabled={periodBusy} onClick={()=>setYearModal(true)}>TA {year} ▾</button>
    <label className="period-select"><span>Periode</span><select aria-label="Periode laporan" disabled={periodBusy} value={period} onChange={e=>selectPeriod(e.target.value)}>{PERIOD_OPTIONS.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select></label><a className="soft" href={import.meta.env.VITE_DASHBOARD_URL||"https://sikapinspektoratkabmahakamulu.pages.dev"} target="_blank" rel="noopener noreferrer">Dashboard ↗</a><a className="soft" href="/api/admin/diagnostics" target="_blank" rel="noopener noreferrer" title="Bandingkan fingerprint spreadsheet dengan diagnostik Dashboard SIKAP">Diagnostik master ↗</a><button className="soft logout-btn" onClick={logout} title="Keluar dari sesi">Keluar</button></div></header><aside className={`sidebar ${sidebarOpen?'open':''}`}><div className="side-heading">KERTAS KERJA & MONITORING</div>{nav.map(([id,ic,label])=><button key={id} className={active===id?'nav active':'nav'} onClick={()=>{setActive(id);setSidebarOpen(false)}}><span>{ic}</span><b>{label}</b></button>)}<div className="side-summary"><small>{sheetNames.length} SHEET TERHUBUNG</small><strong>{ORG}</strong><em>Tahun aktif: {year} • {dirty?'Perubahan belum disimpan':'Siap dipantau'}</em></div></aside><main className="main">{period==='annual'&&missingDashboardSheets.length>0&&<section className="year-missing-banner" role="status"><div><strong>{missingDashboardSheets.length} dari {expectedSourceSheets(year).length} sheet sumber Dashboard belum ada pada TA {year}.</strong><p>Tahun mungkin baru tersimpan sebagian. Lengkapi hanya sheet yang hilang dari template Excel resmi, tanpa menimpa sheet yang sudah diisi.</p><small>{missingDashboardSheets.join(' • ')}</small></div><button className="primary" disabled={periodBusy||dirty} onClick={repairDashboardSources}>{periodBusy?'Memeriksa…':'Lengkapi sheet yang hilang'}</button></section>}{syncNotice&&<section className="save-error-alert" role="status"><div><strong>Data sudah tersimpan — verifikasi sinkronisasi / rumus diperlukan.</strong><p>{syncNotice}</p><small>Jangan lakukan impor ulang hanya karena penanda sinkronisasi gagal; cek data pusat terlebih dahulu.</small></div><button className="soft" onClick={()=>setSyncNotice('')}>Tutup</button><a href="/api/admin/diagnostics" target="_blank" rel="noopener noreferrer">Diagnostik master</a></section>}{saveError&&<section className="save-error-alert" role="alert"><div><strong>Perubahan belum tersimpan di Google Sheets.</strong><p>{saveError}</p><small>Autosave dihentikan sementara agar server tidak dibanjiri HTTP 503. Jangan menutup tab sebelum masalah diperbaiki. Perubahan lokal masih ada selama tab ini terbuka.</small></div><button className="primary" onClick={retrySave}>Coba simpan lagi</button><a href="/api/admin/diagnostics" target="_blank" rel="noopener noreferrer">Periksa koneksi</a></section>}{periodMissing?<section className="period-empty"><h2>Periode {PERIOD_OPTIONS.find(x=>x.value===period)?.label} belum dibuat</h2><p>Data tiap periode disimpan dalam kelompok sheet Google yang terpisah. Buat snapshot dari tahun anggaran utama sebelum mulai mengisi. Ini bukan agregasi otomatis bulanan.</p><button className="primary" disabled={periodBusy} onClick={initializePeriod}>{periodBusy?'Membuat periode…':'Buat periode dari TA utama'}</button><button className="soft" onClick={()=>selectPeriod('annual')}>Kembali ke data tahunan</button></section>:<>{active==='dashboard'&&<Dashboard derived={derived} integrated={integrated} year={year} onNav={setActive} onInsight={tab=>{if(tab==='pelaksanaan'){setActive('penugasan');return;}setInsightTab(tab);setActive('terpadu')}} onSheet={n=>{setSelectedSheet(n);setActive('kertas')}}/>}{active==='realisasi'&&<Realisasi payload={payload} derived={derived} onEdit={(row=null)=>row===null?setActive('editor'):openRowEditor('Realisasi Fisik & Keu',row)}/>} {active==='kinerja'&&<Kinerja payload={payload} derived={derived} onEdit={(sheet,row=null)=>row===null?(setSelectedSheet(sheet),setActive('editor')):openRowEditor(sheet,row)}/>} {active==='terpadu'&&<section className="page"><div className="integrated-editor-shortcut"><span>Analitik membaca langsung master kertas kerja TA {year}; perubahan input tetap melalui menu Edit & Input.</span><button className="soft" onClick={()=>setActive('kertas')}>Buka seluruh sheet kertas kerja</button></div><IntegratedExplorer key={`${year}-${period}-${insightTab}`} data={integrated} year={year} period={period} initialSection={insightTab}/></section>} {active==='renaksi'&&<MonevRenaksiPage payload={payload} updateCell={updateCell} year={year} dirty={dirty} onOpenSheet={()=>{setSelectedSheet(MONEV_REPORT_SHEET);setActive('editor')}}/>} {active==='penugasan'&&<Penugasan payload={payload} derived={derived} onEdit={(row=null)=>row===null?setActive('editor'):openRowEditor('Rekap realisasi PKPT',row)} onAdd={()=>openRowEditor('Rekap realisasi PKPT','new')}/>} {active==='kertas'&&<KertasKerja payload={payload} derived={derived} selectedSheet={selectedSheet} setSelectedSheet={setSelectedSheet} query={query} setQuery={setQuery} selectedRow={selectedRow} setSelectedRow={setSelectedRow} onEdit={(row=null)=>row===null?setActive('editor'):openRowEditor(selectedSheet,row)} onAdd={()=>openRowEditor(selectedSheet,'new')} onExportSheet={exportSheetExcel} onImportExcel={()=>xlsxRef.current?.click()}/>} {active==='editor'&&<SpreadsheetEditor onCells={updateCellsBatch} onPasteExpand={pasteExpand} payload={payload} selectedSheet={selectedSheet} setSelectedSheet={setSelectedSheet} onStructure={structure} onRefresh={reloadWorkbook} onTemplate={useTemplate} query={query} setQuery={setQuery} updateCell={updateCell} addRow={addRow} deleteRow={deleteRow} duplicateRow={duplicateRow} save={save} reset={reset} exportJson={exportJson} exportAllYears={exportAllYears} importJson={importJson} rollbackLastImport={rollbackLastImport} onAudit={()=>{setAuditEntries(readAudit());setAuditModal(true)}} onImportExcel={()=>xlsxRef.current?.click()} exportExcel={exportActiveExcel} exportSheetExcel={exportSheetExcel} fileRef={fileRef} dirty={dirty} saveError={saveError}/>}</>}</main>{toast&&<div className="toast">{toast}</div>}{yearModal&&<YearManagerModal years={years} activeYear={year} dirty={dirty} onClose={()=>setYearModal(false)} onSwitch={switchYear} onCreate={createYear} onRename={()=>setYearEditModal(true)} onSave={save} onExportAll={exportAllYears}/>} {yearEditModal&&<YearEditModal currentYear={year} onClose={()=>setYearEditModal(false)} onRename={v=>renameYearData(year,Number(v))}/>} {rowModal&&<RowEditorModal payload={payload} sheetName={rowModal.sheet} rowIndex={rowModal.row} onClose={()=>setRowModal(null)} onSave={commitRowEditor} onAdd={(sheet,values)=>{addRow(sheet,values);setRowModal(null)}}/>} {importModal&&<ImportExcelModal info={importModal} busy={importBusy} onClose={()=>setImportModal(null)} onApply={commitImported}/>} {auditModal&&<AuditModal entries={auditEntries} onClose={()=>setAuditModal(false)} onExport={exportAudit}/>} <input hidden ref={xlsxRef} type="file" accept=".xlsx,.xls" onChange={onExcelSelected}/></div>;
}
function Dashboard({ derived, integrated, year, onNav, onSheet, onInsight }) {
  const [pulse, setPulse] = useState(0); const [detail, setDetail] = useState(null);
  useEffect(() => { const t = setInterval(() => setPulse(x => x + 1), 4200); return () => clearInterval(t); }, []);
  const primary = [
    { key: 'budget', t: 'Total Anggaran', v: money(derived.budgetTotal), s: 'Realisasi Fisik & Keu', tone: 'gold', source: 'Realisasi Fisik & Keu' },
    { key: 'financial', t: 'Realisasi Keuangan', v: money(derived.financialTotal), s: 'Akumulasi nilai valid', tone: 'blue', source: 'Realisasi Fisik & Keu' },
    { key: 'financialRate', t: 'Serapan Keuangan', v: pct(derived.financialRate), s: 'Realisasi ÷ Anggaran × 100', tone: 'mint', p: derived.financialRate, source: 'Realisasi Fisik & Keu' },
    { key: 'physical', t: 'Realisasi Fisik Tertimbang', v: pct(derived.physicalRate), s: `${number(derived.physicalRowsCount)} data fisik valid`, tone: 'teal', p: derived.physicalRate, source: 'Realisasi Fisik & Keu' },
    { key: 'pkpt', t: 'Penugasan PKPT', v: number(derived.pkptCount), s: `${derived.done} selesai • ${derived.progress} berjalan • ${derived.pending} belum`, tone: 'violet', source: 'Rekap realisasi PKPT' },
    { key: 'output', t: 'Output Utama', v: number(derived.outputUtama), s: `${number(derived.outputPenunjang)} output penunjang`, tone: 'pink', source: 'Monev output Subkegiatan Utama' }
  ];
  return <section className="page dashboard-page">
    <div className="hero"><div><span className="eyebrow">INSPEKTORAT DAERAH KABUPATEN MAHAKAM ULU • {year}</span><h1>Dashboard <span>Realisasi Kinerja</span></h1><p>Satu pusat kendali untuk membaca capaian kinerja, serapan anggaran, realisasi fisik, PKPT, monitoring evaluasi, dan seluruh kertas kerja.</p><div className="hero-actions"><button className="primary" onClick={() => onNav('editor')}>✎ Edit & Input Data</button><button className="soft" onClick={() => onNav('kertas')}>▦ Lihat Kertas Kerja</button><span className="hero-note">{derived.errorCount ? `${derived.errorCount} sel sumber mengandung error formula` : 'Tidak ada error formula terdeteksi'}</span></div></div><div className={`hero-orbit p${pulse % 3}`}><div className="orbit-ring r1"></div><div className="orbit-ring r2"></div><div className="orbit-core">ID</div><i className="dot d1"></i><i className="dot d2"></i><i className="dot d3"></i></div></div>
    <MasterInsights data={integrated} pkptExecution={derived?.pkptCount} onOpen={onInsight} />
    <div className="kpi-grid">{primary.map((x, i) => <KPI key={i} metricKey={x.key} {...x} onClick={() => setDetail(x.key)} />)}</div>
    <div className="dashboard-grid three"><button type="button" className="panel panel-large panel-button" onClick={() => setDetail('financialRate')}><PanelHead eyebrow="REALISASI" title="Serapan Keuangan" right={pct(derived.financialRate)} /><div className="ring-row"><Ring value={derived.financialRate} /><div className="ring-details"><div><small>ANGGARAN</small><b>{money(derived.budgetTotal)}</b></div><div><small>REALISASI</small><b>{money(derived.financialTotal)}</b></div><div><small>SISA DANA</small><b>{money(Math.max(0, derived.budgetTotal - derived.financialTotal))}</b></div></div></div><span className="panel-click-hint">Klik untuk detail perhitungan ↗</span></button><button type="button" className="panel panel-button" onClick={() => setDetail('physical')}><PanelHead eyebrow="CAPAIAN" title="Profil Fisik" right={`${number(derived.physicalRowsCount)} sampel`} /><Bars values={derived.physicalRowsCount ? [derived.physicalRate, Math.max(0, derived.physicalRate - 7), Math.min(100, derived.physicalRate + 4), Math.max(0, derived.physicalRate - 18), Math.min(100, derived.physicalRate + 1), Math.max(0, derived.physicalRate - 11), Math.min(100, derived.physicalRate + 8), Math.min(100, derived.physicalRate + 2)] : [0, 0, 0, 0, 0, 0, 0, 0]} /><div className="micro-legend"><span>Rendah</span><span>•</span><b>{pct(derived.physicalRate)}</b><span>rata-rata</span></div><span className="panel-click-hint">Klik untuk melihat sampel fisik ↗</span></button><button type="button" className="panel panel-button" onClick={() => setDetail('pkpt')}><PanelHead eyebrow="STATUS PKPT" title="Progress Penugasan" /><Stacked done={derived.done} progress={derived.progress} pending={derived.pending} /><div className="status-list"><StatusRow label="Selesai" value={derived.done} tone="done" /><StatusRow label="Berjalan" value={derived.progress} tone="progress" /><StatusRow label="Belum" value={derived.pending} tone="pending" /></div><span className="panel-click-hint">Klik untuk melihat rincian PKPT ↗</span></button></div>
    <div className="panel section-gap"><PanelHead eyebrow="CAKUPAN KERTAS KERJA" title="Capaian & kelengkapan tiap sumber" right={`${pct(derived.overallCompleteness)} kelengkapan rata-rata`} /><div className="sheet-matrix">{derived.stats.map(s => <button key={s.name} className="sheet-card" onClick={() => onSheet(s.name)}><div className="sheet-card-top"><span>{s.name}</span><b>{pct(s.completeness)}</b></div><div className="mini-meter"><i style={{ width: `${Math.min(100, s.completeness)}%` }}></i></div><small>{s.role}</small><div className="sheet-card-bottom"><span>{number(s.rows)} baris</span><span>{number(s.cols)} kolom</span><em>{s.average === null ? 'Belum ada % capaian' : pct(s.average) + ' capaian'}</em></div></button>)}</div></div>
    <div className="panel section-gap"><PanelHead eyebrow="RINGKASAN KINERJA" title="Indikator utama yang berasal dari seluruh sumber kinerja" /><div className="summary-strip"><Summary value={derived.avgCapaian === null ? '—' : pct(derived.avgCapaian)} label="Rata-rata capaian" note="Gabungan sheet sasaran yang punya target & realisasi" /><Summary value={number(derived.outputUtama)} label="Output utama" note="Aktivitas bertanda # pada monev output utama" /><Summary value={number(derived.pkptCount)} label="Penugasan PKPT" note="Baris penugasan yang memiliki rincian" /><Summary value={pct(derived.overallCompleteness)} label="Kelengkapan database" note="Rata-rata keterisian seluruh sheet" /></div></div>
    {detail && <KPIDetailModal type={detail} derived={derived} onClose={() => setDetail(null)} onNav={onNav} onSheet={onSheet} />}
  </section>;
}

function KPI({ t, v, s, p, tone, onClick, metricKey }) { const isMoney = metricKey === 'budget' || metricKey === 'financial'; return <button type="button" className={`kpi ${tone} ${isMoney ? 'kpi-money' : ''}`} onClick={onClick}><div className="shine"></div><div className="kpi-top"><span>{t}</span><i>↗</i></div>{isMoney ? <div className="money-display" title={v}><span>Rp</span><b>{v.replace(/^Rp\s*/,'')}</b></div> : <strong title={v}>{v}</strong>}<small>{s}</small>{p !== undefined && <div className="meter"><i style={{ width: `${Math.max(0, Math.min(100, p || 0))}%` }}></i></div>}<span className="kpi-click-hint">Klik untuk detail</span></button>; }
function KPIDetailModal({ type, derived, onClose, onNav, onSheet }) {
  const map = {
    budget: { title: 'Total Anggaran', subtitle: 'Total anggaran Inspektorat dari baris total/summary program; detail anak tidak dijumlahkan lagi.', value: money(derived.budgetTotal), tone: 'gold', facts: [['Sumber', 'Realisasi Fisik & Keu'], ['Baris valid', number(derived.physicalRowsCount)], ['Realisasi', money(derived.financialTotal)], ['Sisa dana', money(Math.max(0, derived.budgetTotal - derived.financialTotal))]], action: 'realisasi' },
    financial: { title: 'Realisasi Keuangan', subtitle: 'Total realisasi keuangan dari baris total/summary program; detail anak tidak dijumlahkan lagi.', value: money(derived.financialTotal), tone: 'blue', facts: [['Anggaran', money(derived.budgetTotal)], ['Serapan', pct(derived.financialRate)], ['Sisa dana', money(Math.max(0, derived.budgetTotal - derived.financialTotal))], ['Sumber', 'Realisasi Fisik & Keu']], action: 'realisasi' },
    financialRate: { title: 'Serapan Keuangan', subtitle: 'Realisasi keuangan dibandingkan anggaran pada tahun aktif.', value: pct(derived.financialRate), tone: 'mint', progress: derived.financialRate, facts: [['Rumus', 'Realisasi ÷ Anggaran × 100'], ['Anggaran', money(derived.budgetTotal)], ['Realisasi', money(derived.financialTotal)], ['Sisa', money(Math.max(0, derived.budgetTotal - derived.financialTotal))]], action: 'realisasi' },
    physical: { title: 'Rata-rata Realisasi Fisik', subtitle: 'Rata-rata nilai fisik yang terisi dan valid pada Realisasi Fisik & Keu.', value: pct(derived.physicalRate), tone: 'teal', progress: derived.physicalRate, facts: [['Sampel valid', number(derived.physicalRowsCount)], ['Rata-rata', pct(derived.physicalRate)], ['Sumber', 'Realisasi Fisik & Keu'], ['Bobot terhitung', pct(derived.weightedPhysical)]], action: 'realisasi' },
    pkpt: { title: 'Penugasan PKPT', subtitle: 'Rekap status penugasan yang teridentifikasi pada kertas kerja PKPT.', value: number(derived.pkptCount), tone: 'violet', facts: [['Selesai', number(derived.done)], ['Berjalan', number(derived.progress)], ['Belum', number(derived.pending)], ['Lainnya', number(derived.pkptOther)]], action: 'penugasan' },
    output: { title: 'Output Utama', subtitle: 'Aktivitas output utama yang dikenali dari sheet monitoring output subkegiatan.', value: number(derived.outputUtama), tone: 'pink', facts: [['Output utama', number(derived.outputUtama)], ['Output penunjang', number(derived.outputPenunjang)], ['Sumber utama', 'Monev output Subkegiatan Utama'], ['Sumber penunjang', 'Monev Subkegiatan Penunjang']], action: 'kinerja' }
  };
  const d = map[type]; return <div className="kpi-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className={`kpi-modal ${d.tone}`}><div className="kpi-modal-aura"></div><div className="kpi-modal-head"><div><span className="eyebrow">DETAIL KPI • TAHUN ANGGARAN</span><h2>{d.title}</h2><p>{d.subtitle}</p></div><button className="close" onClick={onClose}>×</button></div><div className="kpi-modal-hero"><div className="kpi-modal-value">{d.value}</div><div className="kpi-modal-orbit"><div className="pulse-ring"></div><div className="pulse-core">{type === 'pkpt' ? 'PKPT' : type === 'output' ? 'OUT' : type === 'physical' ? 'FISIK' : 'KPI'}</div></div></div>{d.progress !== undefined && <div className="kpi-progress"><div><span>TINGKAT CAPAIAN</span><b>{pct(d.progress)}</b></div><div className="progress-track"><i style={{ width: `${Math.min(100, Math.max(0, d.progress))}%` }}></i></div></div>}<div className="kpi-detail-grid">{d.facts.map(([a, b]) => <div key={a}><small>{a}</small><b>{b}</b></div>)}</div><div className="kpi-modal-foot"><button className="soft" onClick={() => { onClose(); onNav(d.action); }}>Buka tampilan terkait</button><button className="primary" onClick={() => { onClose(); onSheet(type === 'pkpt' ? 'Rekap realisasi PKPT' : type === 'output' ? 'Monev output Subkegiatan Utama' : 'Realisasi Fisik & Keu'); }}>Buka kertas kerja</button></div></div></div>;
}
function PageTitle({ eyebrow, title, desc, action, onAction }) { return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div>{action && <button className="soft title-action" onClick={onAction}>✎ {action}</button>}</div>; }
function PanelHead({ eyebrow, title, right }) { return <div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{right !== undefined && <span className="head-right">{right}</span>}</div>; }
function Ring({ value }) { const r = 70; const c = 2 * Math.PI * r; const offset = c * (1 - Math.max(0, Math.min(100, value || 0)) / 100); return <div className="ring"><svg viewBox="0 0 180 180"><circle className="ring-bg" cx="90" cy="90" r={r} /><circle className="ring-fg" cx="90" cy="90" r={r} strokeDasharray={c} strokeDashoffset={offset} /></svg><div><b>{pct(value)}</b><span>SERAPAN</span></div></div>; }
function Bars({ values }) { const max = Math.max(...values, 100); return <div className="bars">{values.map((v, i) => <div className="bar-col" key={i}><div className="bar-track"><i style={{ height: `${Math.max(8, Math.min(100, (v / max) * 100))}%` }}></i></div><span>R{i + 1}</span></div>)}</div>; }
function Stacked({ done, progress, pending }) { const total = Math.max(1, done + progress + pending); return <div className="stacked"><i style={{ width: `${done / total * 100}%` }}></i><i style={{ width: `${progress / total * 100}%` }}></i><i style={{ width: `${pending / total * 100}%` }}></i></div>; }
function StatusRow({ label, value, tone }) { return <div className="status-row"><span><i className={tone}></i>{label}</span><b>{number(value)}</b></div>; }
function Summary({ value, label, note }) { return <div className="summary-item"><strong>{value}</strong><b>{label}</b><small>{note}</small></div>; }

function Realisasi({ payload, derived, onEdit }) {
  const sheet = payload.sheets['Realisasi Fisik & Keu']; const values = sheet?.values || []; const meta = sheetMeta['Realisasi Fisik & Keu']; const headers = headersFor(sheet); const rows = values.slice(meta.dataStart).map((r, i) => ({ r, ri: i + meta.dataStart })).filter(x => x.r.some(v => cleanText(v)));
  return <section className="page"><PageTitle eyebrow="ANALITIK DATABASE" title="Realisasi Fisik & Keuangan" desc="Kertas kerja utama untuk mengubah anggaran, bobot, fisik, realisasi keuangan, dan permasalahan. Kolom hasil dihitung otomatis." action="Edit semua data" onAction={() => onEdit()} /><div className="metric-four"><MetricCard title="Anggaran" value={money(derived.budgetTotal)} note="Total valid" /><MetricCard title="Realisasi" value={money(derived.financialTotal)} note="Total valid" /><MetricCard title="Serapan" value={pct(derived.financialRate)} note="Realisasi ÷ Anggaran" /><MetricCard title="Fisik rata-rata" value={pct(derived.physicalRate)} note={`${number(derived.physicalRowsCount)} sampel`} /></div><div className="panel section-gap"><PanelHead eyebrow="KERTAS KERJA" title="Realisasi Fisik & Keu" right={<button className="primary" onClick={() => onEdit('new')}>＋ Tambah baris</button>} /><div className="reader-guide"><div><b>INPUT SUMBER</b><span>C Anggaran • G Realisasi Keuangan • K Permasalahan</span></div><div><b>OTOMATIS</b><span>D Bobot • E Realisasi Fisik • F Fisik Tertimbang • H % Keuangan • I Keuangan Tertimbang • J Sisa</span></div><div><b>MODE</b><span>Wrap text + edit per baris</span></div></div><DataTable sheetName="Realisasi Fisik & Keu" values={values} headers={headers} start={meta.dataStart} rows={rows} onEdit={(ri) => onEdit(ri)} compact /></div></section>;
}
function MetricCard({ title, value, note }) { return <div className="panel metric-card"><small>{title}</small><strong className="metric-value">{value}</strong><span>{note}</span></div>; }

function Kinerja({ payload, derived, onEdit }) {
  return <section className="page"><PageTitle eyebrow="MONITORING KINERJA" title="Kinerja & Monitoring Evaluasi" desc="Seluruh sumber kinerja ditampilkan per tingkat sasaran. Klik Edit pada baris untuk memperbarui nilai tanpa meninggalkan halaman." /><div className="kinerja-grid">{derived.capaianCards.map(card => <div className="panel" key={card.name}><PanelHead eyebrow={sheetMeta[card.name]?.group || 'CAPAIAN'} title={card.name} right={card.average === null ? 'Belum ada %' : pct(card.average)} /><CapaianMiniTable payload={payload} name={card.name} onEdit={onEdit} /></div>)}<div className="panel"><PanelHead eyebrow="MONEV" title="Monitoring Triwulan" /><MonevSource payload={payload} names={['Monev Renaksi IKU', 'Monev Program', 'Monev output Subkegiatan Utama', 'Monev Subkegiatan Penunjang']} onEdit={onEdit} /></div></div></section>;
}
function CapaianMiniTable({ payload, name, onEdit }) { const s = payload.sheets[name]; if (!s) return null; const meta = {...(sheetMeta[name] || {}),...capaianMeta(s.values||[])}; const headers = headersFor(s); const cols = Math.min(8, s.cols || 0); const rows = (s.values || []).slice(meta.dataStart || 3).map((r, idx) => ({ r, ri: idx + (meta.dataStart || 3) })).filter(({ r }) => r.some(v => cleanText(v))).slice(0, 8); return <div className="mini-table-wrap"><div className="mini-table"><table><thead><tr><th>#</th>{Array.from({ length: cols }, (_, i) => <th key={i}>{colName(i)}<small>{headers[i]}</small></th>)}<th>Aksi</th></tr></thead><tbody>{rows.map(({ r, ri }) => <tr key={ri}><td>{ri + 1}</td>{Array.from({ length: cols }, (_, ci) => <td className="text-wrap" key={ci}>{isError(r?.[ci]) ? <span className="error-cell">{cell(r?.[ci])}</span> : cell(r?.[ci]) || '—'}</td>)}<td><button className="row-edit" onClick={() => onEdit(name, ri)}>✎</button></td></tr>)}</tbody></table></div>{rows.length < (s.values?.length || 0) - (meta.dataStart || 3) && <div className="mini-foot">Menampilkan {rows.length} contoh baris • gunakan Kertas Kerja untuk melihat semuanya</div>}</div>; }
function MonevSource({ payload, names, onEdit }) { return <div className="source-grid">{names.map(n => { const s = payload.sheets[n]; return <button className="source-card" key={n} onClick={() => onEdit(n)}><span className="eyebrow">SUMBER</span><b>{n}</b><small>{number(s?.rows || 0)} baris • {number(s?.cols || 0)} kolom</small><em>↗</em></button>; })}</div>; }

function Penugasan({ payload, derived, onEdit, onAdd }) { const sheet = payload.sheets['Rekap realisasi PKPT']; const values = sheet?.values || []; const headers = headersFor(sheet); const rows = values.map((r, ri) => ({ r, ri })).filter(({ r }) => cleanText(r?.[3])); return <section className="page"><PageTitle eyebrow="REKAP REALISASI PKPT" title="Daftar Penugasan" desc="Setiap penugasan bisa diedit langsung di halaman ini. Tambahkan penugasan baru dengan form yang mengikuti seluruh kolom sumber." action="Edit database" onAction={() => onEdit()} /><div className="metric-four"><MetricCard title="Total" value={number(derived.pkptCount)} note="Penugasan teridentifikasi" /><MetricCard title="Selesai" value={number(derived.done)} note="Sudah / selesai" /><MetricCard title="Berjalan" value={number(derived.progress)} note="Sedang proses" /><MetricCard title="Belum" value={number(derived.pending)} note="Belum / kosong" /></div><div className="panel section-gap"><PanelHead eyebrow="KERTAS KERJA PKPT" title="Daftar Penugasan" right={<button className="primary" onClick={onAdd}>＋ Tambah penugasan</button>} /><div className="task-table"><table><thead><tr>{headers.map((h, i) => <th key={i}>{colName(i)}<small>{h}</small></th>)}<th>Aksi</th></tr></thead><tbody>{rows.map(({ r, ri }) => <tr key={ri}>{Array.from({ length: Math.min(headers.length, 14) }, (_, ci) => <td key={ci} className="text-wrap">{ci === 4 ? <StatusPill value={r?.[ci]} /> : cell(r?.[ci]) || '—'}</td>)}<td className="actions-cell"><button className="row-edit" onClick={() => onEdit(ri)}>✎ Edit</button></td></tr>)}</tbody></table></div></div></section>; }
function StatusPill({ value }) { const v = cleanText(value).toLowerCase(); const c = v === 'sudah' || v.includes('selesai') ? 'done' : v.includes('berjalan') || v.includes('proses') ? 'progress' : 'pending'; return <span className={`pill ${c}`}>{cleanText(value) || 'Belum'}</span>; }

function KertasKerja({payload,selectedSheet,setSelectedSheet,query,setQuery,selectedRow,setSelectedRow,onEdit,onAdd,onExportSheet,onImportExcel}){
 const names=Object.keys(payload.sheets||{}); const sheet=payload.sheets[selectedSheet]; const values=sheet?.values||[]; const headers=headersFor(sheet); const cols=Math.max(sheet?.cols||0,...values.map(r=>r?.length||0),0); const meta=sheetMeta[selectedSheet]||{}; const stat=sheetStats(selectedSheet,sheet); const spec=formulaSpecs[selectedSheet]||{}; const audit=formulaAudit(payload); const rows=values.map((r,ri)=>({r,ri})).filter(({r})=>!query.trim()||r.some(v=>cleanText(v).toLowerCase().includes(query.toLowerCase())));
 useEffect(()=>setSelectedRow(null),[selectedSheet,query,setSelectedRow]);
 return <section className="page"><PageTitle eyebrow="SUMBER DATA & FORMULA" title={`Kertas Kerja • ${names.length} Sheet`} desc="Setiap sheet memiliki peran, kolom input, dan kolom hitungan yang dijelaskan. Edit langsung, tambah baris, atau ekspor sheet aktif ke Excel/Google Sheets." action="Edit sheet ini" onAction={()=>onEdit()}/><div className="workspace"><div className="sheet-list">{names.map(n=>{const st=sheetStats(n,payload.sheets[n]);const active=n===selectedSheet;return <button key={n} className={active?'sheet-select active':'sheet-select'} onClick={()=>setSelectedSheet(n)}><span>{n}</span><small>{number(payload.sheets[n]?.rows||0)} × {number(payload.sheets[n]?.cols||0)}</small><em>{pct(st.completeness)}</em></button>})}</div><div className="sheet-content"><div className="sheet-toolbar"><div><span className="eyebrow">SHEET AKTIF</span><h2>{selectedSheet}</h2><p>{meta.role||'Sumber kertas kerja'} • {number(values.length)} baris • {number(cols)} kolom</p></div><div className="sheet-tools"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari isi sheet…"/><button className="soft" onClick={onAdd}>＋ Tambah</button><button className="soft" onClick={onEdit}>✎ Edit semua</button><button className="soft" onClick={onExportSheet}>⇩ Excel</button><button className="soft" onClick={onImportExcel}>⇧ Import Excel</button></div></div><div className="formula-overview"><div><span className="eyebrow">PERAN SHEET</span><b>{meta.role||'Sumber data'}</b><small>{formulaSpecs[selectedSheet]?.note||'Gunakan sheet sesuai fungsi sumber.'}</small></div><div><span className="eyebrow">INPUT</span><b>{(spec.inputs||[]).join(' • ')||'Semua input'}</b><small>Nilai ini diisi/diimpor dari sumber.</small></div><div><span className="eyebrow">OTOMATIS</span><b>{(spec.computed||[]).join(' • ')||'Tidak ada'}</b><small>Hasil dihitung oleh sistem jika data dasar tersedia.</small></div><div><span className="eyebrow">AUDIT</span><b>{audit.errors?`${audit.errors} error`: 'Bersih'}</b><small>{audit.external} referensi eksternal ditandai untuk audit.</small></div></div><div className="column-strip">{headers.map((h,i)=><div key={i}><b>{colName(i)}</b><span>{h}</span></div>)}</div><DataTable sheetName={selectedSheet} values={values} headers={headers} start={meta.dataStart??3} rows={rows} onEdit={ri=>{setSelectedRow(ri);onEdit(ri)}}/><div className="detail-hint">Klik ✎ untuk edit baris lengkap • teks panjang otomatis wrap • kolom AUTO dihitung sistem.</div>{selectedRow!==null&&values[selectedRow]&&<div className="detail-panel"><PanelHead eyebrow={`BARIS ${selectedRow+1}`} title="Detail baris" right={<button className="soft" onClick={()=>onEdit(selectedRow)}>✎ Edit baris</button>}/><div className="detail-grid">{Array.from({length:cols},(_,ci)=><div key={ci}><small>{colName(ci)} • {headers[ci]}</small><p>{isError(values[selectedRow]?.[ci])?<span className="error-cell">{cell(values[selectedRow]?.[ci])}</span>:cell(values[selectedRow]?.[ci])||'—'}</p></div>)}</div></div>}</div></div></section>;
}
function DataTable({ sheetName, values, headers, start, rows, onEdit, compact = false }) { const cols = headers.length; return <div className={compact ? 'scroll-table reader-table compact' : 'scroll-table reader-table'}><table><thead><tr><th>#</th>{headers.map((h, i) => <th key={i}><span>{colName(i)}</span><small>{h}</small></th>)}<th>Aksi</th></tr></thead><tbody>{rows.map(({ r, ri }) => <tr key={ri}><td>{ri + 1}</td>{Array.from({ length: cols }, (_, ci) => <td key={ci} className="text-wrap">{isError(r?.[ci]) ? <span className="error-cell">{cell(r?.[ci])}</span> : cell(r?.[ci]) || '—'}</td>)}<td><button className="row-edit" onClick={() => onEdit(ri)}>✎</button></td></tr>)}</tbody></table></div>; }

function Editor({payload,selectedSheet,setSelectedSheet,query,setQuery,updateCell,addRow,deleteRow,duplicateRow,save,reset,exportJson,exportAllYears,importJson,rollbackLastImport,onAudit,onImportExcel,exportExcel,exportSheetExcel,fileRef,dirty}){
 const names=Object.keys(payload.sheets); const sheet=payload.sheets[selectedSheet]; const values=sheet?.values||[]; const headers=headersFor(sheet); const cols=Math.max(sheet?.cols||0,...values.map(r=>r?.length||0),0); const [limit,setLimit]=useState(120); const [addOpen,setAddOpen]=useState(false); const [insertAfter,setInsertAfter]=useState('end'); const [activeCols,setActiveCols]=useState([]); const [addValues,setAddValues]=useState({}); const stat=sheetStats(selectedSheet,sheet); const spec=formulaSpecs[selectedSheet]||{};
 useEffect(()=>{setLimit(120);setQuery('');setActiveCols(Array.from({length:cols},(_,i)=>i));setAddValues({})},[selectedSheet,cols,setQuery]); const filtered=useMemo(()=>values.map((r,ri)=>({r,ri})).filter(({r})=>!query.trim()||r.some(v=>cleanText(v).toLowerCase().includes(query.toLowerCase()))).slice(0,limit),[values,query,limit]); const focusCell=e=>{const el=e.currentTarget;requestAnimationFrame(()=>{el.style.height='0px';el.style.height=Math.min(220,Math.max(48,el.scrollHeight))+'px'})}; const openAdd=()=>{setInsertAfter('end');setActiveCols(Array.from({length:cols},(_,i)=>i));setAddValues({});setAddOpen(true)}; const submitAdd=()=>{const row=Array(cols).fill('');activeCols.forEach(i=>row[i]=addValues[i]??'');if(!row.some(v=>cleanText(v)))return setAddOpen(false);addRow(selectedSheet,row,insertAfter==='end'?null:Number(insertAfter)+1);setAddOpen(false)}; const toggleCol=i=>setActiveCols(p=>p.includes(i)?p.filter(x=>x!==i):[...p,i].sort((a,b)=>a-b));
 return <section className="page editor-page"><PageTitle eyebrow="DATA MANAGEMENT" title="Edit & Input Kertas Kerja" desc="Area input utama untuk seluruh sumber kinerja dan Laporan Monev Renaksi. Kolom teks tidak dipotong, formula dijaga otomatis, dan file Excel dapat diimpor untuk memperbarui database."/><div className="editor-top panel"><div className="editor-select"><small>SHEET AKTIF</small><select value={selectedSheet} onChange={e=>setSelectedSheet(e.target.value)}>{names.map(n=><option key={n}>{n}</option>)}</select></div><div className="search-wrap"><small>PENCARIAN</small><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari OPD, program, kegiatan, angka…"/></div><div className="editor-actions"><span className={dirty?'state dirty':'state'}>{dirty?'● Ada perubahan':'● Tersimpan'}</span><button className="soft" onClick={openAdd}>＋ Tambah Baris</button><button className="soft" onClick={exportSheetExcel}>⇩ Excel Sheet</button><button className="soft" onClick={exportExcel}>⇩ Semua Excel</button><button className="soft" onClick={onImportExcel}>⇧ Import Excel</button><button className="soft" onClick={exportJson}>⇩ JSON</button><button className="soft" onClick={exportAllYears}>⇩ Semua Tahun</button><button className="soft" onClick={rollbackLastImport}>↶ Batalkan import</button><button className="soft" onClick={onAudit}>▣ Audit</button><input hidden ref={fileRef} type="file" accept="application/json,.json" onChange={importJson}/><button className="ghost" onClick={reset}>↺ Reset</button><button className="primary" onClick={save}>✓ Simpan</button></div></div><div className="editor-help"><div><b>INPUT</b><span>{(spec.inputs||[]).join(' • ')||'Semua kolom'}</span></div><div><b>AUTO</b><span>{(spec.computed||[]).join(' • ')||'Tidak ada kolom formula'}</span></div><div><b>STATUS</b><span>{pct(stat.completeness)} kelengkapan sheet aktif.</span></div><div><b>EXCEL</b><span>Hasil .xlsx dapat langsung dibuka di Microsoft Excel atau diunggah ke Google Sheets.</span></div></div><div className="panel editor-panel"><div className="editor-meta"><div><span className="eyebrow">INLINE EDITOR</span><b>{selectedSheet}</b><small>{number(values.length)} baris • {number(cols)} kolom • {number(filtered.length)} tampil</small></div><div className="badges"><span className="input-badge">WRAP TEXT</span><span className="wrap-badge">AUTO CALC</span></div></div><div className="scroll-table editor-table"><table><thead><tr><th>#</th>{headers.map((h,i)=><th key={i}><span>{colName(i)}</span><small>{h}</small></th>)}<th>Aksi</th></tr></thead><tbody>{filtered.map(({r,ri})=><tr key={ri}><td className="rownum">{ri+1}</td>{Array.from({length:cols},(_,ci)=>{const v=r?.[ci]??'';const computed=Boolean(sheet?.formulas?.[addr(ri,ci)])||isMonevReportComputedCell(selectedSheet,ri,ci,sheet);return <td key={ci} className={isError(v)?'error-bg':''}>{computed?<input className="cell-input readonly-cell" value={cell(v)} readOnly title="Kolom dihitung otomatis"/>:typeof v==='number'?<input className="cell-input" inputMode="decimal" value={v} onChange={e=>updateCell(selectedSheet,ri,ci,e.target.value)}/>:<textarea className="cell-input text-editor" rows="1" value={cell(v)} onFocus={focusCell} onInput={focusCell} onChange={e=>updateCell(selectedSheet,ri,ci,e.target.value)}/>}</td>})}<td className="row-actions"><button title="Edit sebagai form" onClick={()=>window.dispatchEvent(new CustomEvent('open-row-editor',{detail:{sheet:selectedSheet,row:ri}}))}>✎</button><button title="Duplikat baris" onClick={()=>duplicateRow(selectedSheet,ri)}>⧉</button><button title="Hapus baris" onClick={()=>deleteRow(selectedSheet,ri)}>×</button></td></tr>)}</tbody></table></div><div className="editor-footer"><span>Formula dijaga otomatis • wrap text aktif • import Excel akan menghitung ulang KPI.</span>{filtered.length<values.length&&<button className="soft" onClick={()=>setLimit(v=>v+120)}>Tampilkan lebih banyak</button>}</div></div>{addOpen&&<AddRowModal cols={cols} headers={headers} values={addValues} setValues={setAddValues} activeCols={activeCols} toggleCol={toggleCol} selectAllColumns={()=>setActiveCols(Array.from({length:cols},(_,i)=>i))} selectNoColumns={()=>setActiveCols([])} insertAfter={insertAfter} setInsertAfter={setInsertAfter} rowCount={values.length} onClose={()=>setAddOpen(false)} onAdd={submitAdd}/>}</section>;
}

function AuditModal({entries,onClose,onExport}){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="small-modal audit-modal"><div className="modal-head"><div><span className="eyebrow">AUDIT PERUBAHAN</span><h2>Riwayat import & rollback</h2><p>Ringkasan perubahan tersimpan di browser ini. Tidak ada password atau private key yang dicatat.</p></div><button className="close" onClick={onClose}>×</button></div><div className="audit-list">{entries.length?entries.map(e=><div className="audit-item" key={e.id}><div><b>{e.action}</b><small>{new Date(e.at).toLocaleString('id-ID')}</small></div><pre>{JSON.stringify(e.details,null,2)}</pre></div>):<div className="empty">Belum ada riwayat import.</div>}</div><div className="modal-foot"><button className="soft" onClick={onExport}>⇩ Export Audit JSON</button><button className="primary" onClick={onClose}>Tutup</button></div></div></div>}
function ImportExcelModal({info,onClose,onApply,busy=false}){
  const [mode,setMode]=useState('replace'); const [preserveFormat,setPreserveFormat]=useState(true); const [showSchema,setShowSchema]=useState(true); const audit=info.validation?.audit||formulaAudit(info.payload); const stats=info.validation?.stats||importSchemaStats(info.mapping||[]); const warnings=info.validation?.warnings||[];
  const runApply=()=>onApply(mode,preserveFormat);
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}><div className="import-modal import-engine-v81"><div className="modal-head"><div><span className="eyebrow">V8.1 IMPORT ENGINE</span><h2>Pratinjau & validasi sebelum import</h2><p><b>{info.fileName}</b> • {info.sheets} sheet • TA terdeteksi <b>{info.year}</b></p></div><button className="close" disabled={busy} onClick={onClose}>×</button></div>
    <div className="import-summary"><div><b>{info.sheets}</b><span>sheet terbaca</span></div><div><b>{audit.formulaCount}</b><span>formula terdeteksi</span></div><div className={audit.errors?'warn':''}><b>{audit.errors}</b><span>error nilai</span></div><div className={audit.external?'warn':''}><b>{audit.external}</b><span>formula eksternal</span></div></div>
    <div className="import-health"><span className="health-dot"></span><b>{stats.exact} exact</b><span>•</span><b>{stats.fuzzy} pemetaan fleksibel</b><span>•</span><b>{stats.missing} hilang</b><span>•</span><b>{stats.newSheets} sheet baru</b></div>
    <div className="import-mode-grid"><label className={mode==='replace'?'import-mode active':'import-mode'}><input type="radio" checked={mode==='replace'} onChange={()=>setMode('replace')}/><span><b>Perbarui TA aktif</b><small>Hanya sheet yang ada di Excel diperbarui pada tahun aktif; sheet lainnya dipertahankan.</small></span></label><label className={mode==='newyear'?'import-mode active':'import-mode'}><input type="radio" checked={mode==='newyear'} onChange={()=>setMode('newyear')}/><span><b>Import sebagai TA baru</b><small>Menggunakan tahun yang terdeteksi dari file untuk membuat/memperbarui database tahun tersebut.</small></span></label><label className={mode==='merge'?'import-mode active':'import-mode'}><input type="radio" checked={mode==='merge'} onChange={()=>setMode('merge')}/><span><b>Gabungkan sheet</b><small>Sheet yang cocok diperbarui tanpa menghapus sheet lain; sheet baru ikut ditambahkan.</small></span></label></div>
    <label className="preserve-option"><input type="checkbox" checked={preserveFormat} onChange={e=>setPreserveFormat(e.target.checked)}/><span><b>Pertahankan format Excel</b><small>Gunakan workbook sumber sebagai template saat export kembali: merge, lebar kolom, tinggi baris, view, dan struktur sheet dipertahankan sebisa mungkin.</small></span></label>
    <div className="validation-box"><div><b>VALIDASI FORMULA</b><span>{audit.errors?'Ada nilai error yang perlu ditinjau.':'Tidak ada error formula terdeteksi pada hasil parsing.'}</span></div><div><b>ROLLBACK</b><span>Backup kondisi database dibuat otomatis sebelum import diterapkan.</span></div></div>
    <button className="schema-toggle" onClick={()=>setShowSchema(v=>!v)}>▣ {showSchema?'Sembunyikan':'Tampilkan'} schema mapping ({info.preview?.length||0})</button>
    {showSchema&&<div className="schema-map"><div className="schema-head"><span>Website</span><span>Excel</span><span>Status</span><span>Ukuran</span><span>Formula</span></div>{(info.preview||[]).map((m,i)=><div className="schema-row" key={i}><span title={m.expected}>{m.expected||'—'}</span><span title={m.actual}>{m.actual||'—'}</span><span className={`schema-status ${m.status}`}>{m.status==='exact'?'COCOK':m.status==='fuzzy'?'FLEKSIBEL':m.status==='missing'?'HILANG':'BARU'}</span><span>{m.importRows}×{m.importCols}</span><span>{m.formulaCount}</span></div>)}</div>}
    {(info.validation?.errors||[]).length>0&&<div className="import-warnings" role="alert">{info.validation.errors.map((err,i)=><div key={i}>Impor ditolak: {err}</div>)}</div>}
    {warnings.length>0&&<div className="import-warnings">{warnings.slice(0,8).map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}
    <div className="modal-foot"><button className="ghost" disabled={busy} onClick={onClose}>Batal</button><button className="primary" disabled={!info.validation?.ok||busy} onClick={runApply}>{busy?'Menyimpan dan memverifikasi…':'✓ Validasi OK • Terapkan Import'}</button></div>
  </div></div> }

function LoginModal({onClose,onLogin}){const [password,setPassword]=useState('');return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="small-modal"><div className="modal-head"><div><span className="eyebrow">AKSES OPERATOR</span><h2>Masuk ke database pusat</h2><p>Password hanya dipakai untuk sesi operator. Kredensial Google tetap tersimpan di Cloudflare Secret.</p></div><button className="close" onClick={onClose}>×</button></div><label className="single-field"><span>Password operator</span><input type="password" autoFocus value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&onLogin(password)} placeholder="Masukkan password" /></label><div className="modal-foot"><button className="ghost" onClick={onClose}>Batal</button><button className="primary" onClick={()=>onLogin(password)}>Masuk</button></div></div></div>}
function AddRowModal({ cols, headers, values, setValues, activeCols, toggleCol, selectAllColumns, selectNoColumns, insertAfter, setInsertAfter, rowCount, onClose, onAdd }) { return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="add-modal"><div className="modal-head"><div><span className="eyebrow">TAMBAH BARIS FLEKSIBEL</span><h2>Pilih kolom yang ingin diisi</h2><p>Anda tidak perlu mengisi seluruh kolom. Gunakan pilihan kolom agar input lebih ringkas.</p></div><button className="close" onClick={onClose}>×</button></div><div className="modal-controls"><label>Posisi <select value={insertAfter} onChange={e => setInsertAfter(e.target.value)}><option value="end">Tambahkan di akhir</option>{Array.from({ length: Math.min(rowCount, 50) }, (_, i) => <option key={i} value={i}>Setelah baris {i + 1}</option>)}</select></label><div className="column-pickers"><span>Kolom aktif:</span><button onClick={selectAllColumns}>Semua</button><button onClick={selectNoColumns}>Kosongkan</button><b>{activeCols.length}/{cols}</b></div></div><div className="pick-grid">{Array.from({ length: cols }, (_, i) => <label key={i} className={activeCols.includes(i) ? 'pick active' : 'pick'}><input type="checkbox" checked={activeCols.includes(i)} onChange={() => toggleCol(i)} /><span><b>{colName(i)}</b><small>{headers[i]}</small></span></label>)}</div><div className="modal-form">{activeCols.length ? activeCols.map(i => <label key={i}><span><b>{colName(i)}</b>{headers[i]}</span>{/anggaran|realisasi|target|bobot|persen|fisik|keuangan|nilai|jumlah|tahun|triwulan|%/i.test(headers[i]) ? <input inputMode="decimal" value={values[i] || ''} onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))} placeholder={`Isi ${headers[i]}…`} /> : <textarea rows="2" value={values[i] || ''} onInput={e => { e.currentTarget.style.height = '0px'; e.currentTarget.style.height = Math.min(160, e.currentTarget.scrollHeight) + 'px'; }} onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))} placeholder={`Isi ${headers[i]}…`} />}</label>) : <div className="empty">Pilih minimal satu kolom.</div>}</div><div className="modal-foot"><span>{activeCols.length} kolom dipilih</span><div><button className="ghost" onClick={onClose}>Batal</button><button className="primary" onClick={onAdd}>＋ Tambahkan Baris</button></div></div></div></div>; }

function RowEditorModal({ payload, sheetName, rowIndex, onClose, onSave, onAdd }) {
  const sheet = payload.sheets[sheetName];
  const cols = Math.max(sheet?.cols || 0, ...((sheet?.values || []).map(r => r.length)), 0);
  const headers = headersFor(sheet);
  const isNew = rowIndex === 'new';
  const [values, setValues] = useState(() => isNew ? Array(cols).fill('') : clone(sheet.values[Number(rowIndex)] || Array(cols).fill('')));
  const meta = sheetMeta[sheetName] || {};
  const isComputed = (i) => !!sheet.formulas?.[addr(Number(rowIndex),i)];
  const inferredType = (i) => /anggaran|realisasi|target|bobot|persen|fisik|keuangan|nilai|jumlah|tahun|triwulan|%|no\.?$/i.test(headers[i] || '') ? 'number' : 'text';
  const saveRow = () => {
    if (isNew) onAdd(sheetName, clone(values));
    else onSave(sheetName, Number(rowIndex), clone(values));
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="row-editor-modal"><div className="modal-head"><div><span className="eyebrow">{isNew ? 'TAMBAH DATA' : 'EDIT DATA'} • {sheetName}</span><h2>{isNew ? 'Isi baris baru' : `Edit baris ${Number(rowIndex) + 1}`}</h2><p>{isNew ? 'Form mengikuti seluruh kolom sheet. Isi bagian yang diperlukan saja.' : 'Kolom hitungan ditandai AUTO dan akan diperbarui saat disimpan.'}</p></div><button className="close" onClick={onClose}>×</button></div><div className="row-form-grid">{Array.from({ length: cols }, (_, i) => <label key={i} className={isComputed(i) ? 'computed-field' : ''}><span><b>{colName(i)}</b>{headers[i]}</span>{isComputed(i) ? <input value={cell(values[i])} readOnly placeholder="Otomatis" /> : inferredType(i) === 'number' ? <input inputMode="decimal" value={cell(values[i])} onChange={e => setValues(v => { const n = [...v]; n[i] = e.target.value; return n; })} placeholder={`Isi ${headers[i]}…`} /> : <textarea rows="2" value={cell(values[i])} onInput={e => { e.currentTarget.style.height = '0px'; e.currentTarget.style.height = Math.min(180, e.currentTarget.scrollHeight) + 'px'; }} onChange={e => setValues(v => { const n = [...v]; n[i] = e.target.value; return n; })} placeholder={`Isi ${headers[i]}…`} />}</label>)}</div><div className="modal-foot"><span>{cols} kolom • wrap text • auto calc</span><div><button className="ghost" onClick={onClose}>Batal</button><button className="primary" onClick={saveRow}>{isNew ? '＋ Tambahkan data' : '✓ Simpan baris'}</button></div></div></div></div>;
}
function isComputedDataSheet(name) { return name === 'Realisasi Fisik & Keu' || name.startsWith('Capaian Sasaran'); }

function YearManagerModal({ years, activeYear, dirty, onClose, onSwitch, onCreate, onRename, onSave, onExportAll }) { const [newYear, setNewYear] = useState(activeYear + 1); const [mode, setMode] = useState('copy'); const available = Object.keys(years).map(Number).sort((a, b) => b - a); return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="year-modal"><div className="modal-head"><div><span className="eyebrow">MANAJEMEN TAHUN ANGGARAN</span><h2>Tahun aktif: {activeYear}</h2><p>Setiap tahun memiliki database sendiri. Anda bisa menambah tahun, menyalin data, atau membuat template kosong.</p></div><button className="close" onClick={onClose}>×</button></div><div className="year-list">{available.map(y => <button key={y} className={y === activeYear ? 'year-item active' : 'year-item'} onClick={() => y !== activeYear && onSwitch(y)}><span>TA {y}</span><small>{y === activeYear ? 'Aktif sekarang' : 'Buka tahun ini'}</small><b>{years[y]?.meta?.sheetCount || Object.keys(years[y]?.sheets || {}).length} sheet</b></button>)}</div><div className="new-year-box"><span className="eyebrow">TAMBAH TAHUN BARU</span><div className="new-year-row"><input type="number" min="2000" max="2100" value={newYear} onChange={e => setNewYear(e.target.value)} /><select value={mode} onChange={e => setMode(e.target.value)}><option value="copy">Salin data tahun aktif</option><option value="blank">Buat template kosong</option></select><button className="primary" onClick={() => onCreate(newYear, mode)}>＋ Tambah Tahun</button></div><small>Salin data mempertahankan struktur dan isi; template kosong mempertahankan struktur namun membersihkan baris data transaksi.</small></div><div className="year-foot"><span>{dirty ? 'Ada perubahan yang belum disimpan.' : 'Tahun baru disimpan ke Google sebelum ditampilkan.'}</span><div><button className="soft" onClick={onRename}>Salin ke tahun lain</button><button className="soft" onClick={onExportAll}>⇩ Export semua</button><button className="primary" onClick={onSave}>✓ Simpan tahun aktif</button></div></div></div></div>; }
function YearEditModal({ currentYear, onClose, onRename }) { const [value, setValue] = useState(currentYear); return <div className="modal-backdrop"><div className="small-modal"><div className="modal-head"><div><span className="eyebrow">UBAH TAHUN</span><h2>Salin ke tahun baru</h2><p>Buat salinan tahun ke Google Sheets tanpa menghapus tahun sebelumnya untuk menjaga jejak audit.</p></div><button className="close" onClick={onClose}>×</button></div><label className="single-field"><span>Tahun baru</span><input type="number" value={value} onChange={e => setValue(e.target.value)} /></label><div className="modal-foot"><button className="ghost" onClick={onClose}>Batal</button><button className="primary" onClick={() => onRename(value)}>✓ Buat salinan tahun</button></div></div></div>; }


function LoginGate(){
  const [checking,setChecking]=useState(true), [authenticated,setAuthenticated]=useState(false), [username,setUsername]=useState('ItdaKinerja2026'), [password,setPassword]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
  useEffect(()=>{const onAuthRequired=()=>{setAuthenticated(false);setChecking(false);};window.addEventListener('admin-auth-required',onAuthRequired);adminMe().then((me)=>setAuthenticated(Boolean(me?.ok))).catch(()=>setAuthenticated(false)).finally(()=>setChecking(false));return()=>window.removeEventListener('admin-auth-required',onAuthRequired);},[]);
  if(checking) return <div className="loading"><div className="loading-orb"></div><div>Memeriksa akses operator…</div></div>;
  if(authenticated) return <EditorApp/>;
  return <div className="login-screen"><div className="login-card"><div className="login-mark">ID</div><span className="eyebrow">AKSES INTERNAL</span><h1>Kertas Kerja <span>Realisasi Kinerja</span></h1><p>Login wajib sebelum membuka editor, import, export, atau mengubah database pusat.</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await adminLogin(username,password);setAuthenticated(true);}catch(err){setError(err.message||'Login gagal');}finally{setBusy(false);}}}><label><span>Username</span><input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} /></label><label><span>Password</span><input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} /></label>{error&&<div className="login-error">{error}</div>}<button className="primary login-btn" disabled={busy}>{busy?'Memeriksa…':'Masuk ke Kertas Kerja'}</button></form><small>Sesi operator dibuat di server dengan cookie HttpOnly Secure.</small></div></div>;
}

createRoot(document.getElementById('root')).render(<LoginGate />);
