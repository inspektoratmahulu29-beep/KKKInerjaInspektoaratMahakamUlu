import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
function walk(dir){const out=[];for(const name of readdirSync(dir)){const p=join(dir,name),s=statSync(p);if(s.isDirectory())out.push(...walk(p));else if(p.endsWith('.js'))out.push(p)}return out}
const files=walk('./functions');
let imports=0;
for(const file of files){
 execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
 const source=readFileSync(file,'utf8');
 const matches=[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)];
 for(const m of matches){
   const target=resolve(dirname(file),m[1]);
   if(!existsSync(target)&&!existsSync(target+'.js')&&!existsSync(join(target,'index.js'))){
     throw new Error(`Pages Functions unresolved import: ${file} -> ${m[1]}`);
   }
   imports++;
 }
}
console.log(`OK: ${files.length} Pages Functions modules syntax-valid; ${imports} relative import paths resolved.`);
