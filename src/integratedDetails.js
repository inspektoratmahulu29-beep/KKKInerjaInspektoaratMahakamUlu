/** Analitik seluruh sheet sumber: hanya membaca nilai Google Sheets, tidak menghitung ulang capaian bukti. */
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
// Keterkaitan program/kegiatan/PPTK dibaca dari lembar Monev, bukan disimpulkan
// dari nama agenda atau pembagian pagu. Pencocokan hanya melalui nama subkegiatan.
const nameKey=s=>prettyName(s).normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function buildActivityDirectory(sheets){
 const byName=new Map();
 for(const source of ['Monev output Subkegiatan Utama','Monev Subkegiatan Penunjang']){
  const rows=align(sheets?.[source]);let program='',kegiatan='';
  for(const r of rows){
   const p=pick(r,2),k=pick(r,4),sub=pick(r,6),pptk=pick(r,9);
   if(/^program\s+/i.test(p))program=p;
   if(k && !/^\d+$/.test(k) && !/nama kegiatan/i.test(k))kegiatan=k;
   if(!sub || /^\d+$/.test(sub)||/^nama sub/i.test(sub))continue;
   const key=nameKey(sub);if(!key)continue;
   const previous=byName.get(key)||{};
   byName.set(key,{
     program:program||previous.program||'',kegiatan:kegiatan||previous.kegiatan||'',
     pptk:pptk&&!/^(nama pptk|pptk pengawasan)$/i.test(pptk)?pptk:(previous.pptk||''),
     hierarchySource:source
   });
  }
 }
 return byName;
}
function categorizeFunding(items,subList,mode){
 const groupBy=new Map();
 const codes=new Map(subList.filter(x=>x.code).map(x=>[x.code,x]));
 for(const row of items){
  const basis=codes.get(row.code||row.fundingCode)||subList.find(x=>nameKey(x.name)===nameKey(row.subkegiatan||row.funding));
  const key=basis?.code||'nama:'+nameKey(row.subkegiatan||row.funding)||'tak-terpetakan';
  if(!groupBy.has(key))groupBy.set(key,{
    key,code:basis?.code||'',subkegiatan:basis?.name||row.subkegiatan||row.funding||'Belum tercantum',
    program:basis?.program||row.program||'',kegiatan:basis?.kegiatan||row.kegiatan||'',
    pptk:basis?.pptk||row.pptk||'',
    dpa:basis?.dpa??row.fundingDpa??null,budget:basis?.budget??row.fundingBudget??null,
    financial:basis?.financial??row.fundingFinancial??null,remaining:basis?.remaining??row.fundingRemaining??null,
    absorption:basis?.absorption??row.fundingAbsorption??null,
    rows:[],planTotal:null,claimTotal:null,claimCount:0,planCount:0
  });
  const group=groupBy.get(key);group.rows.push(row);
  if(mode==='pkpt' && row.planned!=null){group.planTotal=(group.planTotal||0)+row.planned;group.planCount++;}
  if(mode==='nonpkpt' && row.claimST!=null){group.claimTotal=(group.claimTotal||0)+row.claimST;group.claimCount++;}
 }
 return [...groupBy.values()].sort((a,b)=>(a.program||'ZZZ').localeCompare(b.program||'ZZZ','id')||(a.kegiatan||'ZZZ').localeCompare(b.kegiatan||'ZZZ','id')||a.subkegiatan.localeCompare(b.subkegiatan,'id'));
}

const sheetGroups={
 'IKU':'Perencanaan & IKU','Rencana Aksi':'Perencanaan & IKU',
 'Capaian Sasaran Strategis':'Capaian Kinerja','Capaian Sasaran Program':'Capaian Kinerja','Capaian Sasaran Kegiatan Utama':'Capaian Kinerja','Capaian Sasaran Kegiatan(Penun)':'Capaian Kinerja','Capaian Sasaran SUBKegiatan(U)':'Capaian Kinerja','Capaian Sasaran SUBKegiatan (P)':'Capaian Kinerja','Capaian Detail Penunjang 2026':'Capaian Kinerja',
 'Monev Renaksi IKU':'Monev & Bukti','Monev Program':'Monev & Bukti','Monev output Subkegiatan Utama':'Monev & Bukti','Monev Subkegiatan Penunjang':'Monev & Bukti','Register Bukti Capaian 2026':'Monev & Bukti','Audit Isian 12 Sheet 2026':'Monev & Bukti','Validasi Data 2026':'Monev & Bukti','Dasar Indikator DPA 2026':'Monev & Bukti',
 'Rekap realisasi PKPT':'Pelaksanaan & Penugasan','Rekap NON PKPT 2026':'Pelaksanaan & Penugasan','ST Belum Klasifikasi':'Pelaksanaan & Penugasan','ST Perlu Pemetaan Okt 2026':'Pelaksanaan & Penugasan','Jadwal PKPT dan Bukti 2026':'Pelaksanaan & Penugasan','PKPT 76 Penugasan 2026':'Pelaksanaan & Penugasan','Rincian Anggaran PKPT 2026':'Pelaksanaan & Penugasan',
 'Realisasi Fisik & Keu':'Anggaran & Rekonsiliasi','Rekonsiliasi DPPA 2026':'Anggaran & Rekonsiliasi','Ringkasan Anggaran PKPT Non':'Anggaran & Rekonsiliasi','TOTAL REKAP PKPT NON 2026':'Anggaran & Rekonsiliasi'};
