import React from 'react';

export const MONEV_REPORT_SHEET = 'Laporan Monev Renaksi';
export const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
export const QUARTERS = [
  { label:'TW 1', start:0, end:2, endMonth:'Maret' },
  { label:'TW 2', start:3, end:5, endMonth:'Juni' },
  { label:'TW 3', start:6, end:8, endMonth:'September' },
  { label:'TW 4', start:9, end:11, endMonth:'Desember' }
];

const text = v => String(v ?? '').replace(/\s+/g,' ').trim();
const num = v => {
  if(typeof v==='number' && Number.isFinite(v)) return v;
  const s=text(v).replace(/\s/g,'');
  if(!s) return null;
  if(s.includes('.') && s.includes(',')) return Number(s.replace(/\./g,'').replace(',','.'));
  if((s.match(/\./g)||[]).length>1) return Number(s.replace(/\./g,''));
  const n=Number(s.replace(',','.'));
  return Number.isFinite(n)?n:null;
};
const col = i => { let s=''; let n=i+1; while(n){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); } return s; };
const clone = x => JSON.parse(JSON.stringify(x));
const formulaValue = (a,b) => a!==null && b!==null && a!==0 ? +(b/a).toFixed(6) : '';

function setValue(sheet,r,c,value){
  if(!sheet.values[r]) sheet.values[r]=[];
  sheet.values[r][c]=value;
}
function setFormula(sheet,r,c,formula,value=''){
  setValue(sheet,r,c,value);
  sheet.formulas = sheet.formulas || {};
  sheet.formulas[`${col(c)}${r+1}`]=formula;
}
function sourceRows(payload){
  const s=payload?.sheets?.['Monev Renaksi IKU'];
  const rows=s?.values||[];
  const out=[];
  for(let ri=8;ri<rows.length;ri++){
    const r=rows[ri]||[];
    const indicator=text(r[3]);
    if(!indicator || /^tujuan dan sasaran/i.test(indicator) || /^indikator kinerja/i.test(indicator)) continue;
    if(!text(r[4]) && r.slice(5,13).every(v=>v===''||v===null||v===undefined)) continue;
    out.push({
      sourceRow:ri,
      no:out.length+1,
      sasaran:text(r[1]),
      indicator,
      unit:text(r[4]),
      targets:[r[5]??'',r[6]??'',r[7]??'',r[8]??''],
      realizations:[r[9]??'',r[10]??'',r[11]??'',r[12]??'']
    });
  }
  return out;
}

function ensureRows(sheet, count, cols){
  sheet.values=sheet.values||[];
  while(sheet.values.length<count) sheet.values.push(Array(cols).fill(''));
  sheet.cols=Math.max(sheet.cols||0,cols);
  sheet.rows=sheet.values.length;
}

function reportHasMarker(sheet, marker){
  return (sheet?.values||[]).some(r=>text(r?.[0]||r?.[1]||r?.[2]||'').toUpperCase()===marker.toUpperCase());
}

export function findMonevReportLayout(sheet){
  const rows=sheet?.values||[];
  const marker=i=>text(rows[i]?.[0] || rows[i]?.[1] || rows[i]?.[2] || '').toUpperCase();
  const kpiMarker=rows.findIndex((_,i)=>marker(i).includes('KPI PER TRIWULAN'));
  const monthlyMarker=rows.findIndex((_,i)=>marker(i).includes('REALISASI FISIK & KEUANGAN PER BULAN'));
  const quarterMarker=rows.findIndex((_,i)=>marker(i).includes('REKAP REALISASI FISIK & KEUANGAN PER TRIWULAN'));
  return {
    kpiMarker,
    kpiHeader:kpiMarker>=0?kpiMarker+1:-1,
    kpiStart:kpiMarker>=0?kpiMarker+2:-1,
    kpiEnd:monthlyMarker>kpiMarker && monthlyMarker>=0?monthlyMarker-3:-1,
    monthlyMarker,
    monthlyHeader:monthlyMarker>=0?monthlyMarker+1:-1,
    monthlyStart:monthlyMarker>=0?monthlyMarker+2:-1,
    monthlyEnd:quarterMarker>monthlyMarker && quarterMarker>=0?quarterMarker-2:-1,
    quarterMarker,
    quarterHeader:quarterMarker>=0?quarterMarker+1:-1,
    quarterStart:quarterMarker>=0?quarterMarker+2:-1,
    quarterEnd:quarterMarker>=0?Math.min(rows.length-1,quarterMarker+6):-1
  };
}

