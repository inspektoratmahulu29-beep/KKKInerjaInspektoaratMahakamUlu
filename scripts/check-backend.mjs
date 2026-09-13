import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  const out=[];
  for(const name of readdirSync(dir)) {
    const p=join(dir,name), s=statSync(p);
    if(s.isDirectory()) out.push(...walk(p));
    else if(p.endsWith('.js')) out.push(p);
  }
  return out;
}
const files=walk('./functions');
for(const file of files) execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log(`OK: ${files.length} backend JS files passed node --check`);
