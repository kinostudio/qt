import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parent=path.join(root,'tmp');
const output=path.join(parent,'qt-editor-site');
await fs.mkdir(parent,{recursive:true});
if ((await fs.realpath(parent)) !== parent) throw new Error('Build parent must not be a symlink');
try {
  const existing=await fs.lstat(output);
  if(existing.isSymbolicLink() || await fs.realpath(output)!==output) throw new Error('Refusing to replace linked build output');
  // Only this exact generated directory is replaced, never the repository or user data.
  await fs.rm(output,{recursive:true,force:true});
} catch(error) {if(error.code!=='ENOENT') throw error;}
await fs.mkdir(output);
await fs.copyFile(path.join(root,'index.html'),path.join(output,'index.html'));
async function copyAssets(source,target) {
  await fs.mkdir(target,{recursive:true});
  for(const entry of await fs.readdir(source,{withFileTypes:true})) {
    if(entry.isSymbolicLink()) throw new Error('Public assets cannot contain symbolic links');
    if(entry.isDirectory()) await copyAssets(path.join(source,entry.name),path.join(target,entry.name));
    else if(entry.isFile()) await fs.copyFile(path.join(source,entry.name),path.join(target,entry.name));
  }
}
await copyAssets(path.join(root,'assets'),path.join(output,'assets'));
console.log('Built editor public files only: '+output);