export function isMonevReportComputedCell(sheet,row,col,sheetObj){
  if(sheet!==MONEV_REPORT_SHEET) return false;
  const l=findMonevReportLayout(sheetObj);
  if(l.kpiStart>=0 && row>=l.kpiStart && row<=l.kpiEnd) return true;
  if(l.quarterStart>=0 && row>=l.quarterStart && row<=l.quarterEnd) return true;
  if(l.monthlyStart>=0 && row>=l.monthlyStart && row<l.monthlyStart+12 && col===6) return true;
  return false;
}

function copyKpiSection(sheet,payload,layout,sectionStart){
  const rows=sourceRows(payload);
  const start=sectionStart;
  const needed=start+2+rows.length;
  ensureRows(sheet,Math.max(sheet.values.length,needed),17);
  setValue(sheet,start,0,'KPI PER TRIWULAN (AUTO DARI MONEV RENAKSI IKU)');
  const header=['No','Sasaran','Indikator KPI','Satuan','Target Tahunan','Target TW 1','Realisasi TW 1','Capaian TW 1','Target TW 2','Realisasi TW 2','Capaian TW 2','Target TW 3','Realisasi TW 3','Capaian TW 3','Target TW 4','Realisasi TW 4','Capaian TW 4'];
  sheet.values[start+1]=header;
  sheet.formulas={...(sheet.formulas||{})};
  for(const key of Object.keys(sheet.formulas)){
    const m=key.match(/^([A-Z]+)(\d+)$/); if(!m) continue;
    const rr=Number(m[2])-1;
    if(rr>=start+2 && rr<start+2+Math.max(rows.length,0) && Number(m[2])<=sheet.values.length) delete sheet.formulas[key];
  }
  rows.forEach((item,i)=>{
    const r=start+2+i;
    const vals=[item.no,item.sasaran,item.indicator,item.unit,item.targets[3],item.targets[0],item.realizations[0],'',item.targets[1],item.realizations[1],'',item.targets[2],item.realizations[2],'',item.targets[3],item.realizations[3],''];
    for(let c=0;c<vals.length;c++) setValue(sheet,r,c,vals[c]);
    const caps=[[5,6,7],[8,9,10],[11,12,13],[14,15,16]];
    for(const [tc,rc,cc] of caps){
      const value=formulaValue(num(vals[tc]),num(vals[rc]));
      setFormula(sheet,r,cc,`=IF(OR(${col(tc)}${r+1}="",${col(rc)}${r+1}="",${col(tc)}${r+1}=0),"",${col(rc)}${r+1}/${col(tc)}${r+1})`,value);
    }
  });
  return {start,end:start+1+rows.length,rows:rows.length};
}

