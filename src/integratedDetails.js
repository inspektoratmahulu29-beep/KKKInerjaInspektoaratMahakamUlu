/** Analitik sumber 28 sheet: hanya membaca nilai Google Sheets, tidak menghitung ulang capaian bukti. */
const txt=x=>String(x??'').replace(/\s+/g,' ').trim();
const val=x=>{
  if(typeof x==='number')return Number.isFinite(x)?x:null;
  let s=txt(x);if(!s||/^#(?:REF|VALUE|ERROR|N\/A|DIV)/i.test(s))return null;
  if(!/^-?[\d.,]+%?$/.test(s))return null;
  const percent=s.endsWith('%');s=s.replace('%','');
  if(s.includes(',')&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');
  else if(s.includes(','))s=s.replace(',','.');
  const n=Number(s);return Number.isFinite(n)?(percent?n/100:n):null;
};
const align=sheet=>{
  const arr=sheet?.values||sheet||[];if(!Array.isArray(arr))return [];
  const columns=sheet?.schemaColumns;if(!Array.isArray(columns)||!columns.length)return arr;
  return arr.map(row=>{const out=[];for(const c of columns)out[c.original]=row[c.current];return out;});
};
const pick=(s,i)=>txt(s?.[i]);
const amount=(s,i)=>val(s?.[i]);
const isIndex=r=>Number.isInteger(val(r?.[0]))&&val(r?.[0])>0;
const list=(s,start,check=isIndex)=>align(s).slice(start).filter(check);
const prettyName=s=>String(s||'').replace(/\s+/g,' ').trim();
const sheetGroups={
 'IKU':'Perencanaan & IKU','Rencana Aksi':'Perencanaan & IKU',
 'Capaian Sasaran Strategis':'Capaian Kinerja','Capaian Sasaran Program':'Capaian Kinerja','Capaian Sasaran Kegiatan Utama':'Capaian Kinerja','Capaian Sasaran Kegiatan(Penun)':'Capaian Kinerja','Capaian Sasaran SUBKegiatan(U)':'Capaian Kinerja','Capaian Sasaran SUBKegiatan (P)':'Capaian Kinerja','Capaian Detail Penunjang 2026':'Capaian Kinerja',
 'Monev Renaksi IKU':'Monev & Bukti','Monev Program':'Monev & Bukti','Monev output Subkegiatan Utama':'Monev & Bukti','Monev Subkegiatan Penunjang':'Monev & Bukti','Register Bukti Capaian 2026':'Monev & Bukti','Audit Isian 12 Sheet 2026':'Monev & Bukti','Validasi Data 2026':'Monev & Bukti','Dasar Indikator DPA 2026':'Monev & Bukti',
 'Rekap realisasi PKPT':'Pelaksanaan & Penugasan','Rekap NON PKPT 2026':'Pelaksanaan & Penugasan','ST Belum Klasifikasi':'Pelaksanaan & Penugasan','ST Perlu Pemetaan Okt 2026':'Pelaksanaan & Penugasan','Jadwal PKPT dan Bukti 2026':'Pelaksanaan & Penugasan','Rincian Anggaran PKPT 2026':'Pelaksanaan & Penugasan',
 'Realisasi Fisik & Keu':'Anggaran & Rekonsiliasi','Rekonsiliasi DPPA 2026':'Anggaran & Rekonsiliasi','Ringkasan Anggaran PKPT Non':'Anggaran & Rekonsiliasi','TOTAL REKAP PKPT NON 2026':'Anggaran & Rekonsiliasi'};
const errorPattern=/^#(?:REF!|ERROR!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)$/i;
export function buildIntegratedDetails(sheets,requestedNames=[]){
  const get=n=>sheets?.[n];
  const totals=align(get('TOTAL REKAP PKPT NON 2026'));
  const totalLines=totals.slice(7,14).filter(r=>txt(r?.[0]));
  const groups=totalLines.map(r=>({name:pick(r,0),subCount:amount(r,1),plannedPkpt:amount(r,2),dpa:amount(r,3),budget:amount(r,4),financial:amount(r,5),remaining:amount(r,6),absorption:amount(r,7),basis:pick(r,8)}));
  const unique=groups.find(x=>/SELURUH INSPEKTORAT/i.test(x.name))||null;
  const subkegiatan=list(get('Ringkasan Anggaran PKPT Non'),4,r=>/^\d+(?:\.\d+)+$/.test(pick(r,1)));
  const summary=subkegiatan.map(r=>({code:pick(r,1),name:pick(r,2),dpa:amount(r,3),budget:amount(r,4),financial:amount(r,5),remaining:amount(r,6),absorption:amount(r,7),agenda:amount(r,8)||0,pkptPlan:amount(r,9)||0,pkptST:amount(r,10)||0,nonPkptST:amount(r,11)||0}));
  const agenda=list(get('Rincian Anggaran PKPT 2026'),4).map(r=>({id:amount(r,0),name:pick(r,1),irban:pick(r,2),subkegiatan:pick(r,3),code:pick(r,4),start:pick(r,5),report:pick(r,6),outputTarget:amount(r,7),planned:amount(r,8),subDpa:amount(r,9),subBudget:amount(r,10),subFinancial:amount(r,11),subRemaining:amount(r,12),subAbsorption:amount(r,13)}));
  const dpa=list(get('Dasar Indikator DPA 2026'),4,r=>/^\d+(?:\.\d+)+$/.test(pick(r,1))).map(r=>({code:pick(r,1),name:pick(r,2),indicator:pick(r,3),target:pick(r,4),unit:pick(r,5),budget:amount(r,6),financial:amount(r,7),absorption:amount(r,8),pkptST:amount(r,9)||0,nonPkptST:amount(r,10)||0}));
  const evidence=list(get('Register Bukti Capaian 2026'),4).map(r=>({type:pick(r,1),subkegiatan:pick(r,2),document:pick(r,3),date:pick(r,4),object:pick(r,5),output:pick(r,6),status:pick(r,7),impact:pick(r,8),source:pick(r,9)}));
  const unclassified=list(get('ST Belum Klasifikasi'),5).map(r=>({number:pick(r,1),month:pick(r,3),activity:pick(r,4),note:pick(r,10)}));
  const unmapped=list(get('ST Perlu Pemetaan Okt 2026'),4).map(r=>({number:pick(r,2),date:pick(r,3),class:pick(r,4),activity:pick(r,5),issue:pick(r,6)}));
  const nonPkptRows=list(get('Rekap NON PKPT 2026'),5);
  const validationSource=align(get('Validasi Data 2026'));
  const fisikRekap=val(validationSource[7]?.[3]),fisikSmpeq=val(validationSource[8]?.[3]);
  const physicalComparison={rekap:fisikRekap,smpeq:fisikSmpeq,differencePoints:fisikRekap!=null&&fisikSmpeq!=null?Math.round((fisikRekap-fisikSmpeq)*10000)/100:null};
  const validation=validationSource.slice(5).filter(r=>pick(r,0)&&!/^\d+$/.test(pick(r,0))).map(r=>({name:pick(r,0),budget:amount(r,1),financial:amount(r,2),note:pick(r,7)}));
  // Ringkas semua sumber, tetapi jangan mengirim baris identitas surat tugas melalui endpoint dashboard publik.
  const sheetList=requestedNames.map(name=>{
    const s=get(name),rr=align(s),count=rr.filter(r=>r.some(x=>txt(x))).length;
    let errorCount=0;for(const r of rr)for(const c of r)if(typeof c==='string'&&errorPattern.test(c.trim()))errorCount++;
    return {name,group:sheetGroups[name]||(name.startsWith('Laporan_Monev_Renaksi_')?'Monev & Bukti':'Lainnya'),available:!!s&&count>0,rows:count,columns:Math.max(0,...rr.map(r=>r.length)),errors:errorCount};
  });
  const hasUnique=!!unique;
  return {available:!!(summary.length||agenda.length||hasUnique||sheetList.some(x=>x.available)),period:pick(totals[2],0)||'',
    financialAuthority:hasUnique?'TOTAL REKAP PKPT NON 2026!A8:I8':null,
    unique,groups,subkegiatan:summary,agenda,dpa,evidence,unclassified,unmapped,
    nonPkptCount:nonPkptRows.length,validation,physicalComparison,sheetList,
    cautions:[
      'Nilai pada kelompok TERKAIT PKPT, NON-PKPT, dan DIPAKAI BERSAMA adalah kelompok beririsan. Jangan menjumlahkannya sebagai pagu total.',
      'Pagu rencana agenda PKPT berbeda dari pagu DPA/subkegiatan dan realisasi keuangan. Realisasi subkegiatan dapat berulang pada lebih dari satu agenda.',
      'Perbedaan fisik rekap dibanding fisik SMPEQ mencerminkan sumber/metode yang berbeda, bukan angka yang otomatis dapat disamakan.',
      'Surat Tugas, serapan keuangan, dan jadwal PKPT bukan bukti output selesai. Nilai capaian hanya dianggap terbukti setelah dokumen keluaran sah diverifikasi.'
    ]};
}
