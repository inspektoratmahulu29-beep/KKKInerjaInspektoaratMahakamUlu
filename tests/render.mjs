import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import {SEED_WORKBOOK as payload} from '../functions/lib/seed.js';
await build({entryPoints:['src/SpreadsheetEditor.jsx'],bundle:true,platform:'node',format:'esm',outfile:'tests/.render-component.mjs',loader:{'.css':'empty'},external:['react'],mainFields:['module','main']});
const {SpreadsheetEditor}=await import('./.render-component.mjs');
for(const selectedSheet of Object.keys(payload.sheets)){
 const html=renderToStaticMarkup(React.createElement(SpreadsheetEditor,{payload,selectedSheet,setSelectedSheet(){},updateCell(){},onStructure(){},onRefresh(){},onTemplate(){},onImportExcel(){},exportExcel(){},exportSheetExcel(){},dirty:false}));
 assert.ok(html.includes('formula-bar'));assert.ok(html.includes('sheet-tabs'));assert.ok(html.includes('Sisipkan kolom'));assert.ok(html.includes('rowspan'));
}
console.log('PASS: server rendering of spreadsheet grid for all 14 sheets, merged cells, formula bar and toolbar.');