function writeMonthlySection(sheet,start){
  ensureRows(sheet,start+15,17);
  setValue(sheet,start,0,'REALISASI FISIK & KEUANGAN PER BULAN (INPUT)');
  sheet.values[start+1]=['Bulan','TW','Target Fisik (%)','Realisasi Fisik (%)','Anggaran Keuangan (Rp)','Realisasi Keuangan (Rp)','Serapan Keuangan (%)'];
  for(let i=0;i<12;i++){
    const r=start+2+i;
    setValue(sheet,r,0,MONTHS[i]);
    setValue(sheet,r,1,`TW ${Math.floor(i/3)+1}`);
    // Preserve existing values when a sheet is refreshed.
    if(sheet.values[r]?.length < 7) sheet.values[r]=[sheet.values[r]?.[0]??'',sheet.values[r]?.[1]??'',sheet.values[r]?.[2]??'',sheet.values[r]?.[3]??'',sheet.values[r]?.[4]??'',sheet.values[r]?.[5]??'',sheet.values[r]?.[6]??''];
    const budget=num(sheet.values[r]?.[4]); const real=num(sheet.values[r]?.[5]);
    setFormula(sheet,r,6,`=IF(OR(E${r+1}="",F${r+1}="",E${r+1}=0),"",F${r+1}/E${r+1})`,formulaValue(budget,real));
  }
  return {start,end:start+13,rows:12};
}

function writeQuarterSection(sheet,start,monthlyStart){
  ensureRows(sheet,start+8,17);
  setValue(sheet,start,0,'REKAP REALISASI FISIK & KEUANGAN PER TRIWULAN (AUTO)');
  sheet.values[start+1]=['TW','Bulan Terakhir','Target Fisik TW (%)','Realisasi Fisik TW (%)','Anggaran Keuangan TW (Rp)','Realisasi Keuangan TW (Rp)','Serapan Keuangan TW (%)','Sisa Dana TW (Rp)'];
  const months=QUARTERS.map(q=>q.end);
  QUARTERS.forEach((q,i)=>{
    const r=start+2+i;
    const first=monthlyStart+2+q.start;
    const last=monthlyStart+2+q.end;
    setValue(sheet,r,0,q.label);
    setValue(sheet,r,1,q.endMonth);
    setFormula(sheet,r,2,`=C${last+1}`,num(sheet.values[last]?.[2]));
    setFormula(sheet,r,3,`=D${last+1}`,num(sheet.values[last]?.[3]));
    const b=sumRange(sheet,4,q.start,q.end,monthlyStart+2);
    const f=sumRange(sheet,5,q.start,q.end,monthlyStart+2);
    setFormula(sheet,r,4,`=SUM(E${first+1}:E${last+1})`,b);
    setFormula(sheet,r,5,`=SUM(F${first+1}:F${last+1})`,f);
    setFormula(sheet,r,6,`=IF(E${r+1}=0,"",F${r+1}/E${r+1})`,b!==null&&f!==null&&b!==0?+(f/b).toFixed(6):'');
    setFormula(sheet,r,7,`=IF(E${r+1}="","",E${r+1}-F${r+1})`,b!==null&&f!==null?b-f:'');
  });
  const ar=start+6;
  setValue(sheet,ar,0,'TAHUNAN');
  setValue(sheet,ar,1,'Januari–Desember');
  const last=monthlyStart+13;
  setFormula(sheet,ar,2,`=C${last+1}`,num(sheet.values[last]?.[2]));
  setFormula(sheet,ar,3,`=D${last+1}`,num(sheet.values[last]?.[3]));
  const b=sumRange(sheet,4,0,11,monthlyStart+2); const f=sumRange(sheet,5,0,11,monthlyStart+2);
  setFormula(sheet,ar,4,`=SUM(E${monthlyStart+3}:E${monthlyStart+14})`,b);
  setFormula(sheet,ar,5,`=SUM(F${monthlyStart+3}:F${monthlyStart+14})`,f);
  setFormula(sheet,ar,6,`=IF(E${ar+1}=0,"",F${ar+1}/E${ar+1})`,b!==null&&f!==null&&b!==0?+(f/b).toFixed(6):'');
  setFormula(sheet,ar,7,`=IF(E${ar+1}="","",E${ar+1}-F${ar+1})`,b!==null&&f!==null?b-f:'');
  return {start,end:ar,rows:5};
}