const errorPattern=/^#(?:REF!|ERROR!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!)$/i;
export function buildIntegratedDetails(sheets,requestedNames=[]){
  const get=n=>sheets?.[n];
  const totals=align(get('TOTAL REKAP PKPT NON 2026'));
  const totalLines=totals.slice(7,14).filter(r=>txt(r?.[0]));
  const groups=totalLines.map(r=>({name:pick(r,0),subCount:amount(r,1),plannedPkpt:amount(r,2),dpa:amount(r,3),budget:amount(r,4),financial:amount(r,5),remaining:amount(r,6),absorption:amount(r,7),basis:pick(r,8)}));
  const unique=groups.find(x=>/SELURUH INSPEKTORAT/i.test(x.name))||null;
  const activityDirectory=buildActivityDirectory(sheets);
  const subkegiatan=list(get('Ringkasan Anggaran PKPT Non'),4,r=>/^\d+(?:\.\d+)+$/.test(pick(r,1)));
  const summary=subkegiatan.map(r=>({code:pick(r,1),name:pick(r,2),dpa:amount(r,3),budget:amount(r,4),financial:amount(r,5),remaining:amount(r,6),absorption:amount(r,7),agenda:amount(r,8)||0,pkptPlan:amount(r,9)||0,pkptST:amount(r,10)||0,nonPkptST:amount(r,11)||0}));
  for(const sub of summary)Object.assign(sub,activityDirectory.get(nameKey(sub.name))||{});
  const bySubCode=new Map(summary.filter(x=>x.code).map(x=>[x.code,x]));
  // Dua tingkat pencatatan PKPT: 76 penugasan dalam rekap pelaksanaan,
  // dan 56 PAKET biaya dalam rincian anggaran. Jumlah paket tidak boleh menjadi KPI agenda.
  const budgetPackages=list(get('Rincian Anggaran PKPT 2026'),4).map(r=>({id:amount(r,0),name:pick(r,1),irban:pick(r,2),subkegiatan:pick(r,3),code:pick(r,4),start:pick(r,5),report:pick(r,6),outputTarget:amount(r,7),planned:amount(r,8)}));
  const pkptPackageBudgetTotal=budgetPackages.length?budgetPackages.reduce((n,r)=>n+(r.planned||0),0):null;
  const source76=list(get('PKPT 76 Penugasan 2026'),4,r=>isIndex(r)&&!!pick(r,1));
  const recap76=align(get('Rekap realisasi PKPT')).slice(6).map((cells,i)=>({cells,row:i+7})).filter(x=>!!pick(x.cells,3)&&!!pick(x.cells,8));
  // Jika workbook lama belum memuat sheet rekonsiliasi, angka PKPT tetap
  // ditarik dari 76 baris rekap; detail paket yang belum terverifikasi dibiarkan kosong.
  const agenda=source76.length ? source76.map(r=>({
    id:amount(r,0),name:pick(r,1),jenis:pick(r,2),irban:pick(r,3),status:pick(r,4),
    program:pick(r,5),kegiatan:pick(r,6),subkegiatan:pick(r,7),code:pick(r,8),pptk:pick(r,9),
    start:pick(r,10),report:pick(r,11),outputTarget:amount(r,12),targetUnit:pick(r,13),
    packageId:amount(r,14),planned:amount(r,15),recapPlan:amount(r,16),
    subBudget:amount(r,17),subFinancial:amount(r,18),subRemaining:amount(r,19),subAbsorption:amount(r,20),
    recapRow:amount(r,21),packageStatus:pick(r,22),notes:pick(r,23)
  })) : recap76.map(({cells:r,row},index)=>({
    id:index+1,name:pick(r,3),jenis:pick(r,7),irban:pick(r,5),status:pick(r,4),
    subkegiatan:pick(r,8),code:pick(r,26),outputTarget:amount(r,9),targetUnit:pick(r,10),
    recapPlan:amount(r,18),planned:null,recapRow:row,
    packageStatus:'Paket belum direkonsiliasi',notes:'Impor workbook PKPT 76 Penugasan 2026 untuk hubungan paket dan penugasan yang terverifikasi.'
  }));
  const pkptUnmatchedCount=source76.length ? agenda.filter(x=>x.packageId==null).length : null;
  const pkptTentativeCount=source76.length ? agenda.filter(x=>/indikatif/i.test(x.packageStatus)).length : null;
  const pkptOrphanPackageIds=source76.length ? budgetPackages.filter(x=>!agenda.some(a=>a.packageId===x.id)).map(x=>x.id) : [];
  const pkptOrphanBudget=source76.length ? budgetPackages.filter(x=>pkptOrphanPackageIds.includes(x.id)).reduce((sum,x)=>sum+(x.planned||0),0) : null;
  for(const item of agenda){const sub=bySubCode.get(item.code)||summary.find(x=>nameKey(x.name)===nameKey(item.subkegiatan));if(sub){item.program=item.program||sub.program||'';item.kegiatan=item.kegiatan||sub.kegiatan||'';item.pptk=item.pptk||sub.pptk||'';item.fundingMapped=true;}else{const directory=activityDirectory.get(nameKey(item.subkegiatan))||{};item.program=item.program||directory.program||'';item.kegiatan=item.kegiatan||directory.kegiatan||'';item.pptk=item.pptk||directory.pptk||'';item.fundingMapped=false;}}
  const dpa=list(get('Dasar Indikator DPA 2026'),4,r=>/^\d+(?:\.\d+)+$/.test(pick(r,1))).map(r=>({code:pick(r,1),name:pick(r,2),indicator:pick(r,3),target:pick(r,4),unit:pick(r,5),budget:amount(r,6),financial:amount(r,7),absorption:amount(r,8),pkptST:amount(r,9)||0,nonPkptST:amount(r,10)||0}));
  const evidence=list(get('Register Bukti Capaian 2026'),4).map(r=>({type:pick(r,1),subkegiatan:pick(r,2),document:pick(r,3),date:pick(r,4),object:pick(r,5),output:pick(r,6),status:pick(r,7),impact:pick(r,8),source:pick(r,9)}));
  const unclassified=list(get('ST Belum Klasifikasi'),5).map(r=>({number:pick(r,1),month:pick(r,3),activity:pick(r,4),note:pick(r,10)}));
  const unmapped=list(get('ST Perlu Pemetaan Okt 2026'),4).map(r=>({number:pick(r,2),date:pick(r,3),class:pick(r,4),activity:pick(r,5),issue:pick(r,6)}));
  const nonPkptRows=list(get('Rekap NON PKPT 2026'),5);
  // Public projection intentionally omits employee, travel-order number and other identity fields.
  // Administrative status is not evidence of a verified audit output.
  const nonPkpt=nonPkptRows.map((r,index)=>({
    index:index+1,month:pick(r,3),activity:pick(r,4),object:pick(r,8),
    funding:pick(r,9),pptk:pick(r,10),tripType:pick(r,11),location:pick(r,12),days:amount(r,13),
    fundingDpa:amount(r,23),fundingBudget:amount(r,24),fundingFinancial:amount(r,25),
    fundingRemaining:amount(r,26),fundingAbsorption:amount(r,27),
    planST:amount(r,28),claimST:amount(r,29),
    outputType:pick(r,14),target:amount(r,15),status:pick(r,16)
  }));
  // Match only identical normalized funding names. Do not use fuzzy similarity to assign public budgets.
  // Repeated subactivity budgets are context for each ST, never an additional ST expense.
  const byFundingName=new Map(summary.filter(x=>x.name).map(x=>[prettyName(x.name).toLowerCase(),x]));
  let nonPkptMappedCount=0;
  for(const st of nonPkpt){
    const row=byFundingName.get(prettyName(st.funding).toLowerCase());
    if(!row)continue;
    st.fundingMapped=true;st.fundingCode=row.code;st.fundingBudget=row.budget;
    st.fundingFinancial=row.financial;st.fundingRemaining=row.remaining;st.fundingDpa=row.dpa;st.fundingAbsorption=row.absorption;st.program=row.program||'';st.kegiatan=row.kegiatan||'';st.pptk=st.pptk||row.pptk||'';
    nonPkptMappedCount++;
  }
  for(const st of nonPkpt){if(st.program)continue;const directory=activityDirectory.get(nameKey(st.funding));if(directory){st.program=directory.program||'';st.kegiatan=directory.kegiatan||'';st.pptk=st.pptk||directory.pptk||'';}}
  const pkptExecution=list(get('Rekap realisasi PKPT'),6,r=>!!pick(r,8)).map(r=>({
    activity:pick(r,3),status:pick(r,4),irban:pick(r,5),jenis:pick(r,7),
    subkegiatan:pick(r,8),code:pick(r,26),target:amount(r,9),realized:amount(r,11),
    rencanaBiaya:amount(r,18),spj:amount(r,24),catatan:pick(r,17)
  }));
  const pkptFundingGroups=categorizeFunding(agenda,summary,'pkpt');
  const nonPkptFundingGroups=categorizeFunding(nonPkpt,summary,'nonpkpt');
  for(const group of pkptFundingGroups)group.executionRows=[];
  for(const job of pkptExecution){
    let group=pkptFundingGroups.find(g=>(job.code&&g.code===job.code)||nameKey(g.subkegiatan)===nameKey(job.subkegiatan));
    if(!group){const sub=bySubCode.get(job.code)||summary.find(x=>nameKey(x.name)===nameKey(job.subkegiatan));
      group={key:sub?.code||'pelaksanaan:'+nameKey(job.subkegiatan),code:sub?.code||'',subkegiatan:sub?.name||job.subkegiatan,
        program:sub?.program||'',kegiatan:sub?.kegiatan||'',pptk:sub?.pptk||'',
        dpa:sub?.dpa??null,budget:sub?.budget??null,financial:sub?.financial??null,remaining:sub?.remaining??null,
        absorption:sub?.absorption??null,rows:[],executionRows:[],planTotal:null,planCount:0,claimTotal:null,claimCount:0};
      pkptFundingGroups.push(group);
    }
    if(!source76.length)group.executionRows.push(job);
  }

  const monthSummary=[...new Set(nonPkpt.map(r=>r.month).filter(Boolean))].map(month=>({
    month,count:nonPkpt.filter(r=>r.month===month).length,
    verified:nonPkpt.filter(r=>r.month===month&&/terverifikasi/i.test(r.status)).length
  }));
  const fundingSummary=[...new Set(nonPkpt.map(r=>r.funding).filter(Boolean))].map(name=>({
    name,count:nonPkpt.filter(r=>r.funding===name).length
  })).sort((a,b)=>b.count-a.count);
  const dppaRows=list(get('Rekonsiliasi DPPA 2026'),5).map(r=>({
    name:pick(r,1),dpa:amount(r,2),october:amount(r,3),difference:amount(r,4),
    financial:amount(r,5),absorption:amount(r,6),source:pick(r,7),state:pick(r,8)
  }));
  const dppaDifference=dppaRows.reduce((n,r)=>n+(Number(r.difference)||0),0);
  const dppaDifferences=dppaRows.filter(r=>r.difference!=null&&Math.abs(r.difference)>.01);
  const scheduling=list(get('Jadwal PKPT dan Bukti 2026'),4);
  const nonPkptSourceAvailable=!!get('Rekap NON PKPT 2026')&&nonPkptRows.length>0;
  const agendaSourceAvailable=(!!get('PKPT 76 Penugasan 2026')||!!get('Rekap realisasi PKPT'))&&agenda.length>0;
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
    unique,groups,subkegiatan:summary,agenda,budgetPackages,pkptPackageBudgetTotal,pkptUnmatchedCount,pkptTentativeCount,pkptOrphanPackageIds,pkptOrphanBudget,pkptSourceCorrected:source76.length>0,pkptExecution,pkptFundingGroups,nonPkptFundingGroups,dpa,evidence,unclassified,unmapped,
    nonPkptCount:nonPkptRows.length,nonPkpt,nonPkptSourceAvailable,nonPkptMappedCount,monthSummary,fundingSummary,agendaSourceAvailable,
    dppaRows,dppaDifference,dppaDifferences,dppaSourceAvailable:!!get('Rekonsiliasi DPPA 2026'),
    scheduleCount:scheduling.length,validation,physicalComparison,sheetList,
    cautions:[
      'Nilai pada kelompok TERKAIT PKPT, NON-PKPT, dan DIPAKAI BERSAMA adalah kelompok beririsan. Jangan menjumlahkannya sebagai pagu total.',
      'Terdapat 76 baris penugasan PKPT dan 56 paket rencana biaya. Paket yang digunakan bersama tidak boleh digandakan saat menampilkan rincian penugasan.',
      'Pagu rencana paket PKPT berbeda dari pagu DPA/subkegiatan dan realisasi keuangan. Realisasi subkegiatan dapat berulang pada lebih dari satu penugasan.',
      'Perbedaan fisik rekap dibanding fisik SMPEQ mencerminkan sumber/metode yang berbeda, bukan angka yang otomatis dapat disamakan.',
      'Surat Tugas, serapan keuangan, dan jadwal PKPT bukan bukti output selesai. Nilai capaian hanya dianggap terbukti setelah dokumen keluaran sah diverifikasi.'
    ]};
}
