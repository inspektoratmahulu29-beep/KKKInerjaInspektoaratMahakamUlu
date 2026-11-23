import { getGoogleAccessToken } from './google.js';

const API_ROOT = 'https://sheets.googleapis.com/v4';
const MAX_WRITE_ROWS = 700;
const REQUEST_TIMEOUT_MS = 25000;

function q(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

export async function request(env, path, init = {}, accessToken = null) {
  const token = accessToken || await getGoogleAccessToken(env);
  let lastError = null;
  for (let attempt = 0; attempt < (init.noRetry ? 1 : 4); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${API_ROOT}/${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers || {})
        }
      });
    } catch (e) {
      lastError = e?.name === 'AbortError' ? new Error('Google Sheets request timeout') : e;
      lastError.status = 504;
      if (init.noRetry || attempt === 3) break;
      await new Promise(r => setTimeout(r, 400 * (2 ** attempt) + Math.floor(Math.random() * 250)));
      continue;
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (res.ok) return data;

    const message = data?.error?.message || `Google Sheets ${res.status}`;
    lastError = new Error(message);
    lastError.status = res.status;

    // Transient Google/API gateway errors get a short backoff.
    if (init.noRetry || ![429, 500, 502, 503, 504].includes(res.status) || attempt === 3) break;
    const retryAfter = Number(res.headers.get('retry-after') || 0);
    const backoff = retryAfter > 0 ? Math.min(8000, retryAfter * 1000) : Math.min(8000, 400 * (2 ** attempt) + Math.floor(Math.random() * 250));
    await new Promise(r => setTimeout(r, backoff));
  }
  throw lastError || new Error('Google Sheets request failed');
}

export async function getSpreadsheet(env, accessToken = null) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID belum diatur');
  }
  return request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?fields=spreadsheetId,properties(locale),namedRanges,sheets(properties(sheetId,title,index,gridProperties),merges)`,
    {},
    accessToken
  );
}

function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}


/** An isolated Google Sheets snapshot per reporting period; annual legacy titles stay unchanged. */
export function normalizePeriod(value = 'annual') {
  const p=String(value||'annual').toLowerCase().trim();
  if(p==='annual'||/^month-(0[1-9]|1[0-2])$/.test(p)||/^quarter-[1-4]$/.test(p)||/^semester-[1-2]$/.test(p))return p;
  throw Object.assign(new Error('Periode tidak valid'),{status:400});
}
export function periodTitle(year,name,period='annual'){
  const p=normalizePeriod(period);
  const code=p==='annual'?'':p.startsWith('month-')?`M${p.slice(-2)}__`:p.startsWith('quarter-')?`Q${p.slice(-1)}__`:`S${p.slice(-1)}__`;
  return `${Number(year)}__${code}${name}`;
}

export function resolveExistingTitle(year, canonical, existingTitles, period='annual') {
  const activePeriod=normalizePeriod(period);
  if(activePeriod!=='annual') {
    const exact=periodTitle(year,canonical,activePeriod);
    return existingTitles.find(t=>normalizeName(t)===normalizeName(exact))||null;
  }
  const exact = existingTitles.find(t => normalizeName(t) === normalizeName(canonical));
  
  const pref = `${Number(year)}__${canonical}`;
  const preferred = existingTitles.find(t => normalizeName(t) === normalizeName(pref));
  if (preferred) return preferred;
  if (exact && Number(year) === 2026) return exact;
  // The analytical "Laporan Monev Renaksi" is separate from the official
  // "Laporan_Monev_Renaksi_YYYY" source. Never fuzzy match these reports.
  return null;
}

async function ensureSheets(env, targetTitles, currentSheets, accessToken = null) {
  const existing = new Set((currentSheets || []).map(s => s.properties.title));
  const required=targetTitles.map(t=>typeof t==='string'?{title:t}:t);
  const missing=required.filter(t=>!existing.has(t.title));
  if (!missing.length) return currentSheets || [];
  const requests = missing.map(({title,gridProperties}) => ({
    addSheet: { properties: { title, ...(gridProperties?{gridProperties}:{}) } }
  }));
  await request(
    env,
    `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) },
    accessToken
  );
  const meta = await getSpreadsheet(env, accessToken);
  return meta.sheets || [];
}

