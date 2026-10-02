// Pinned MIT motion assets only; never executes downloaded source code.
import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const directory=join(root,'assets/avatar/animations');
const commit='6787685c8d40e4e79bffbb0d389b478f32ef88d6';
const selected=[
 ['rb-idle-talking-2','ed1df287a4d822560916f3388d5cc81d39867d04'],
 ['rb-idle-talking-3','b68d6e58dfb03b37847ff53030b93cc74eb6a463'],
 ['rb-nod','aaaf1d2f644abb8c676d98e100b8f44982a317d1'],
 ['rb-nod-2','d8bad63ef825c012c5ab9fb5868a75c999a9273c'],
 ['rb-shake','e88c1a02b297894742eaf5e199f0ec22a6371476'],
 ['rb-wave','bbbcaec40eb56d5167fa9f5297c4382bcb8ec8d9'],
 ['rb-happy','e189199f41fa73ca0532534e704c3f97edb45377'],
 ['rb-happy-2','54b8eb327131abc610fa62a3367ace30522354c5'],
 ['rb-angry-2','8f2fd7c7e818e85e47bc5a1c58faed19875cf32c'],
 ['rb-laugh','a81b6bd7b25d11da6ef82ec11b1861fc19e3ff8f'],
 ['rb-shrug','d203e6cd4acb973c333b01e572100dbde3e5ad9d']
];
const provenance=JSON.parse(readFileSync(join(directory,'sources.json'),'utf8'));
for(const [name,expected] of selected){
 const file=name+'.vrma',destination=join(directory,file),partial=destination+'.part';
 if(!existsSync(destination)){
   const payload=execFileSync('curl.exe',['--fail','--location','--silent','--show-error','--retry','2','--retry-all-errors','--connect-timeout','15','--max-time','45',`https://api.github.com/repos/Undi95/Hanami/git/blobs/${expected}`],{timeout:150000,windowsHide:true,maxBuffer:2000000});
   const blob=JSON.parse(payload.toString('utf8'));if(blob.encoding!=='base64')throw Error('Unexpected Git blob encoding');
   writeFileSync(partial,Buffer.from(blob.content,'base64'));
 }
 const data=readFileSync(existsSync(destination)?destination:partial);
 const hash=createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
 if(hash!==expected||data.toString('ascii',0,4)!=='glTF')throw Error('Motion integrity mismatch: '+file);
 if(!existsSync(destination))renameSync(partial,destination);
 if(!provenance.files.some(entry=>entry.file===file))provenance.files.push({file,source_file:'vrma/'+file,source_repository:'https://github.com/Undi95/Hanami',source_commit:commit,upstream_repository:'https://github.com/microsoft/Microsoft-Rocketbox',upstream_commit:'0943055db6ec570bcef9f2c8b41c9e5467c808f9',license:'MIT',sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length});
 console.log(file,data.length,'verified');
}
writeFileSync(join(directory,'sources.json'),JSON.stringify(provenance,null,2)+'\n');
