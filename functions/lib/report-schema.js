// Shared, pure schema for the official workbook report. The automatic analytical
// "Laporan Monev Renaksi" is NOT the same sheet and must never be fuzzy-merged.
export const OFFICIAL_REPORT_2026 = 'Laporan_Monev_Renaksi_2026';
export const officialReportName = year => `Laporan_Monev_Renaksi_${Number(year)}`;
export const isOfficialReportName = name => /^Laporan[_ ]Monev[_ ]Renaksi[_ ]20\d{2}$/i.test(String(name||'').trim());
const isAnalyticalReport = name => String(name||'').replace(/[_\s]+/g,' ').trim().toLowerCase() === 'laporan monev renaksi';
export function compatibleSheetNames(a,b){
  if(isOfficialReportName(a)||isOfficialReportName(b)||isAnalyticalReport(a)||isAnalyticalReport(b)){
    return String(a||'').replace(/[_\s]+/g,' ').toLowerCase().trim()===String(b||'').replace(/[_\s]+/g,' ').toLowerCase().trim();
  }
  return true;
}
const text = value => String(value??'').trim();
const amount = value => {
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const raw=text(value).replace(/\s/g,'');if(!raw||!/^[-+]?\d[\d.,]*$/.test(raw))return null;
  const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
  const valueNumber=Number(normalized);return Number.isFinite(valueNumber)?valueNumber:null;
};
export function summarizeOfficialMonev(sheet){
  const data=sheet?.values||sheet;
  if(!Array.isArray(data)) return {available:false,activities:0,plannedBudget:null,realizedBudget:null,reportedRealizations:0,missingRealizations:0};
  // Source workbook has 8 heading rows and the official header O=activity,
  // T=budget, U=realization, V=notes, W=follow-up, X=owner.
  // Schema maps protect these columns when users insert columns in Google Sheets.
  const align = row => !sheet?.schemaColumns?.length?row:sheet.schemaColumns.reduce((a,c)=>{a[c.original]=row?.[c.current];return a;},[]);
  const activities=data.slice(8).map(align).filter(r=>text(r?.[14]) && amount(r?.[19])!==null);
  const realized=activities.map(r=>amount(r?.[20])).filter(v=>v!==null);
  return {
    available:true,activities:activities.length,
    plannedBudget:activities.reduce((a,r)=>a+amount(r[19]),0),
    realizedBudget:realized.length?realized.reduce((a,v)=>a+v,0):null,
    reportedRealizations:realized.length,missingRealizations:activities.length-realized.length,
    notesRecorded:activities.filter(r=>text(r?.[21])).length,
    followUpsRecorded:activities.filter(r=>text(r?.[22])).length,
    source:'Laporan Monev Renaksi resmi (kolom O, T, U, V, W, X)'
  };
}
