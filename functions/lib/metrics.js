// Shared verbatim by the operator app and public dashboard. No cell mutation.
export const text = v => String(v ?? '').replace(/\s+/g,' ').trim();
const norm=v=>text(v).toLowerCase();
export const number = v => {if(typeof v==='number') return Number.isFinite(v)?v:null;let s=text(v);if(!s||s.startsWith('#')||s.startsWith('='))return null;if(!/^-?[\d.,]+%?$/.test(s))return null;const percent=s.endsWith('%');s=s.replace('%','');if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?(percent?n/100:n):null;};
export function header(rows,label){for(let r=0;r<Math.min(rows.length,30);r++){const c=(rows[r]||[]).findIndex(x=>norm(x)===norm(label));if(c>=0)return {r,c};}return null;}
export function capaianMeta(rows){const keys={target:'Target Kinerja',real:'Realisasi Kinerja',achieve:'% Capaian',budget:'Pagu Anggaran',budgetReal:'Realisasi Anggaran',budgetPct:'% Realisasi'};const out={};for(const [key,label] of Object.entries(keys)){const h=header(rows,label);if(h){out[key]=h.c;out.dataStart=Math.max(out.dataStart||0,h.r+1);}}return out;}
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export function capaianMetric(rows){const m=capaianMeta(rows);const items=rows.slice(m.dataStart||3).filter(r=>!r.slice(0,2).some(x=>/^(jumlah|total|rata-rata)/i.test(text(x))));const rates=items.map(r=>number(r[m.achieve])).filter(x=>x!==null);return avg(rates.map(x=>x*100));}
function quarterRate(rows){const h=header(rows,'TW 1');if(!h)return null;const quarterRow=rows[h.r]||[];const cols=quarterRow.map((v,c)=>/^tw\s*[1-4]$/i.test(text(v))?c:-1).filter(c=>c>=0);const data=rows.slice(h.r+2);return avg(data.flatMap(r=>cols.slice(0,4).map((c,i)=>{const t=number(r[c]),v=number(r[cols[i+4]]);return t && v!==null?v/t*100:null;})).filter(x=>x!==null));}
export function calculateMetrics(sheets){const rows=n=>{const s=sheets[n],rr=s?.values||s||[];if(!s?.schemaColumns?.length)return rr;return rr.map(row=>{const out=[];for(const a of s.schemaColumns)out[a.original]=row[a.current];return out;});};
const rf=rows('Realisasi Fisik & Keu'),h=header(rf,'PROGRAM/KEGIATAN/SUB KEGIATAN');
const office=rf.find(r=>norm(r[h?.c??1])==='inspektorat')||[];
const budget=number(office[header(rf,'ANGGARAN')?.c??2]),financial=number(office[header(rf,'REALISASI KEUANGAN')?.c??6]),physical=number(office[header(rf,'REALISASI FISIK')?.c??4]);
const pk=rows('Rekap realisasi PKPT'),sh=header(pk,'Pemantauan Realisasi');const statusCol=sh?.c??4;
const end=pk.findIndex(r=>r.some(v=>norm(v).includes('realisasi output penugasan')));
const items=pk.slice((sh?.r??3)+3,end<0?pk.length:end).filter(r=>text(r[statusCol-1]));
const counts={selesai:0,berjalan:0,belum:0,lainnya:0};for(const r of items){const s=norm(r[statusCol]);if(s.includes('belum')||!s)counts.belum++;else if(s==='sudah'||s.includes('selesai'))counts.selesai++;else if(/berjalan|proses/.test(s))counts.berjalan++;else counts.lainnya++;}
const output=n=>{const rr=rows(n),hh=header(rr,'Jumlah Output');return hh?rr.slice(hh.r+3).reduce((a,r)=>a+(number(r[hh.c])||0),0):0;};
const names=['Capaian Sasaran Strategis','Capaian Sasaran Program','Capaian Sasaran Kegiatan Utama','Capaian Sasaran Kegiatan(Penun)','Capaian Sasaran SUBKegiatan(U)','Capaian Sasaran SUBKegiatan (P)'];
const keys=['strategic','program','kegiatanUtama','kegiatanPenunjang','subUtama','subPenunjang'];const capaian=Object.fromEntries(names.map((n,i)=>[keys[i],capaianMetric(rows(n))]));capaian.renaksi=quarterRate(rows('Monev Renaksi IKU'));capaian.monevProgram=quarterRate(rows('Monev Program'));
return {totalAnggaran:budget,realisasiKeuangan:financial,realisasiFisik:physical,serapan:budget&&financial!==null?financial/budget*100:null,sisaDana:budget!==null&&financial!==null?budget-financial:null,penugasan:items.length,...counts,outputUtama:output('Monev output Subkegiatan Utama'),outputPenunjang:output('Monev Subkegiatan Penunjang'),capaian,physicalSource:'excel-formula-office',physicalRowsCount:rf.length};}
