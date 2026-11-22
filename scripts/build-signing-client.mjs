import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parent=path.join(root,'tmp'),output=path.join(parent,'qt-signing-site');
const files=['index.html','app.js','app.css','kino-logo-white.png','_headers','_redirects'];
await fs.mkdir(parent,{recursive:true});
if(await fs.realpath(parent)!==parent)throw new Error('Build parent must not be a symlink');
await fs.mkdir(output,{recursive:true});
if(await fs.realpath(output)!==output)throw new Error('Build output must not be a symlink');
if((await fs.readdir(output)).some(file=>!files.includes(file)))throw new Error('Unexpected file in signing build output');
for(const file of files){
  const target=path.join(output,file);
  try {if((await fs.lstat(target)).isSymbolicLink())throw new Error('Build assets must not be symlinks');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.copyFile(path.join(root,'signing-client',file),target);
}
console.log('Built isolated signing client only: '+output);