function sumRange(sheet,colIndex,startOffset,endOffset,startRow){
  let total=0, has=false;
  for(let i=startOffset;i<=endOffset;i++){
    const v=num(sheet.values[startRow+i]?.[colIndex]);
    if(v!==null){ total+=v; has=true; }
  }
  return has?total:null;
}

export function createMonevReportSheet(payload,year,existing=null){
  const sheet=existing?clone(existing):{name:MONEV_REPORT_SHEET,rows:0,cols:17,values:[],formulas:{}};
  sheet.name=MONEV_REPORT_SHEET; sheet.formulas={...(sheet.formulas||{})};
  if(!existing || !(sheet.values||[]).length){
    sheet.values=[
      ['LAPORAN MONEV RENAKSI DAN REALISASI KINERJA',...Array(16).fill('')],
      ['INSPEKTORAT DAERAH KABUPATEN MAHAKAM ULU',...Array(16).fill('')],
      [`TAHUN ANGGARAN ${year}`,...Array(16).fill('')],
      Array(17).fill('')
    ];
  }
  const currentLayout=findMonevReportLayout(sheet);
  let changed=false;
  if(currentLayout.kpiMarker<0 || currentLayout.monthlyMarker<0 || currentLayout.quarterMarker<0){
    const start=Math.max(sheet.values.length+2,25);
    copyKpiSection(sheet,payload,currentLayout,start); changed=true;
    const monthlyStart=start+4+sourceRows(payload).length;
    // Copy any existing monthly values only if the markers already existed; this path is a new structure.
    writeMonthlySection(sheet,monthlyStart);
    writeQuarterSection(sheet,monthlyStart+15,monthlyStart);
  } else {
    // Refresh KPI data from source, while keeping all monthly operator inputs.
    const rows=sourceRows(payload);
    const l=findMonevReportLayout(sheet);
    const expectedEnd=l.kpiStart+rows.length-1;
    if(l.kpiStart>=0 && (l.kpiEnd-l.kpiStart+1)===rows.length){
      rows.forEach((item,i)=>{
        const r=l.kpiStart+i;
        setValue(sheet,r,0,item.no); setValue(sheet,r,1,item.sasaran); setValue(sheet,r,2,item.indicator); setValue(sheet,r,3,item.unit);
        const vals=[item.targets[3],item.targets[0],item.realizations[0],item.targets[1],item.realizations[1],item.targets[2],item.realizations[2],item.targets[3],item.realizations[3]];
        setValue(sheet,r,4,vals[0]); setValue(sheet,r,5,vals[1]); setValue(sheet,r,6,vals[2]);
        setFormula(sheet,r,7,`=IF(OR(F${r+1}="",G${r+1}="",F${r+1}=0),"",G${r+1}/F${r+1})`,formulaValue(num(vals[1]),num(vals[2])));
        setValue(sheet,r,8,vals[3]); setValue(sheet,r,9,vals[4]); setFormula(sheet,r,10,`=IF(OR(I${r+1}="",J${r+1}="",I${r+1}=0),"",J${r+1}/I${r+1})`,formulaValue(num(vals[3]),num(vals[4])));
        setValue(sheet,r,11,vals[5]); setValue(sheet,r,12,vals[6]); setFormula(sheet,r,13,`=IF(OR(L${r+1}="",M${r+1}="",L${r+1}=0),"",M${r+1}/L${r+1})`,formulaValue(num(vals[5]),num(vals[6])));
        setValue(sheet,r,14,vals[7]); setValue(sheet,r,15,vals[8]); setFormula(sheet,r,16,`=IF(OR(O${r+1}="",P${r+1}="",O${r+1}=0),"",P${r+1}/O${r+1})`,formulaValue(num(vals[7]),num(vals[8])));
      });
      setValue(sheet,l.kpiMarker+0,0,'KPI PER TRIWULAN (AUTO DARI MONEV RENAKSI IKU)');
      writeMonthlySection(sheet,l.monthlyMarker);
      writeQuarterSection(sheet,l.quarterMarker,l.monthlyMarker);
    } else {
      return createMonevReportSheet({...payload},year,undefined);
    }
  }
  // Keep year text current without touching operator-entered numbers.
  if(sheet.values[2]?.[0]) sheet.values[2][0]=`TAHUN ANGGARAN ${year}`;
  sheet.rows=sheet.values.length; sheet.cols=Math.max(17,...sheet.values.map(r=>r?.length||0));
  return {sheet,changed};
}

