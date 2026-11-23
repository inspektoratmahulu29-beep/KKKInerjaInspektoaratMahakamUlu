import React,{useMemo} from 'react';
import './master-insights.css';
const rupiah=v=>v==null?'—':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(v).replace(/\u00a0/g,' ');
const nominal=v=>v==null?'—':new Intl.NumberFormat('id-ID',{maximumFractionDigits:0}).format(v);
const pct=v=>v==null?'—':`${(Number(v)*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;
const abs=v=>Math.min(100,Math.max(0,Number(v)||0));
function SmallChart({items,mode='count',onOpen,section}){
 const largest=Math.max(1,...items.map(r=>Number(r.value)||0));
 return <div className="mi-bars">{items.slice(0,7).map((r,i)=><button type="button" onClick={()=>onOpen(section)} className="mi-bar-line" key={`${r.label}-${i}`} title={`Buka rincian ${r.label}`}>
  <div><span>{r.label}</span><b>{mode==='currency'?rupiah(r.value):nominal(r.value)}</b></div>
  <div className="mi-bar-track"><span style={{width:`${abs(Number(r.value)/largest*100)}%`,animationDelay:`${i*65}ms`}}/></div>
 </button>)}</div>;
}
function Card({title,value,caption,accent,section,onOpen,available=true}){
 return <button className={`mi-card mi-${accent}`} type="button" onClick={()=>onOpen(section)} aria-label={`Lihat rincian ${title}`}>
  <div className="mi-card-top"><span className="mi-card-icon"><svg viewBox="0 0 20 20" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="8" width="4" height="10" rx="1"/><rect x="8" y="4" width="4" height="14" rx="1"/><rect x="14" y="1" width="4" height="17" rx="1"/></svg></span><span className="mi-card-link">RINCIAN <b>↗</b></span></div>
  <span className="mi-card-title">{title}</span><strong>{available?value:'—'}</strong><small>{available?caption:'Sheet sumber belum terbaca pada periode ini'}</small>
  <span className="mi-card-accent"/></button>;
}
export default function MasterInsights({data,onOpen=()=>{},compact=false,revisionInfo=null,pkptExecution=null}){
 const all=data?.sheetList||[];const subReady=all.find(x=>x.name==='Ringkasan Anggaran PKPT Non')?.available;
 const totalReady=all.find(x=>x.name==='TOTAL REKAP PKPT NON 2026')?.available;
 const agendaReady=!!data?.agendaSourceAvailable;
 const nonReady=!!data?.nonPkptSourceAvailable;
 const dppaReady=!!data?.dppaSourceAvailable;
 const unique=data?.unique;const groups=data?.groups||[],subs=data?.subkegiatan||[],agenda=data?.agenda||[],non=data?.nonPkpt||[];
 const top=useMemo(()=>[...subs].filter(x=>x.budget>0).sort((a,b)=>b.budget-a.budget).slice(0,6).map(s=>({label:s.name,value:s.budget})),[subs]);
 const irbans=useMemo(()=>{
  const x=new Map();for(const a of agenda){const name=a.irban||'Tidak diketahui';x.set(name,(x.get(name)||0)+1);}
  return [...x].sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value}));
 },[agenda]);
 const months=useMemo(()=>data?.monthSummary?.map(x=>({label:x.month,value:x.count}))||[],[data]);
 const getGroup=name=>groups.find(x=>x.name===name);
 const cards=[
  {title:'Agenda Rencana PKPT',value:nominal(agenda.length),caption:'Agenda dalam Lampiran PKPT 2026',accent:'violet',section:'agenda',available:agendaReady},
  {title:'Pelaksanaan PKPT',value:nominal(pkptExecution),caption:'Baris pelaksanaan rekap PKPT, berbeda dari agenda rencana',accent:'indigo',section:'pelaksanaan',available:pkptExecution!=null},
  {title:'Pagu Rencana PKPT',value:rupiah(unique?.plannedPkpt),caption:'Biaya rencana agenda, bukan realisasi',accent:'amber',section:'agenda',available:totalReady&&!!unique},
  {title:'Surat Tugas Non-PKPT',value:nominal(non.length),caption:'Tercatat, belum tentu keluaran selesai',accent:'mint',section:'nonpkpt',available:nonReady},
  {title:'ST Non-PKPT Terpetakan',value:`${nominal(data?.nonPkptMappedCount)}/${nominal(non.length)}`,caption:'Pemetaan pembiayaan cocok persis dengan master',accent:'cyan',section:'nonpkpt',available:nonReady&&subReady},
  {title:'ST Belum Klasifikasi',value:nominal(data?.unclassified?.length),caption:'Perlu penetapan klasifikasi penugasan',accent:'pink',section:'bukti',available:all.some(x=>x.name==='ST Belum Klasifikasi'&&x.available)},
  {title:'Subkegiatan Unik',value:nominal(subs.length),caption:'Pagu dihitung satu kali per kode',accent:'cyan',section:'anggaran',available:subReady},
  {title:'Subkegiatan Terkait PKPT',value:nominal(getGroup('TERKAIT AGENDA PKPT')?.subCount),caption:'Termasuk subkegiatan digunakan bersama',accent:'indigo',section:'anggaran',available:totalReady},
  {title:'Subkegiatan Terkait Non-PKPT',value:nominal(getGroup('TERKAIT ST NON-PKPT')?.subCount),caption:'Bukan pagu yang bisa dijumlah langsung',accent:'sky',section:'anggaran',available:totalReady},
  {title:'Pagu Oktober Unik',value:rupiah(unique?.budget),caption:'Pagu aktual seluruh Inspektorat',accent:'amber',section:'anggaran',available:totalReady&&!!unique},
  {title:'Selisih DPPA vs Oktober',value:rupiah(data?.dppaDifference),caption:`${nominal(data?.dppaDifferences?.length)} subkegiatan berbeda`,accent:'rose',section:'rekonsiliasi',available:dppaReady},
  {title:'ST Perlu Pemetaan',value:nominal(data?.unmapped?.length),caption:'Belum cocok dengan kode subkegiatan',accent:'pink',section:'bukti',available:all.some(x=>x.name==='ST Perlu Pemetaan Okt 2026'&&x.available)},
  {title:'Register Bukti Capaian',value:nominal(data?.evidence?.length),caption:'Jumlah entri, bukan jumlah yang disahkan',accent:'green',section:'bukti',available:all.some(x=>x.name==='Register Bukti Capaian 2026'&&x.available)},
  {title:'Sheet Tersinkron',value:`${all.filter(x=>x.available).length}/${all.length||28}`,caption:'Status bacaan Google Sheets pada saat snapshot',accent:'teal',section:'sumber',available:all.length>0}
 ];
 const pending=all.filter(x=>!x.available);
 return <section className={`mi-panel ${compact?'mi-compact':''}`} aria-label="Pusat KPI tambahan PKPT Non-PKPT dan rekonsiliasi">
  <div className="mi-head"><div><span className="mi-eyebrow"><span className="mi-live-dot"/> KINERJA TERINTEGRASI • MASTER 28 SHEET</span><h2>PKPT, Non-PKPT & Anggaran Terperinci</h2><p>Setiap KPI dapat diklik untuk menampilkan tabel dan diagram berdasarkan sheet master, bukan angka contoh.</p></div><button type="button" onClick={()=>onOpen('sumber')} className="mi-audit-button">Periksa sumber 28 sheet <span>↗</span></button></div>
  {revisionInfo&&!revisionInfo.markerAvailable&&<div className="mi-sync-hint" role="status">Penanda revisi master belum tersedia/terbaca. Dashboard tetap menyegarkan data langsung secara berkala. Bandingkan fingerprint Google Sheets pada kedua website.</div>}
  {pending.length>0&&<div className="mi-sync-hint" role="status"><b>{pending.length} sheet belum tersedia atau kosong</b> — {pending.slice(0,5).map(x=>x.name).join(', ')}. Angka bersumber dari sheet yang tersedia saja.</div>}
  <div className="mi-grid">{cards.map(c=><Card key={c.title} {...c} onOpen={onOpen}/>)}</div>
  {!compact&&<div className="mi-chart-grid">
    <article className="mi-chart-panel"><div className="mi-chart-head"><div><small>ANGGARAN AKTUAL</small><h3>Enam Subkegiatan dengan Pagu Terbesar</h3></div><button onClick={()=>onOpen('anggaran')}>Semua rincian ↗</button></div>{subReady&&top.length?<SmallChart items={top} mode="currency" section="anggaran" onOpen={onOpen}/>:<p>Rincian subkegiatan belum tersedia.</p>}<p className="mi-chart-note">Bar menunjukkan pagu Oktober tiap kode subkegiatan. Nilai keuangan setiap subkegiatan tidak dijumlah ulang per agenda.</p></article>
    <article className="mi-chart-panel"><div className="mi-chart-head"><div><small>PENUGASAN PKPT</small><h3>Distribusi Agenda per Irban</h3></div><button onClick={()=>onOpen('agenda')}>Lihat agenda ↗</button></div>{agendaReady&&irbans.length?<SmallChart items={irbans} section="agenda" onOpen={onOpen}/>:<p>Agenda PKPT belum tersedia.</p>}<p className="mi-chart-note">Jumlah berdasarkan penanggung jawab agenda yang tercatat dalam Excel.</p></article>
    <article className="mi-chart-panel"><div className="mi-chart-head"><div><small>PENUGASAN NON-PKPT</small><h3>Surat Tugas per Bulan</h3></div><button onClick={()=>onOpen('nonpkpt')}>Lihat penugasan ↗</button></div>{nonReady&&months.length?<SmallChart items={months} section="nonpkpt" onOpen={onOpen}/>:<p>Rekap Non-PKPT belum tersedia.</p>}<p className="mi-chart-note">Surat tugas tercatat tidak otomatis berarti output diverifikasi atau biaya telah direalisasikan.</p></article>
    <article className="mi-chart-panel"><div className="mi-chart-head"><div><small>PEMBIAYAAN & BUKTI</small><h3>Rencana, Serapan, dan Perbedaan Sumber</h3></div><button onClick={()=>onOpen('rekonsiliasi')}>Cek rekonsiliasi ↗</button></div><div className="mi-contrast"><div><small>Pagu Oktober unik</small><b>{totalReady?rupiah(unique?.budget):'—'}</b></div><div><small>Realisasi keuangan unik</small><b>{totalReady?rupiah(unique?.financial):'—'}</b></div><div><small>Persentase realisasi</small><b>{totalReady?pct(unique?.absorption):'—'}</b></div><div><small>Perbedaan DPPA</small><b>{dppaReady?rupiah(data?.dppaDifference):'—'}</b></div></div><div className="mi-contrast-track"><span style={{width:`${abs((unique?.absorption||0)*100)}%`}}/></div><p className="mi-chart-note">Pagu rencana PKPT berbeda dari pagu pelaksanaan dan dari realisasi keuangan.</p></article>
  </div>}
 </section>;
}