function columnLetter(index) {
  let n = index + 1, s = '';
  while (n) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellAddress(rowIndex, colIndex) {
  return `${columnLetter(colIndex)}${rowIndex + 1}`;
}

export function normalizeFormulaSeparators(formula, separator) {
  let out='',quoted=false,braces=0;
  for(let i=0;i<String(formula).length;i++){const ch=formula[i];if(ch==='"'){if(quoted&&formula[i+1]==='"'){out+='""';i++;continue;}quoted=!quoted;}if(!quoted){if(ch==='{')braces++;if(ch==='}')braces--;if(!braces&&(ch===','||ch===';')){out+=separator;continue;}}out+=ch;}return out;
}

function formulaSeparator(meta) {
  const locale = String(meta?.properties?.locale || '').toLowerCase();
  // Locales that use comma as decimal separator generally use semicolon as the
  // formula argument delimiter in the Sheets UI/parser. Indonesian is one of them.
  return (/^(id|de|fr|es|it|pt|nl|tr|ru|pl|sv|da|fi|no|cs|uk)([-_]|$)/.test(locale)) ? ';' : ',';
}

// Import-only verification. Manual saves remain allowed so operators can
// repair an already-corrupt Google sheet one cell at a time.
export function assertValidImportSheet(sheet){
  const values=Array.isArray(sheet?.values)?sheet.values:[];
  for(let row=0;row<values.length;row++)for(let col=0;col<(values[row]||[]).length;col++){
    if(typeof values[row][col]==='string'&&values[row][col].trim().toUpperCase()==='#REF!')
      throw Object.assign(new Error(`Nilai sumber #REF! di ${sheet?.name||'Sheet'}!${cellAddress(row,col)}. Import dibatalkan.`),{status:400});
  }
  for(const [cell,formula] of Object.entries(sheet?.formulas||{})){
    if(/#REF!/i.test(String(formula)))
      throw Object.assign(new Error(`Rumus sumber tidak valid di ${sheet?.name||'Sheet'}!${cell}: #REF!. Import dibatalkan.`),{status:400});
  }
}

export function rowsMatrix(sheet, separator = ',', titles = {}) {
  const values = Array.isArray(sheet?.values) ? sheet.values : [];
  const cols = Math.max(
    Number(sheet?.cols) || 0,
    ...values.map(r => Array.isArray(r) ? r.length : 0),
    0
  );
  const formulas = sheet?.formulas || {};
  return values.map((row, r) => Array.from({ length: cols }, (_, c) => {
    const addr = cellAddress(r, c);
    const f = formulas[addr];
    // Preserve workbook formulas, but adapt only the argument delimiter for the
    // destination spreadsheet locale so formulas do not become #ERROR!/parse errors.
    if (typeof f === 'string' && f.startsWith('=')) {
      return normalizeFormulaSeparators(remapFormula(f,titles), separator);
    }
    return row?.[c] ?? '';
  }));
}

async function clearAndWriteSheet(env, title, sheet, accessToken, meta = null,year=2026,period='annual',importMode=false) {
  const matrix = importMode ? rawValueMatrix(sheet) : rowsMatrix(sheet, formulaSeparator(meta), titleMap(meta,year,period));
  const rows = matrix.length;
  const cols = Math.max(Number(sheet?.cols) || 0, ...matrix.map(r => r.length), 1);
  const lastCol = columnLetter(cols - 1);
  const existing = (meta?.sheets || []).find(s => s.properties.title === title);
  const oldRows = Number(existing?.properties?.gridProperties?.rowCount || 0);
  const oldCols = Number(existing?.properties?.gridProperties?.columnCount || 0);

  let chunks = 0;
  for (let start = 0; start < rows; start += MAX_WRITE_ROWS) {
    const slice = matrix.slice(start, start + MAX_WRITE_ROWS);
    const endRow = start + slice.length;
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: importMode ? 'RAW' : 'USER_ENTERED',
          data: [{
            range: `${q(title)}!A${start + 1}:${lastCol}${endRow}`,
            majorDimension: 'ROWS',
            values: slice
          }]
        })
      },
      accessToken
    );
    chunks++;
  }
  if(importMode)await writeFormulaCellsForImport(env,[{sheet,title}],accessToken,meta,{...titleMap(meta,year,period),[sheet.name]:title});

  // Remove stale cells only after all new values have been accepted.
  const cleanup = [];
  if (oldRows > rows) {
    const tailEndCol = columnLetter(Math.max(oldCols, cols, 1) - 1);
    cleanup.push(`${q(title)}!A${rows + 1}:${tailEndCol}${oldRows}`);
  }
  if (oldCols > cols && rows > 0) {
    const startTailCol = columnLetter(cols);
    const tailEndCol = columnLetter(oldCols - 1);
    cleanup.push(`${q(title)}!${startTailCol}1:${tailEndCol}${rows}`);
  }
  if (!rows && oldRows && oldCols) {
    cleanup.push(`${q(title)}!A1:${columnLetter(oldCols - 1)}${oldRows}`);
  }
  if (cleanup.length) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
      { method: 'POST', body: JSON.stringify({ ranges: cleanup }) },
      accessToken
    );
  }
  return { rows, chunks };
}


function estimateBytes(value) {
  try { return JSON.stringify(value).length; } catch { return 0; }
}

