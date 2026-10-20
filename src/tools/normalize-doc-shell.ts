#!/usr/bin/env node
/** Compatibility normalizer: use Architecture as the sole presentation shell reference. */
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {presentationShell} from './presentation-shell.js';
const root=resolve(process.cwd()),dir=join(root,'docs/presentations');
let changed=0;
for(const name of readdirSync(dir).filter(n=>n.endsWith('.html'))){const path=join(dir,name),old=readFileSync(path,'utf8'),html=presentationShell(old,root);if(old!==html){writeFileSync(path,html);changed++;}}
console.log('Normalized Architecture shell: '+changed+' pages');