export function ensureMonevReport(payload,year){
  if(!payload?.sheets) return {payload,changed:false};
  const existing=payload.sheets[MONEV_REPORT_SHEET];
  const built=createMonevReportSheet(payload,year,existing);
  const out=clone(payload);
  out.sheets[MONEV_REPORT_SHEET]=built.sheet;
  out.meta={...(out.meta||{}),year:Number(year),sheetCount:Object.keys(out.sheets).length};
  return {payload:out,changed:!existing || built.changed};
}

export function prepareBlankMonevReport(sheet,year){
  const s=clone(sheet||{});
  const l=findMonevReportLayout(s);
  if(l.monthlyStart>=0){
    for(let i=0;i<12;i++){
      const r=l.monthlyStart+i;
      for(const c of [2,3,4,5]) setValue(s,r,c,'');
      setFormula(s,r,6,`=IF(OR(E${r+1}="",F${r+1}="",E${r+1}=0),"",F${r+1}/E${r+1})`,'');
    }
  }
  if(s.values?.[2]?.[0]) s.values[2][0]=`TAHUN ANGGARAN ${year}`;
  return s;
}

function pctValue(v){ return v===null||v===''||v===undefined?'—':`${Number(v).toLocaleString('id-ID',{maximumFractionDigits:2})}%`; }
function moneyValue(v){ return v===null||v===''||v===undefined?'—':new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(v)).replace(/\u00a0/g,' '); }