// Values in an imported workbook are actual Excel values, not spreadsheet-UI
// input strings. Write them RAW first; reapply only actual formulas afterward.
// This prevents Google from turning a text code into a date or replacing a
// cached result with #REF! while other sheets are still being updated.
function rawValueMatrix(sheet){
  const values=sheet.values||[];
  const width=values.reduce((n,r)=>Math.max(n,r.length),Number(sheet.cols)||0);
  return values.map(row=>Array.from({length:width},(_,c)=>row[c]??''));

}
async function writeFormulaCellsForImport(env,entries,accessToken,meta,titleReferences={}){
  const separator=formulaSeparator(meta),data=[];
  let formulaCells=0;
  for(const {sheet,title} of entries){
    let run=null, startRange='', previousColumn=-1, previousRow=0;
    for(const [cell,f] of Object.entries(sheet?.formulas||{})){
      if(!/^[A-Z]{1,3}[1-9][0-9]*$/i.test(cell))throw Object.assign(new Error(`Alamat rumus tidak valid: ${sheet.name}!${cell}`),{status:400});
      if(typeof f!=='string'||!f.startsWith('=')||/#REF!/i.test(f))
        throw Object.assign(new Error(`Rumus import tidak valid: ${sheet.name}!${cell}`),{status:400});
      const [,letters,row]=cell.match(/^([a-z]+)(\d+)$/i);
      const column=[...letters.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
      const value=normalizeFormulaSeparators(remapFormula(f,titleReferences),separator);
      if(run && row===previousRow && column===previousColumn+1 && run.values[0].length<100){
        run.values[0].push(value);
        run.range=startRange+':'+cell;
      }else{
        startRange=`${q(title)}!${cell}`;
        run={range:startRange,majorDimension:'ROWS',values:[[value]]};
        data.push(run);
      }
      previousRow=row;previousColumn=column;formulaCells++;
    }
  }
  // Formula references can span different tabs. Write every tab's RAW values
  // first, then submit formulas in bounded batches after all inputs exist.
  const batches=[];let batch=[],size=0;
  for(const item of data){const bytes=estimateBytes(item)+48;
    if(batch.length&&(batch.length>=350||size+bytes>650000)){batches.push(batch);batch=[];size=0;}
    batch.push(item);size+=bytes;
  }
  if(batch.length)batches.push(batch);
  for(const items of batches)await request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
    {method:'POST',body:JSON.stringify({valueInputOption:'USER_ENTERED',data:items})},accessToken);
  return {formulaCells,formulaBatches:batches.length};
}

export async function writeSheetsBatch(env, sheets, year = 2026, options = {}) {
  const entries = Object.entries(sheets || {}).filter(([name, sheet]) => String(name).trim() && sheet);
  if (!entries.length) return { updated: 0, created: 0, results: [] };
  if(options.import)for(const [,sheet] of entries)assertValidImportSheet(sheet);

  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const existingByTitle = new Map(currentSheets.map(s => [s.properties.title, s]));
  const titles = currentSheets.map(s => s.properties.title);
  const separator = formulaSeparator(meta);

  const targets = entries.map(([name]) => ({
    name,
    title: resolveExistingTitle(year, name, titles, options.period) || periodTitle(year,name,options.period)
  }));
  // Include both pre-existing year sheets and new sheets in formula remapping.
  // On a partial-year repair, formulas must point at 2027__IKU rather than
  // silently resolving the unprefixed 2026 IKU.
  const titleReferences={...titleMap(meta,year,options.period),...Object.fromEntries(targets.map(x=>[x.name,x.title]))};
  const createdTargets = targets.filter(x => !existingByTitle.has(x.title));
  const preparedSheets=await ensureSheets(env, createdTargets.map(x=>{
    const sheet=sheets[x.name]||{};
    return {title:x.title,gridProperties:{
      rowCount:Math.max(1000,Number(sheet.grid?.rowCount)||0,sheet.values?.length||0),
      columnCount:Math.max(26,Number(sheet.grid?.columnCount)||0,Number(sheet.cols)||0,...(sheet.values||[]).map(r=>r.length))
    }};
  }), currentSheets, accessToken);

  await applyPresentation(env,sheets,year,accessToken,options.period,{
    meta:{...meta,sheets:preparedSheets},existingBefore:new Set(titles),
    fastImport:options.import===true,preserveFormat:options.preserveFormat!==false
  });
  const dataItems = [];
  const resultRows = [];
  const cleanupRanges = [];
  const formulaTargets = [];

  for (const x of targets) {
    const src = sheets[x.name] || {};
    const matrix = options.import ? rawValueMatrix(src) : rowsMatrix(src, separator, titleReferences);
    if(options.import) formulaTargets.push({sheet:src,title:x.title});
    const rows = matrix.length;
    const cols = Math.max(Number(src?.cols) || 0, ...matrix.map(r => r.length), 1);
    const lastCol = columnLetter(cols - 1);
    const old = existingByTitle.get(x.title);
    const previousView=(meta.namedRanges||[]).find(n=>n.name===`KKVIEW_${year}_${old?.properties?.sheetId}`)?.range;
    const oldRows = Number(previousView?.endRowIndex || old?.properties?.gridProperties?.rowCount || 0);
    const oldCols = Number(previousView?.endColumnIndex || old?.properties?.gridProperties?.columnCount || 0);

    resultRows.push({
      name: x.name,
      googleTitle: x.title,
      rows,
      chunks: 0,
      created: !old
    });

    // IMPORTANT: do not clear first. Write the new content first so a failed
    // import cannot destroy the previous working data.
    for (let start = 0; start < rows; start += MAX_WRITE_ROWS) {
      const slice = matrix.slice(start, start + MAX_WRITE_ROWS);
      dataItems.push({
        name: x.name,
        range: `${q(x.title)}!A${start + 1}:${lastCol}${start + slice.length}`,
        majorDimension: 'ROWS',
        values: slice
      });
    }

    // Clear only the old tail after the new values have been written.
    const tailRanges = [];
    if (oldRows > rows) {
      const tailEndCol = columnLetter(Math.max(oldCols, cols, 1) - 1);
      tailRanges.push(`${q(x.title)}!A${rows + 1}:${tailEndCol}${oldRows}`);
    }
    if (oldCols > cols && rows > 0) {
      const startTailCol = columnLetter(cols);
      const tailEndCol = columnLetter(oldCols - 1);
      tailRanges.push(`${q(x.title)}!${startTailCol}1:${tailEndCol}${Math.min(oldRows || rows, rows)}`);
    }
    cleanupRanges.push(...tailRanges);
  }

  const batches = [];
  let batch = [];
  let batchSize = 0;
  for (const item of dataItems) {
    const itemSize = estimateBytes(item) + 180;
    if (batch.length && batchSize + itemSize > 1400000) {
      batches.push(batch);
      batch = [];
      batchSize = 0;
    }
    batch.push(item);
    batchSize += itemSize;
  }
  if (batch.length) batches.push(batch);

  for (const payload of batches) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: options.import ? 'RAW' : 'USER_ENTERED',
          data: payload.map(({ range, majorDimension, values }) => ({ range, majorDimension, values }))
        })
      },
      accessToken
    );
  }

  const formulasWritten=options.import ? await writeFormulaCellsForImport(env,formulaTargets,accessToken,meta,titleReferences) : {formulaCells:0,formulaBatches:0};

  // The old tail is removed only after every write chunk succeeds.
  if (cleanupRanges.length) {
    await request(
      env,
      `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchClear`,
      { method: 'POST', body: JSON.stringify({ ranges: cleanupRanges }) },
      accessToken
    );
  }

  const perSheet = new Map(resultRows.map(x => [x.name, x]));
  for (const item of dataItems) {
    const row = perSheet.get(item.name);
    if (row) row.chunks += 1;
  }
  return {
    updated: targets.length,
    created: createdTargets.length,
    batches: batches.length,
    ...formulasWritten,
    results: resultRows
  };
}

