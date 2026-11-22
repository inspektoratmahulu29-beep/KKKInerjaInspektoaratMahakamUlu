/**
 * Expand OOXML shared formulas before importing. SheetJS 0.18 can expose the
 * cached value but not the child formula for <f t="shared" si="..."/> cells.
 * Dropping those formulas makes a later update appear to break the workbook.
 * No third-party package, upload or access to external services is required.
 */
const decoder = new TextDecoder('utf-8');
const parseCell = address => {
  const m = String(address).match(/^\$?([A-Z]{1,3})\$?(\d+)$/i);
  if (!m) return null;
  return {row:Number(m[2]),column:[...m[1].toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)};
};
const columnLetters = index => {
  let n=index, out='';
  while (n>0) { n--; out=String.fromCharCode(65+n%26)+out; n=Math.floor(n/26); }
  return out;
};

export function translateSharedFormula(formula, fromCell, toCell) {
  const source=parseCell(fromCell), dest=parseCell(toCell);
  if (!source || !dest) throw new Error(`Alamat formula bersama tidak valid: ${fromCell}/${toCell}`);
  const rowDelta=dest.row-source.row, colDelta=dest.column-source.column;
  // Quoted strings never contain real cell references; preserve them verbatim.
  return String(formula).split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/g).map((part,i)=>i%2?part:part.replace(/(^|[^A-Za-z0-9_.])((\$?)([A-Za-z]{1,3})(\$?)(\d+))(?![A-Za-z0-9_.]|\s*\()/g,(whole,prefix,ref,absCol,letters,absRow,row)=>{
    const colIndex=[...letters.toUpperCase()].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0);
    const nextCol=colIndex+(absCol?0:colDelta), nextRow=Number(row)+(absRow?0:rowDelta);
    if (nextCol<1 || nextRow<1) throw new Error(`Rumus bersama melewati batas sheet: ${fromCell} → ${toCell}`);
    return prefix+absCol+columnLetters(nextCol)+absRow+nextRow;
  })).join('');
}

function zipEntries(buffer) {
  const bytes=new Uint8Array(buffer), dv=new DataView(buffer);
  let eocd=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65558);p--){if(dv.getUint32(p,true)===0x06054b50){eocd=p;break;}}
  if(eocd<0)throw new Error('Arsip Excel tidak valid (ZIP EOCD tidak ditemukan).');
  const entryCount=dv.getUint16(eocd+10,true), directory=dv.getUint32(eocd+16,true);
  if(entryCount===65535||directory===0xffffffff)throw new Error('Format ZIP64 belum didukung untuk impor Excel ini.');
  let p=directory;const files=new Map();
  for(let i=0;i<entryCount;i++){
    if(p+46>bytes.length||dv.getUint32(p,true)!==0x02014b50)throw new Error('Indeks file Excel rusak.');
    const method=dv.getUint16(p+10,true),size=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),extra=dv.getUint16(p+30,true),comment=dv.getUint16(p+32,true),offset=dv.getUint32(p+42,true);
    const name=decoder.decode(bytes.subarray(p+46,p+46+nameLen)).replace(/^\//,'');
    files.set(name,{method,size,offset});p+=46+nameLen+extra+comment;
  }
  return {bytes,dv,files};
}
async function xmlFile(zip,path){
  const meta=zip.files.get(path);
  if(!meta)return null;
  const p=meta.offset;
  if(zip.dv.getUint32(p,true)!==0x04034b50)throw new Error(`Arsip Excel rusak pada ${path}.`);
  const start=p+30+zip.dv.getUint16(p+26,true)+zip.dv.getUint16(p+28,true);
  if(start+meta.size>zip.bytes.length)throw new Error(`Isi ${path} terpotong.`);
  const data=zip.bytes.subarray(start,start+meta.size);
  if(meta.method===0)return decoder.decode(data);
  if(meta.method!==8)throw new Error(`Kompresi tidak didukung pada ${path}.`);
  if(typeof DecompressionStream!=='function')throw new Error('Browser belum mendukung pembacaan shared formula Excel (DecompressionStream).');
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return decoder.decode(await new Response(stream).arrayBuffer());
}
const parseXml=text=>{
  const dom=new DOMParser().parseFromString(text,'application/xml');
  if(dom.getElementsByTagName('parsererror').length)throw new Error('XML Excel tidak dapat dibaca.');
  return dom;
};
const elements=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
function targetPath(target){
  const combined=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target;
  const parts=[];
  for(const segment of combined.split('/')){if(segment==='..')parts.pop();else if(segment && segment!=='.')parts.push(segment);}
  return parts.join('/');
}

/** @returns {Promise<{expanded:number,unresolved:string[]}>} */
export async function expandExcelSharedFormulas(buffer, workbook) {
  // Legacy .xls is an OLE/BIFF file, not an OOXML ZIP. SheetJS already
  // handles its formula records, so only expand OOXML shared-formula groups.
  const header=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));
  if(header[0]!==0x50||header[1]!==0x4b) return {expanded:0,unresolved:[]};
  const zip=zipEntries(buffer);
  const workbookXml=await xmlFile(zip,'xl/workbook.xml');
  const relsXml=await xmlFile(zip,'xl/_rels/workbook.xml.rels');
  if(!workbookXml||!relsXml)throw new Error('Metadata workbook tidak ditemukan.');
  const workbookDoc=parseXml(workbookXml),relsDoc=parseXml(relsXml);
  const rels=new Map(elements(relsDoc,'Relationship').map(x=>[x.getAttribute('Id'),targetPath(x.getAttribute('Target')||'')]));
  const targets=new Map(elements(workbookDoc,'sheet').map(x=>[x.getAttribute('name'),rels.get(x.getAttribute('r:id')||x.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))]));
  let expanded=0;const unresolved=[];
  for(const name of workbook.SheetNames){
    const path=targets.get(name);if(!path)continue;
    const source=await xmlFile(zip,path);if(!source)continue;
    const dom=parseXml(source),ws=workbook.Sheets[name];
    const anchors=new Map(),children=[];
    for(const c of elements(dom,'c')){
      const f=elements(c,'f')[0];
      if(!f || f.getAttribute('t')!=='shared')continue;
      const a=c.getAttribute('r'),group=f.getAttribute('si');
      if(!a||group===null)continue;
      const text=f.textContent?.trim()||'';
      if(text)anchors.set(group,{address:a,formula:text});
      children.push({address:a,group,formula:text});
    }
    for(const item of children){
      const base=anchors.get(item.group);
      if(!base){unresolved.push(`${name}!${item.address} (shared group ${item.group})`);continue;}
      const formula=item.formula||translateSharedFormula(base.formula,base.address,item.address);
      if(!ws[item.address])ws[item.address]={t:'n'};
      if(!ws[item.address].f || !item.formula){ws[item.address].f=formula;expanded++;}
    }
  }
  return {expanded,unresolved};
}