export function MonevRenaksiPage({payload,updateCell,onOpenSheet,year,dirty}){
  const sheet=payload?.sheets?.[MONEV_REPORT_SHEET];
  const l=findMonevReportLayout(sheet);
  if(!sheet || l.kpiStart<0 || l.monthlyStart<0 || l.quarterStart<0){
    return <section className="page"><div className="panel"><h2>Laporan Monev Renaksi belum tersedia</h2><p>Simpan atau buka tahun aktif untuk membuat struktur KPI per triwulan serta realisasi fisik/keuangan bulanan.</p><button className="primary" onClick={onOpenSheet}>Buka sheet Laporan Monev Renaksi</button></div></section>;
  }
  const kpiRows=(sheet.values||[]).slice(l.kpiStart,l.kpiEnd+1).filter(r=>text(r?.[2]));
  const monthly=(sheet.values||[]).slice(l.monthlyStart,l.monthlyStart+12);
  const quarterly=(sheet.values||[]).slice(l.quarterStart,l.quarterStart+5);
  const input=(r,c,e)=>updateCell(MONEV_REPORT_SHEET,r,c,e.target.value);
  return <section className="page monev-page">
    <div className="monev-head panel">
      <div><span className="eyebrow">MONITORING & EVALUASI • TA {year}</span><h2>Laporan Monev Renaksi</h2><p>KPI per triwulan mengikuti sumber <b>Monev Renaksi IKU</b>. Realisasi fisik dan keuangan dicatat per bulan dan direkap otomatis per triwulan.</p></div>
      <div className="monev-head-actions"><span className={dirty?'state dirty':'state'}>{dirty?'● Ada perubahan':'● Tersimpan'}</span><button className="soft" onClick={onOpenSheet}>▦ Buka sheet lengkap</button></div>
    </div>
    <div className="monev-card panel">
      <div className="editor-meta"><div><span className="eyebrow">KPI PER TRIWULAN</span><b>Pencapaian KPI Renaksi</b><small>{kpiRows.length} indikator • otomatis mengikuti Monev Renaksi IKU</small></div><span className="auto-badge">AUTO SYNC KPI</span></div>
      <div className="scroll-table monev-table"><table><thead><tr><th>No</th><th>Indikator KPI</th><th>Satuan</th><th>TW 1<br/><small>T / R / %</small></th><th>TW 2<br/><small>T / R / %</small></th><th>TW 3<br/><small>T / R / %</small></th><th>TW 4<br/><small>T / R / %</small></th></tr></thead><tbody>{kpiRows.map((r,i)=><tr key={i}><td>{r[0]}</td><td><b>{r[2]}</b><small>{r[1]||'—'}</small></td><td>{r[3]||'—'}</td>{[[5,6,7],[8,9,10],[11,12,13],[14,15,16]].map(([t,x,p])=><td key={t}><div className="triad"><span>{text(r[t])||'—'}</span><span>{text(r[x])||'—'}</span><strong>{pctValue(r[p]!==''&&r[p]!==null?r[p]*100:null)}</strong></div></td>)}</tr>)}</tbody></table></div>
    </div>
    <div className="monev-card panel">
      <div className="editor-meta"><div><span className="eyebrow">REALISASI BULANAN</span><b>Fisik & Keuangan per Bulan</b><small>Kolom input: target fisik, realisasi fisik, anggaran, realisasi keuangan • serapan otomatis</small></div><span className="input-badge">INPUT BULANAN</span></div>
      <div className="scroll-table monev-table"><table><thead><tr><th>Bulan</th><th>TW</th><th>Target Fisik (%)</th><th>Realisasi Fisik (%)</th><th>Anggaran (Rp)</th><th>Realisasi Keuangan (Rp)</th><th>Serapan (%)</th></tr></thead><tbody>{monthly.map((r,i)=>{const rr=l.monthlyStart+i;return <tr key={i}><td><b>{r?.[0]}</b></td><td>{r?.[1]}</td><td><input className="monev-input" inputMode="decimal" value={r?.[2]??''} onChange={e=>input(rr,2,e)} /></td><td><input className="monev-input" inputMode="decimal" value={r?.[3]??''} onChange={e=>input(rr,3,e)} /></td><td><input className="monev-input money-input" inputMode="decimal" value={r?.[4]??''} onChange={e=>input(rr,4,e)} /></td><td><input className="monev-input money-input" inputMode="decimal" value={r?.[5]??''} onChange={e=>input(rr,5,e)} /></td><td className="computed-cell">{pctValue(r?.[6]!==''&&r?.[6]!=null?r[6]*100:null)}</td></tr>})}</tbody></table></div>
    </div>
    <div className="monev-card panel">
      <div className="editor-meta"><div><span className="eyebrow">REKAP TRIWULAN</span><b>Fisik & Keuangan per TW</b><small>Fisik memakai posisi bulan terakhir; keuangan diakumulasi dari bulan dalam TW</small></div><span className="auto-badge">AUTO CALC</span></div>
      <div className="scroll-table monev-table"><table><thead><tr><th>TW</th><th>Bulan Terakhir</th><th>Target Fisik</th><th>Realisasi Fisik</th><th>Anggaran TW</th><th>Realisasi Keuangan TW</th><th>Serapan TW</th><th>Sisa Dana TW</th></tr></thead><tbody>{quarterly.map((r,i)=><tr key={i} className={r?.[0]==='TAHUNAN'?'annual-row':''}><td><b>{r?.[0]}</b></td><td>{r?.[1]}</td><td>{pctValue(r?.[2])}</td><td>{pctValue(r?.[3])}</td><td>{moneyValue(r?.[4])}</td><td>{moneyValue(r?.[5])}</td><td>{pctValue(r?.[6]!=null&&r?.[6]!==''?r[6]*100:null)}</td><td>{moneyValue(r?.[7])}</td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