export async function readWorkbook(env, canonicalNames, year = 2026, period = 'annual') {
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const resolved = canonicalNames
    .map(name => ({canonical:name,actual:resolveExistingTitle(year,name,titles,period)}))
    .filter(x => x.actual);
  // Newly imported tabs must also be visible after refresh. The old reader
  // silently discarded every sheet outside its fixed list of 15 names.
  // Discover only year/period-prefixed tabs to avoid pulling another year's
  // data or unrelated unprefixed tabs from the shared Google Spreadsheet.
  const prefix=periodTitle(year,'',period);
  const known=new Set(resolved.map(x=>x.canonical));
  for(const title of titles){
    if(!title.startsWith(prefix))continue;
    const name=title.slice(prefix.length);
    if(!name || (period==='annual'&&/^(?:M(?:0[1-9]|1[0-2])|Q[1-4]|S[1-2])__/.test(name)) || known.has(name))continue;
    resolved.push({canonical:name,actual:title});known.add(name);
  }

  if (!resolved.length) {
    return {
      meta,
      sheets: {},
      missing: canonicalNames,
      availableTitles: titles
    };
  }

  const ranges = resolved.map(x => {
    const p=currentSheets.find(s=>s.properties.title===x.actual).properties;
    const mapped=(meta.namedRanges||[]).filter(n=>n.name.startsWith(`KKCOL_${year}_${p.sheetId}_`));
    const extra=Math.max(0,...mapped.map(n=>n.range?.endColumnIndex||0));
    const view=meta.namedRanges?.find(n=>n.name===`KKVIEW_${year}_${p.sheetId}`)?.range?.endColumnIndex||0;
    const width=Math.max(26,Math.min(p.gridProperties?.columnCount||26,64),extra,view);
    return `${q(x.actual)}!A:${columnLetter(width-1)}`;
  });
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const [data,formulaData]=await Promise.all(['UNFORMATTED_VALUE','FORMULA'].map(option=>
    request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchGet?majorDimension=ROWS&valueRenderOption=${option}&${qs}`,{},accessToken)
  ));

  // Query a bounded formatting window: fetching effectiveFormat for every cell of
  // every 1000-row sheet caused heavy latency and huge serialized responses.
  // All values and all formulas are still retrieved separately above.
  const PREVIEW_FORMAT_ROWS=120;
  const displayRanges=resolved.map((x,i)=>`${q(x.actual)}!A1:${columnLetter(Math.max(1,...(data.valueRanges?.[i]?.values||[]).map(r=>r.length))-1)}${Math.max(1,Math.min(PREVIEW_FORMAT_ROWS,data.valueRanges?.[i]?.values?.length||1))}`);
  const display=await request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}?includeGridData=true&fields=sheets(properties(title),data(startRow,startColumn,columnMetadata(pixelSize),rowData(values(formattedValue,effectiveFormat(numberFormat)))))&${displayRanges.map(r=>'ranges='+encodeURIComponent(r)).join('&')}`,{},accessToken);
  const sheets = {};
  const formulaErrors = [];
  const canonicalTitles=Object.fromEntries(resolved.map(x=>[x.actual,x.canonical]));
  for (let i = 0; i < resolved.length; i++) {
    const item = resolved[i];
    const values = data.valueRanges?.[i]?.values || [];
    const rendered = formulaData.valueRanges?.[i]?.values || [];
    const sheetId=currentSheets.find(s=>s.properties.title===item.actual)?.properties.sheetId;
    const view=meta.namedRanges?.find(n=>n.name===`KKVIEW_${year}_${sheetId}`)?.range;
    const mergeRows=Math.max(0,...(currentSheets.find(s=>s.properties.sheetId===sheetId)?.merges||[]).map(m=>m.endRowIndex));
    while(values.length<Math.max(view?.endRowIndex||0,mergeRows))values.push([]);
    const formulas = {};
    for (let r = 0; r < rendered.length; r++) {
      for (let c = 0; c < (rendered[r] || []).length; c++) {
        const v = rendered[r]?.[c];
        const a = cellAddress(r, c);
        if (typeof v === 'string' && v.startsWith('=')) formulas[a] = normalizeFormulaSeparators(remapFormula(v,canonicalTitles), ',');
        const raw = values[r]?.[c];
        if (formulas[a] && typeof raw === 'string' && ['#ERROR!','#REF!','#NAME?'].includes(raw.trim().toUpperCase())) {
          formulaErrors.push({ canonical: item.canonical, cell: a, formula: v, value: raw });
        }
      }
    }
    sheets[item.canonical] = {
      name: item.canonical,
      googleTitle: item.actual,
      values,
      rows: values.length,
      cols: Math.max(view?.endColumnIndex||0,...(currentSheets.find(s=>s.properties.sheetId===sheetId)?.merges||[]).map(m=>m.endColumnIndex), ...values.map(r => r.length), ...rendered.map(r => r.length)),
      formulas,
      schemaColumns: (meta.namedRanges||[]).filter(n=>n.name.startsWith(`KKCOL_${year}_${currentSheets.find(s=>s.properties.title===item.actual)?.properties.sheetId}_`)).map(n=>({original:Number(n.name.split('_').at(-1)),current:n.range.startColumnIndex||0})),
      grid: currentSheets.find(s=>s.properties.title===item.actual)?.properties.gridProperties,
      presentation: { merges: (currentSheets.find(s=>s.properties.title===item.actual)?.merges||[]).map(m=>({s:{r:m.startRowIndex||0,c:m.startColumnIndex||0},e:{r:m.endRowIndex-1,c:m.endColumnIndex-1}})) }
    };
  }

  for(const item of resolved){
    const grid=display.sheets?.find(s=>s.properties.title===item.actual)?.data?.[0];const sheet=sheets[item.canonical];
    if(grid){sheet.formattedValues=(grid.rowData||[]).map(r=>(r.values||[]).map(c=>c.formattedValue));sheet.presentation.cols=(grid.columnMetadata||[]).map(c=>({wpx:c.pixelSize}));sheet.presentation.formats={};(grid.rowData||[]).forEach((row,r)=>(row.values||[]).forEach((cell,c)=>{if(cell.effectiveFormat?.numberFormat)sheet.presentation.formats[cellAddress(r,c)]={numberFormat:cell.effectiveFormat.numberFormat.pattern};}));}
  }
  return {
    meta,
    sheets,
    missing: canonicalNames.filter(n => !sheets[n]),
    availableTitles: titles,
    formulaErrors
  };
}

export async function rewriteFormulaCells(env, cells) {
  if (!Array.isArray(cells) || !cells.length) return { updated: 0, batches: 0 };
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const separator = formulaSeparator(meta);
  const data = [];
  for (const x of cells) {
    const name = String(x?.canonical || x?.name || '').trim();
    const cell = String(x?.cell || '').trim();
    const formula = String(x?.formula || '');
    if (!name || !cell || !formula.startsWith('=')) continue;
    const title = resolveExistingTitle(Number(x?.year || 2026), name, titles) || titles.find(t => normalizeName(t) === normalizeName(name));
    if (!title) continue;
    let repaired = formula;
    // Khusus sheet Realisasi Fisik & Keu, kolom E pada baris data memakai
    // hubungan E = I/D*100 sementara I = H*D/100. Secara matematis E = H,
    // tetapi rantai formula tersebut rentan kembali #ERROR setelah import Excel
    // dan refresh pada Google Sheets. Saat error terdeteksi, turunkan menjadi
    // formula langsung yang ekuivalen dan non-circular.
    if (name === 'Realisasi Fisik & Keu' && /^E\d+$/i.test(cell)) {
      const row = cell.slice(1);
      repaired = `=IFERROR(H${row}${separator}"")`;
    }
    data.push({ range: `${q(title)}!${cell}`, majorDimension: 'ROWS', values: [[normalizeFormulaSeparators(repaired, separator)]] });
  }
  if (!data.length) return { updated: 0, batches: 0 };
  for (let i = 0; i < data.length; i += 250) {
    const chunk = data.slice(i, i + 250);
    await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, { method:'POST', body: JSON.stringify({ valueInputOption:'USER_ENTERED', data:chunk }) }, accessToken);
  }
  return { updated: data.length, batches: Math.ceil(data.length / 250) };
}

