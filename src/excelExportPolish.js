/**
 * Penataan Excel hasil ekspor langsung dari seluruh sheet master.
 * Mempertahankan rumus, data, merged cells; meningkatkan lebar kolom,
 * wrap text, baris judul, freeze header, dan border/warna header pada OOXML.
 * JSZip dipasang lokal (public/vendor), bukan layanan pihak ketiga.
 */
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const plain = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const calcWidth = (s) => Math.max(11, Math.min(46, Math.ceil(s / 1.6) + 5));
const financeLabel = s => /^(?:pagu|anggaran|realisasi\s+keuangan|sisa(?:\s+dana|\s+anggaran)?|(?:rencana\s+)?biaya|(?:nilai\s+)?spj|total\s+anggaran)/i.test(plain(s));
function locateHeaders(ws, XLSX) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  let winner = {row: -1, score: 0, labels: []};
  for(let r=0;r<=Math.min(range.e.r,21);r++){
    const labels=[]; let score=0;
    for(let c=range.s.c;c<=Math.min(range.e.c,110);c++){
      const cell=ws[XLSX.utils.encode_cell({r,c})], value=plain(cell?.v);
      if(value) {labels.push({c,label:value});if(/\b(?:program|kegiatan|subkegiatan|anggaran|pagu|realisasi|nama|target|jenis|kode|SPJ|PPTK|No\.?|status|uraian|rencana|bukti)\b/i.test(value))score++;}
    }
    if(score>Math.max(2,winner.score) && labels.length>=3)winner={row:r,score,labels};
  }
  return winner;
}
function polishColumns(ws, XLSX) {
  const range=XLSX.utils.decode_range(ws['!ref']||'A1');
  const heads=locateHeaders(ws,XLSX);
  const end=Math.min(range.e.c,300),lastRow=Math.min(range.e.r,900);
  ws['!cols']=Array.from({length:end+1},(_,col)=>{
    const existing=ws['!cols']?.[col];
    const existingW=Number(existing?.wch ?? (existing?.wpx?existing.wpx/7.5:0));
    let width=11;
    for(let row=range.s.r;row<=lastRow;row++){
      const c=ws[XLSX.utils.encode_cell({r:row,c:col})];
      if(c?.v==null||c?.v==='')continue;
      const v=plain(c.v);
      if(typeof c.v==='number')width=Math.max(width,Math.min(21,Math.ceil(String(v).length)+3));
      else width=Math.max(width,calcWidth(v.length));
    }
    const likelyText=(heads.labels.find(x=>x.c===col)?.label||'');
    if(/program|subkegiatan|kegiatan|uraian|rincian|permasalahan|pembuktian|catatan|nama|keterangan|objek/i.test(likelyText))width=Math.max(width,27);
    return {...(existing||{}),wch:Math.max(11,Math.min(50,Math.max(width,Number.isFinite(existingW)?Math.min(existingW,50):0)))};
  });
  ws['!rows']=Array.from({length:Math.min(range.e.r+1,2100)},(_,row)=>{
    const old=ws['!rows']?.[row];let lines=1;
    for(let col=range.s.c;col<=end;col++){
      const v=ws[XLSX.utils.encode_cell({r:row,c:col})]?.v;
      if(typeof v!=='string'||v==='')continue;
      const linesForCell=Math.ceil(v.length/Math.max(12,(ws['!cols']?.[col]?.wch||25)*1.25));
      lines=Math.max(lines,Math.min(4,linesForCell));
    }
    const hpt=row===heads.row?Math.max(34,Math.min(54,17*lines)):row===0?27:Math.max(18,Math.min(67,17*lines));
    return {...(old||{}),hpt:Math.max(old?.hpt||0,hpt)};
  });
  const headerMoney=new Set(heads.labels.filter(x=>financeLabel(x.label)).map(x=>x.c));
  for(const c of headerMoney){
    for(let r=heads.row+1;r<=range.e.r;r++){
      const a=XLSX.utils.encode_cell({r,c});const cell=ws[a];
      if(cell && cell.t==='n' && !cell.z)cell.z='#,##0;[Red](#,##0);0';
    }
  }
  // Jangan menambahkan AutoFilter ke baris yang memiliki merged cells,
  // karena akan menyebabkan Excel menolak filter pada workbook tersebut.
  if(heads.row>=0 && !ws['!autofilter'] && range.e.r>heads.row+2 &&
      !(ws['!merges']||[]).some(m=>m.s.r<=heads.row&&m.e.r>=heads.row)){
    ws['!autofilter']={ref:`A${heads.row+1}:${XLSX.utils.encode_col(end)}${range.e.r+1}`};
  }
  return heads;
}
function appendNode(doc, parent, local, attrs={}){
  const e=doc.createElementNS(NS,local);
  for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));
  parent.appendChild(e);return e;
}
function appendStyles(doc){
  const root=doc.documentElement;
  const children=name=>root.getElementsByTagNameNS(NS,name)[0];
  const fonts=children('fonts'),fills=children('fills'),xfs=children('cellXfs');
  if(!fonts||!fills||!xfs)throw new Error('Struktur styles.xml tidak lengkap');
  const fontId=Array.from(fonts.childNodes).filter(n=>n.nodeType===1).length;
  const headerFont=appendNode(doc,fonts,'font');appendNode(doc,headerFont,'b');appendNode(doc,headerFont,'sz',{val:11});appendNode(doc,headerFont,'color',{rgb:'FFFFFFFF'});appendNode(doc,headerFont,'name',{val:'Aptos'});
  const titleFont=appendNode(doc,fonts,'font');appendNode(doc,titleFont,'b');appendNode(doc,titleFont,'sz',{val:13});appendNode(doc,titleFont,'color',{rgb:'FF124939'});appendNode(doc,titleFont,'name',{val:'Aptos'});
  fonts.setAttribute('count',Array.from(fonts.childNodes).filter(n=>n.nodeType===1).length);
  const fillId=Array.from(fills.childNodes).filter(n=>n.nodeType===1).length;
  const fill=appendNode(doc,fills,'fill');const p=appendNode(doc,fill,'patternFill',{patternType:'solid'});appendNode(doc,p,'fgColor',{rgb:'FF174B54'});appendNode(doc,p,'bgColor',{indexed:64});
  fills.setAttribute('count',Array.from(fills.childNodes).filter(n=>n.nodeType===1).length);
  const addXf=(font,background,header=false)=>{
    const index=Array.from(xfs.childNodes).filter(n=>n.nodeType===1).length;
    const xf=appendNode(doc,xfs,'xf',{numFmtId:0,fontId:font,fillId:background,borderId:0,xfId:0,applyFont:1,applyAlignment:1,...(header?{applyFill:1}:{})});
    appendNode(doc,xf,'alignment',{vertical:'center',horizontal:'left',wrapText:1});return index;
  };
  const regular=addXf(0,0),header=addXf(fontId,fillId,true),title=addXf(fontId+1,0);
  xfs.setAttribute('count',Array.from(xfs.childNodes).filter(n=>n.nodeType===1).length);
  return {regular,header,title};
}
function styleSheetXml(xml,head,styleIds){
  const parser=new DOMParser(),doc=parser.parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('XML sheet tidak valid');
  const body=doc.getElementsByTagNameNS(NS,'sheetData')[0];
  if(!body)return xml;
  const rows=body.getElementsByTagNameNS(NS,'row');
  for(const row of rows){
    const r=Number(row.getAttribute('r'));
    for(const cell of row.getElementsByTagNameNS(NS,'c')){
      // Sel numerik yang memiliki format angka bawaan tetap dipertahankan.
      if(cell.hasAttribute('s') && cell.getAttribute('s')!=='0' && r!==head.row+1)continue;
      cell.setAttribute('s',String(r===head.row+1?styleIds.header:r===1?styleIds.title:styleIds.regular));
    }
  }
  let view=doc.getElementsByTagNameNS(NS,'sheetView')[0];
  if(!view){
    const views=doc.createElementNS(NS,'sheetViews');
    view=doc.createElementNS(NS,'sheetView');view.setAttribute('workbookViewId','0');
    views.appendChild(view);
    // Sesuai urutan elemen SpreadsheetML, sheetViews ditempatkan
    // sebelum sheetFormatPr/cols/sheetData.
    const next=doc.getElementsByTagNameNS(NS,'sheetFormatPr')[0]||doc.getElementsByTagNameNS(NS,'sheetData')[0];
    if(next)doc.documentElement.insertBefore(views,next);
  }
  if(view){
    view.setAttribute('showGridLines','0');
    if(head.row>=0&&head.row<16&&!view.getElementsByTagNameNS(NS,'pane').length){
      const pane=doc.createElementNS(NS,'pane');
      pane.setAttribute('ySplit',String(head.row+1));pane.setAttribute('topLeftCell',`A${head.row+2}`);
      pane.setAttribute('activePane','bottomLeft');pane.setAttribute('state','frozen');
      view.insertBefore(pane,view.firstChild);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
/** Returns an ArrayBuffer, without touching any cell's source formula. */
export async function formatExcelExport(wb,XLSX){
 const heads=wb.SheetNames.map(name=>polishColumns(wb.Sheets[name],XLSX));
 const binary=XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true});
 if(!window.JSZip)throw new Error('Komponen penataan Excel belum dimuat. Muat ulang aplikasi.');
 const zip=await window.JSZip.loadAsync(binary);
 const file=zip.file('xl/styles.xml');
 if(!file)throw new Error('File gaya Excel tidak tersedia');
 const parser=new DOMParser(),styleDoc=parser.parseFromString(await file.async('string'),'application/xml');
 if(styleDoc.getElementsByTagName('parsererror').length)throw new Error('Gaya Excel tidak valid');
 const styles=appendStyles(styleDoc);
 zip.file('xl/styles.xml',new XMLSerializer().serializeToString(styleDoc));
 for(let i=0;i<heads.length;i++){
  const key=`xl/worksheets/sheet${i+1}.xml`,part=zip.file(key);
  if(part)zip.file(key,styleSheetXml(await part.async('string'),heads[i],styles));
 }
 return await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE',compressionOptions:{level:6}});
}
