import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/mongodb(?:\+srv)?:\/\/[^\s:]+:[^\s@]+@/,/AKIA[0-9A-Z]{16}/,/AIza[0-9A-Za-z_-]{35}/];
let findings=0;
for(const file of files){if(/(^|\/)\.env(?!\.example$)|(^|\/)\.data\//.test(file)){console.error('Forbidden private file: '+file);findings++;continue;}if(/\.(docx|png|jpg|ico|woff2?)$/.test(file)||file.endsWith('scan-secrets.mjs'))continue;const text=readFileSync(file,'utf8');if(patterns.some(p=>p.test(text))){console.error('Potential credential in '+file+' (value withheld)');findings++;}}
if(findings)process.exitCode=1;else console.log('Secret pattern scan passed for '+files.length+' candidate source files. Manual review is still required; this is not an exhaustive detector.');