export async function writeSingleSheet(env, sheet, year = 2026, options = {}) {
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Google Sheets belum dikonfigurasi di backend');
  }
  if(options.import)assertValidImportSheet(sheet);
  const name = String(sheet?.name || '').trim();
  if (!name) throw new Error('Nama sheet kosong');
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const currentSheets = meta.sheets || [];
  const titles = currentSheets.map(s => s.properties.title);
  const targetTitle = resolveExistingTitle(year, name, titles, options.period) || periodTitle(year,name,options.period);
  const old = currentSheets.find(s => s.properties.title === targetTitle);
  if(options.createOnly&&old)throw Object.assign(new Error('Sheet sudah ada, tidak akan ditimpa oleh template.'),{status:409});

  const preparedSheets=await ensureSheets(env, [{title:targetTitle,gridProperties:{rowCount:Math.max(1000,sheet.values?.length||0,Number(sheet.grid?.rowCount)||0),columnCount:Math.max(26,sheet.cols||0,Number(sheet.grid?.columnCount)||0)}}], currentSheets, accessToken);
  if(options.import)await applyPresentation(env,{[name]:sheet},year,accessToken,options.period,{
    meta:{...meta,sheets:preparedSheets},existingBefore:new Set(titles),
    fastImport:true,preserveFormat:options.preserveFormat!==false
  });
  const result = await clearAndWriteSheet(env, targetTitle, sheet, accessToken, meta,year,options.period,options.import===true);

  // clearAndWriteSheet writes a new snapshot after clearing. Single-sheet saves
  // are used for manual editor persistence, so keep the existing behavior but
  // report the exact target explicitly.
  return {
    ok: true,
    name,
    googleTitle: targetTitle,
    created: !titles.includes(targetTitle),
    previousRows: Number(old?.properties?.gridProperties?.rowCount || 0),
    previousCols: Number(old?.properties?.gridProperties?.columnCount || 0),
    ...result
  };
}

