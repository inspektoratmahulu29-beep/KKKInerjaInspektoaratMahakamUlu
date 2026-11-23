import React,{useMemo} from 'react';
import './master-insights.css';
const uang=n=>n==null?'Belum tersedia':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n).replace(/\u00a0/g,' ');
const angka=n=>new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(Number(n)||0);
const persen=n=>n==null?'—':`${(Number(n)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
const progress=(x,max)=>max>0?Math.min(100,Math.max(0,Number(x||0)/max*100)):0;
const distinctFinancial=groups=>{
 const valid=groups.filter(x=>x.code&&x.budget!=null);
 return {budget:valid.reduce((n,x)=>n+x.budget,0),real:valid.reduce((n,x)=>n+(x.financial||0),0),count:valid.length};
};
function Overview({mode,data,pkptExecution,onOpen}){
 const pkpt=mode==='pkpt',groups=pkpt?(data?.pkptFundingGroups||[]):(data?.nonPkptFundingGroups||[]);
 const source=pkpt?data?.agendaSourceAvailable:data?.nonPkptSourceAvailable;
 const count=groups.reduce((n,g)=>n+g.rows.length,0),planned=pkpt?(data?.pkptPackageBudgetTotal??null):null;
 const financial=useMemo(()=>distinctFinancial(groups),[groups]);
 const byProgram=useMemo(()=>{
  const m=new Map();for(const g of groups){const key=g.program||'Program belum terpetakan';m.set(key,(m.get(key)||0)+g.rows.length);}return [...m].sort((a,b)=>b[1]-a[1]).slice(0,4);
 },[groups]);
 const max=Math.max(1,...byProgram.map(x=>x[1]));
 return <article className={`ma-overview ${pkpt?'ma-pkpt':'ma-nonpkpt'}`}>
  <div className="ma-overview-head"><span className="ma-section-tag">{pkpt?'PENGAWASAN TERENCANA':'PENUGASAN DI LUAR PKPT'}</span><span className="ma-status">{source?'Terhubung ke master':'Periksa sumber'}</span></div>
  <h3>{pkpt?'PKPT':'Non-PKPT'}</h3><p>{pkpt?'Rencana agenda, pelaksanaan pengawasan, dan anggaran subkegiatan pembiayaan.':'Surat Tugas, PPTK, pembiayaan, dan status SPJ sesuai rekap penugasan.'}</p>
  <div className="ma-primary-stats"><button type="button" onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')}><small>{pkpt?'Penugasan / Agenda PKPT':'Surat Tugas'}</small><strong>{source?angka(count):'—'}</strong><span>Lihat 76 rincian ↗</span></button><button type="button" onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')}><small>Subkegiatan pembiayaan</small><strong>{source?angka(groups.length):'—'}</strong><span>Menurut sumber anggaran ↗</span></button></div>
  <div className="ma-finance-lines">
   {pkpt&&<button onClick={()=>onOpen('agenda')}><span>Rencana biaya paket PKPT (56 paket)</span><b>{source?uang(planned):'—'}</b></button>}
   {pkpt&&<button onClick={()=>onOpen('pelaksanaan')}><span>Baris pelaksanaan PKPT</span><b>{pkptExecution==null?'—':angka(pkptExecution)}</b></button>}
   <button onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')}><span>Pagu subkegiatan terkait</span><b>{financial.count?uang(financial.budget):'Belum terpetakan'}</b></button>
   <button onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')}><span>Realisasi keuangan subkegiatan terkait</span><b>{financial.count?uang(financial.real):'Belum terpetakan'}</b></button>
   {!pkpt&&<button onClick={()=>onOpen('nonpkpt')}><span>PPTK tercatat pada Surat Tugas</span><b>{angka(groups.flatMap(g=>g.rows).filter(x=>x.pptk).length)} ST</b></button>}
   {!pkpt&&<button onClick={()=>onOpen('nonpkpt')}><span>SPJ per Surat Tugas</span><b>{groups.some(g=>g.claimCount)?uang(groups.reduce((n,g)=>n+(g.claimTotal||0),0)):'Belum dicatat'}</b></button>}
  </div>
  <div className="ma-distribution"><div><b>Penugasan menurut program</b><small>{source?`${angka(count)} data master`:'Sumber belum tersedia'}</small></div>{byProgram.map(([name,value])=><button type="button" key={name} onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')} title={name}><span>{name}</span><b>{angka(value)}</b><i><em style={{width:`${progress(value,max)}%`}}/></i></button>)}</div>
  <button type="button" className="ma-detail" onClick={()=>onOpen(pkpt?'agenda':'nonpkpt')}>Buka rincian {pkpt?'PKPT':'Non-PKPT'} dan anggaran <span aria-hidden="true">↗</span></button>
  <small className="ma-caveat">Pagu dan realisasi adalah nilai subkegiatan; 56 paket biaya berbeda dari 76 penugasan. Paket biaya gabungan tidak dihitung berulang.</small>
 </article>;
}
function MoreCard({title,value,subtitle,section,onOpen}){return <button type="button" className="ma-more-card" onClick={()=>onOpen(section)}><small>{title}</small><b>{value}</b><span>{subtitle}</span><em aria-hidden="true">↗</em></button>;}
export default function MasterInsights({data,onOpen=()=>{},compact=false,revisionInfo=null,pkptExecution=null}){
 const all=data?.sheetList||[],summary=data?.unique,non=data?.nonPkpt||[];
 const status=all.length?`${all.filter(s=>s.available).length} dari ${all.length} sheet terbaca`:'Sumber belum dimuat';
 return <section className={`ma-root ${compact?'ma-compact':''}`} aria-label="Dashboard PKPT Non-PKPT dan anggaran">
  <header className="ma-header"><div><span className="ma-eyebrow">DASHBOARD PENGAWASAN • DATA MASTER KERTAS KERJA</span><h2>PKPT dan Non-PKPT</h2><p>Pembiayaan, PPTK, kegiatan, dan rincian penugasan disajikan dalam kelompoknya masing-masing. Semua angka mengikuti isi Google Sheets yang terbaca.</p></div><button type="button" onClick={()=>onOpen('sumber')}>{status} <span aria-hidden="true">↗</span></button></header>
  {revisionInfo&&!revisionInfo.markerAvailable&&<p className="ma-warning" role="status">Penanda revisi belum dapat dibaca. Gunakan pemeriksaan sumber untuk memastikan data dari master terbaru.</p>}
  {all.some(s=>!s.available)&&<p className="ma-warning" role="status">{angka(all.filter(s=>!s.available).length)} sheet belum tersedia atau kosong; rincian yang tidak diketahui ditampilkan sebagai “Belum tersedia”.</p>}
  <div className="ma-columns"><Overview mode="pkpt" data={data} pkptExecution={pkptExecution} onOpen={onOpen}/><Overview mode="nonpkpt" data={data} onOpen={onOpen}/></div>
  {!compact&&<div className="ma-more"><MoreCard title="Total Anggaran Inspektorat" value={uang(summary?.budget)} subtitle="Pagu berdasarkan rekap keseluruhan" section="anggaran" onOpen={onOpen}/><MoreCard title="Realisasi Keuangan" value={uang(summary?.financial)} subtitle="Realisasi sesuai laporan master" section="anggaran" onOpen={onOpen}/><MoreCard title="Serapan Anggaran" value={persen(summary?.absorption)} subtitle="Realisasi dibanding pagu" section="anggaran" onOpen={onOpen}/><MoreCard title="Surat Tugas Perlu Pemetaan" value={angka(data?.unmapped?.length)} subtitle="Tinjau klasifikasi sumber" section="bukti" onOpen={onOpen}/><MoreCard title="Register Bukti Capaian" value={angka(data?.evidence?.length)} subtitle="Status bukti sesuai catatan" section="bukti" onOpen={onOpen}/><MoreCard title="Rekonsiliasi Anggaran" value={uang(data?.dppaDifference)} subtitle="Selisih dokumen DPA dan laporan" section="rekonsiliasi" onOpen={onOpen}/></div>}
 </section>;
}