export async function writeCells(env, changes, year = 2026, period = 'annual') {
  const clean = (changes || []).map(x => ({
    name: String(x?.name || '').trim(),
    row: Number(x?.row),
    col: Number(x?.col),
    value: x?.value ?? '', grid: x?.grid
  })).filter(x => x.name && Number.isInteger(x.row) && x.row >= 0 && Number.isInteger(x.col) && x.col >= 0);
  if (!clean.length) return { updated: 0, batches: 0 };
  const accessToken = await getGoogleAccessToken(env);
  const meta = await getSpreadsheet(env, accessToken);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const separator = formulaSeparator(meta);
  for (const x of clean) {
    const title=resolveExistingTitle(year,x.name,titles,period);
    const grid=(meta.sheets||[]).find(s=>s.properties.title===title)?.properties.gridProperties;
    if(!grid) throw new Error('Sheet belum tersedia. Import Excel terlebih dahulu.');
    if(x.grid && (grid.rowCount!==x.grid.rowCount || grid.columnCount!==x.grid.columnCount)) throw Object.assign(new Error('Struktur sheet berubah. Muat ulang sebelum mengedit.'),{status:409});
  }
  const bySheet = new Map();
  for (const x of clean) {
    const title = resolveExistingTitle(year, x.name, titles,period) || periodTitle(year,x.name,period);
    if (!bySheet.has(title)) bySheet.set(title, []);
    const value = typeof x.value === 'string' && x.value.startsWith('=') ? normalizeFormulaSeparators(remapFormula(x.value,titleMap(meta,year,period)), separator) : x.value;
    bySheet.get(title).push({ row: x.row, col: x.col, value });
  }
  const data = [];
  for (const [title, cells] of bySheet) {
    for (const c of cells) {
      const addr = cellAddress(c.row, c.col);
      data.push({ range: `${q(title)}!${addr}`, majorDimension: 'ROWS', values: [[c.value]] });
    }
  }
  const batches = [];
  let batch = [], size = 0;
  for (const item of data) {
    const n = estimateBytes(item) + 80;
    if (batch.length && size + n > 700000) { batches.push(batch); batch = []; size = 0; }
    batch.push(item); size += n;
  }
  if (batch.length) batches.push(batch);
  for (const payload of batches) {
    await request(env, `spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: payload })
    }, accessToken);
  }
  return { updated: data.length, batches: batches.length };
}

export async function writeWorkbook(env, payload, year = 2026, period = 'annual') {
  const data = payload?.sheets || {};
  const names = Object.keys(data);
  if (!names.length) return { updated: 0, created: 0 };

  // Import/save is intentionally performed sheet-by-sheet to keep each request
  // small and prevent a large workbook from timing out a single Pages Function.
  const results = [];
  for (const name of names) {
    results.push(await writeSingleSheet(env, {
      ...(data[name] || {}),
      name
    }, year,{period}));
  }
  return {
    updated: results.length,
    created: results.filter(x => x.created).length,
    results
  };
}

// A structural request is never automatically retried: a lost response may
// already have applied the insertion. Refresh before deciding to repeat it.
export function dimensionRequests(p, operation) {
  const {dimension='ROWS',action='insert',index,count=1,copy='none'}=operation;
  const size=dimension==='ROWS'?p.gridProperties.rowCount:p.gridProperties.columnCount;
  if(!['ROWS','COLUMNS'].includes(dimension)||!['insert','delete','duplicate'].includes(action)||!Number.isInteger(index)||index<0||!Number.isInteger(count)||count<1||count>100||index>size||(action!=='insert'&&index+count>size))throw new Error('Posisi atau jumlah baris/kolom tidak valid');
  if(action==='delete'&&count>=size)throw new Error('Sheet harus menyisakan minimal satu baris/kolom');
  const start=action==='duplicate'?index+count:index;
  const range={sheetId:p.sheetId,dimension,startIndex:start,endIndex:start+count};
  if(action==='delete')return [{deleteDimension:{range}}];
  const requests=start===size?[{appendDimension:{sheetId:p.sheetId,dimension,length:count}}]:[{insertDimension:{range,inheritFromBefore:start>0}}];
  if(copy!=='none'||action==='duplicate'){
    const from=action==='duplicate'?index:(start===0?count:start-1);
    const grid=(a,b)=>dimension==='ROWS'?{sheetId:p.sheetId,startRowIndex:a,endRowIndex:b,startColumnIndex:0,endColumnIndex:p.gridProperties.columnCount}:{sheetId:p.sheetId,startColumnIndex:a,endColumnIndex:b,startRowIndex:0,endRowIndex:p.gridProperties.rowCount};
    const source=grid(from,from+(action==='duplicate'?count:1));const destination=grid(start,start+count);
    for(const pasteType of (action==='duplicate'?['PASTE_NORMAL']:copy==='formula'?['PASTE_FORMAT','PASTE_FORMULA']:['PASTE_FORMAT']))requests.push({copyPaste:{source,destination,pasteType,pasteOrientation:'NORMAL'}});
  }
  return requests;
}
export async function changeStructure(env,operation,year,period='annual'){
  const token=await getGoogleAccessToken(env);const meta=await getSpreadsheet(env,token);
  const title=resolveExistingTitle(year,operation.name,meta.sheets.map(s=>s.properties.title),period);
  const p=meta.sheets.find(s=>s.properties.title===title)?.properties;
  if(!p)throw new Error('Sheet belum tersedia. Import Excel dahulu.');
  if(operation.grid&&(operation.grid.rowCount!==p.gridProperties.rowCount||operation.grid.columnCount!==p.gridProperties.columnCount))throw Object.assign(new Error('Struktur sudah berubah. Muat ulang sheet.'),{status:409});
  const requests=dimensionRequests(p,operation);
  const view=meta.namedRanges?.find(n=>n.name===`KKVIEW_${year}_${p.sheetId}`);
  if(view){const range={...view.range};const key=operation.dimension==='COLUMNS'?'endColumnIndex':'endRowIndex';const count=operation.count||1;
    if(operation.action==='delete')range[key]=Math.max(1,range[key]-Math.max(0,Math.min(count,range[key]-operation.index)));
    else range[key]=Math.max(range[key],operation.index)+count;
    requests.push({updateNamedRange:{namedRange:{namedRangeId:view.namedRangeId,range},fields:'range'}});
  }
  return request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`,{method:'POST',noRetry:true,body:JSON.stringify({requests})},token);
}

export function presentationRequests(sheet,p){
  const sheetId=p.sheetId;const requests=[];
  const rowCount=Math.max(p.gridProperties.rowCount,sheet.rows||sheet.values.length,1),columnCount=Math.max(p.gridProperties.columnCount,sheet.cols||1);
  requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{rowCount,columnCount}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
  const presentation=sheet.presentation;if(!presentation)return requests;
  requests.push({unmergeCells:{range:{sheetId}}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:Math.max(sheet.rows||sheet.values.length,1),startColumnIndex:0,endColumnIndex:sheet.cols||1},cell:{userEnteredFormat:{wrapStrategy:'WRAP',verticalAlignment:'TOP'}},fields:'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment'}});
  for(const m of presentation.merges||[])requests.push({mergeCells:{range:{sheetId,startRowIndex:m.s.r,endRowIndex:m.e.r+1,startColumnIndex:m.s.c,endColumnIndex:m.e.c+1},mergeType:'MERGE_ALL'}});
  if(/^Laporan_Monev_Renaksi_20\d{2}$/.test(sheet.name)) {
    requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:3,startColumnIndex:0,endColumnIndex:Math.min(columnCount,24)},cell:{userEnteredFormat:{textFormat:{bold:true},verticalAlignment:'MIDDLE'}},fields:'userEnteredFormat.textFormat.bold,userEnteredFormat.verticalAlignment'}});
    requests.push({repeatCell:{range:{sheetId,startRowIndex:4,endRowIndex:8,startColumnIndex:0,endColumnIndex:Math.min(columnCount,24)},cell:{userEnteredFormat:{textFormat:{bold:true},horizontalAlignment:'CENTER',verticalAlignment:'MIDDLE',wrapStrategy:'WRAP'}},fields:'userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy'}});
  }
  if(/^Laporan_Monev_Renaksi_20\d{2}$/.test(sheet.name)) (presentation.rows||[]).slice(0,rowCount).forEach((r,i)=>{if(r?.hpt && Number(r.hpt)>0){requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:i,endIndex:i+1},properties:{pixelSize:Math.max(20,Math.min(260,Math.round(Number(r.hpt)*4/3)))},fields:'pixelSize'}});}});
  (presentation.cols||[]).slice(0,columnCount).forEach((c,i)=>{const w=c?.wpx||(c?.wch?c.wch*7:0)||c?.pixelSize;if(w)requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize:Math.max(32,Math.round(w))},fields:'pixelSize'}});});
  for(const [a,f] of Object.entries(presentation.formats||{})){
    const match=a.match(/^([A-Z]+)(\d+)$/);if(!match)continue;let c=0;for(const ch of match[1])c=c*26+ch.charCodeAt(0)-64;const r=Number(match[2])-1;
    const pattern=f.numberFormat;if(!pattern||pattern==='General'||r>=rowCount||c>columnCount)continue;
    const type=pattern.includes('%')?'PERCENT':/[ymdh]/i.test(pattern.replace(/"[^"]*"/g,''))?'DATE_TIME':pattern==='@'?'TEXT':'NUMBER';
    requests.push({repeatCell:{range:{sheetId,startRowIndex:r,endRowIndex:r+1,startColumnIndex:c-1,endColumnIndex:c},cell:{userEnteredFormat:{numberFormat:{type,pattern}}},fields:'userEnteredFormat.numberFormat'}});
  }
  return requests;
}
export async function applyPresentation(env, entries,year,token,period='annual',options={}){
  const meta=options.meta||await getSpreadsheet(env,token);const requests=[];
  const existingBefore=options.existingBefore||new Set();
  for(const [name,sheet] of Object.entries(entries)){const title=resolveExistingTitle(year,name,meta.sheets.map(s=>s.properties.title),period);const p=meta.sheets.find(s=>s.properties.title===title)?.properties;if(p){
    const isExistingImport=options.fastImport===true && existingBefore.has(title);
    if(isExistingImport){
      // Existing Google formatting/merges and formulas are never destroyed on a
      // routine Excel refresh. Only grow a grid if the new sheet needs space.
      const rowCount=Math.max(1,sheet.values?.length||0,Number(sheet.rows)||0);
      const columnCount=Math.max(1,Number(sheet.cols)||0,...(sheet.values||[]).map(r=>r.length));
      if(rowCount>p.gridProperties.rowCount || columnCount>p.gridProperties.columnCount){
        requests.push({updateSheetProperties:{properties:{sheetId:p.sheetId,gridProperties:{
          rowCount:Math.max(p.gridProperties.rowCount,rowCount),
          columnCount:Math.max(p.gridProperties.columnCount,columnCount)
        }},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
      }
    }else if(options.preserveFormat!==false){
      requests.push(...presentationRequests(sheet,p));
    }

    const viewName=`KKVIEW_${year}_${p.sheetId}`;
    const wantedView={sheetId:p.sheetId,startRowIndex:0,endRowIndex:Math.max(1,sheet.values?.length||0),startColumnIndex:0,endColumnIndex:Math.max(1,sheet.cols||1)};
    const oldView=(meta.namedRanges||[]).find(n=>n.name===viewName);
    if(!oldView)requests.push({addNamedRange:{namedRange:{name:viewName,range:wantedView}}});
    else if(oldView.range?.endRowIndex!==wantedView.endRowIndex || oldView.range?.endColumnIndex!==wantedView.endColumnIndex)
      requests.push({updateNamedRange:{namedRange:{namedRangeId:oldView.namedRangeId,range:wantedView},fields:'range'}});
    const prefix=`KKCOL_${year}_${p.sheetId}_`;
    const prior=(meta.namedRanges||[]).filter(n=>n.name.startsWith(prefix));
    const cols=Math.max(1,Number(sheet.cols)||0);
    const identity=prior.length===cols && prior.every(n=>{
      const index=Number(n.name.slice(prefix.length));return Number.isInteger(index)&&index>=0&&index<cols&&(n.range?.startColumnIndex||0)===index;
    });
    // A newly imported workbook uses its own actual column positions. Replace
    // obsolete mappings only when needed, rather than every time Validate OK
    // is pressed (which previously created hundreds of Google API mutations).
    if(!identity){
      for(const n of prior)requests.push({deleteNamedRange:{namedRangeId:n.namedRangeId}});
      for(let c=0;c<cols;c++)requests.push({addNamedRange:{namedRange:{name:prefix+c,range:{sheetId:p.sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:c,endColumnIndex:c+1}}}});
    }
  }}
  for(let i=0;i<requests.length;i+=400)await request(env,`spreadsheets/${encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)}:batchUpdate`,{method:'POST',body:JSON.stringify({requests:requests.slice(i,i+400)})},token);
}

export function remapFormula(formula,titles={}) {
  return String(formula).split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_]*)!/g,(all,quoted,bare)=>{const name=(quoted||bare).replace(/''/g,"'");return titles[name]?q(titles[name])+'!':all;})).join('');
}
function titleMap(meta,year=2026,period='annual'){const names=(meta?.sheets||[]).map(s=>s.properties.title);return Object.fromEntries(names.map(n=>{const canonical=n.replace(/^\d{4}__(?:M\d{2}__|Q[1-4]__|S[1-2]__)?/, '');return [canonical,resolveExistingTitle(year,canonical,names,period)||n];}));}
