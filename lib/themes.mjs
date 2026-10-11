import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPayload} from '../scripts/injector.mjs';
const exec=promisify(execFile);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let chosenPython;
async function python(){
  if(chosenPython)return chosenPython;
  const candidates=process.env.DREAMSKIN_PYTHON?[process.env.DREAMSKIN_PYTHON]:['python3','/usr/bin/python3'];
  for(const name of candidates){try{await exec(name,['-c','import PIL, zipfile'],{timeout:5000,maxBuffer:4096});chosenPython=name;return name;}catch{}}
  throw new Error('Python 3 with Pillow is required for safe image validation. See DISTROS.md or set DREAMSKIN_PYTHON.');
}
async function helper(args){
  try{const result=await exec(await python(),[path.join(project,'lib/extract_zip.py'),...args],{timeout:30000,maxBuffer:65536});return JSON.parse(result.stdout);}
  catch(e){throw new Error(e.stderr?.trim()||e.message);}
}
async function readJson(file,limit=1048576){
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit)throw new Error('Theme JSON size is invalid');const data=Buffer.alloc(limit+1);let count=0;while(count<data.length){const r=await handle.read(data,count,data.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}if(count>limit)throw new Error('Theme JSON exceeds its limit');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,count)));}finally{await handle.close();}
}
export async function validateTheme(directory){
  const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Theme must be an ordinary directory');
  const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'dreamskin-verified-'));
  await fs.chmod(tempRoot,0o700);const stage=path.join(tempRoot,'payload');await fs.mkdir(stage,{mode:0o700});
  const cleanup=()=>fs.rm(tempRoot,{recursive:true,force:true});
  try{
    let manifest;try{manifest=await readJson(path.join(directory,'manifest.json'),65536);}catch(e){if(e.code!=='ENOENT')throw e;}
    // v1 has no Linux enum; validate an actual declaration, retain original bytes.
    const platform=Array.isArray(manifest?.platforms)&&manifest.platforms.includes('macos')?'macos':'windows';
    const result=await exec(process.execPath,[path.join(project,'assets/theme-package-validator.mjs'),'--source',directory,'--stage',stage,'--platform',platform,'--client-version','1.5.20'],{timeout:15000,maxBuffer:65536});
    const validation=JSON.parse(result.stdout),raw=await readJson(path.join(stage,'theme.json'));
    const image=await helper(['--image',path.join(stage,raw.image)]);
    const payload=await loadPayload(stage);new Function(payload.payload);
    return {directory:stage,tempRoot,theme:payload.theme,manifest,format:validation.format,image,cleanup};
  }catch(error){await cleanup();throw new Error(error.stderr?.trim()||error.message);}
}
async function libraryDirectory(root){
  await fs.mkdir(root,{recursive:true,mode:0o700});const s=await fs.lstat(root);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw new Error('Saved-theme directory must be private and owned by you');
}
async function digestDirectory(directory){
 const hash=createHash('sha256');let total=0;
 for(const name of (await fs.readdir(directory)).sort()){
  const allowed=['manifest.json','manifest.sig','theme.json','theme.css','LICENSE.txt'].includes(name)||/\.(?:png|jpe?g|webp)$/i.test(name);
  if(!allowed)throw new Error('Unexpected saved-theme file');
  const limit=/\.(?:png|jpe?g|webp)$/i.test(name)?10485760:name==='theme.json'?1048576:name==='theme.css'?262144:65536;
  const handle=await fs.open(path.join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit)throw new Error('Saved-theme file exceeds its limit');
   hash.update(name).update('\0');const bytes=Buffer.alloc(262144);let length=0;
   while(true){const r=await handle.read(bytes,0,Math.min(bytes.length,limit-length+1),null);if(!r.bytesRead)break;length+=r.bytesRead;total+=r.bytesRead;if(length>limit||total>67108864)throw new Error('Saved theme exceeds its limits');hash.update(bytes.subarray(0,r.bytesRead));}
   const after=await handle.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('Saved theme changed while hashing');hash.update('\0');
  }finally{await handle.close();}
 }
 return hash.digest('hex');
}
export async function importTheme(zipPath,libraryRoot){
 if(path.extname(zipPath).toLowerCase()!=='.zip')throw new Error('Import accepts ordinary .zip packages only');
 await libraryDirectory(libraryRoot);
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'dreamskin-import-'));await fs.chmod(temporary,0o700);
 const extracted=path.join(temporary,'source');await fs.mkdir(extracted,{mode:0o700});let checked;
 try{
  await helper(['--source',zipPath,'--output',extracted]);checked=await validateTheme(extracted);
  const digest=await digestDirectory(checked.directory),slug=String(checked.theme.id).replace(/[^a-zA-Z0-9._-]/g,'-').replace(/^[.-]+/,'').slice(0,64)||'theme';
  const key=slug+'-'+digest.slice(0,20),destination=path.join(libraryRoot,key);
  let duplicate=false;
  try{const s=await fs.lstat(destination);if(!s.isDirectory()||s.isSymbolicLink()||await digestDirectory(destination)!==digest)throw new Error('Saved theme identity conflicts with imported package');duplicate=true;}
  catch(e){if(e.code!=='ENOENT')throw e;const staging=await fs.mkdtemp(path.join(libraryRoot,'.import-'));try{for(const name of await fs.readdir(checked.directory)){await fs.copyFile(path.join(checked.directory,name),path.join(staging,name),constants.COPYFILE_EXCL);await fs.chmod(path.join(staging,name),0o600);}await fs.chmod(staging,0o700);await fs.rename(staging,destination);}catch(e){await fs.rm(staging,{recursive:true,force:true});throw e;}}
  return {imported:true,duplicate,key,id:checked.theme.id,name:checked.theme.name,format:checked.format,applied:false,platformDeclarationAdvisory:!!checked.manifest};
 }finally{await checked?.cleanup();await fs.rm(temporary,{recursive:true,force:true});}
}
export async function listThemes(libraryRoot){
 let entries;try{const s=await fs.lstat(libraryRoot);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('Unsafe saved-theme directory');entries=await fs.readdir(libraryRoot,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return[];throw e;}
 const results=[];
 for(const entry of entries){if(!entry.isDirectory()||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*-[0-9a-f]{20}$/.test(entry.name))continue;try{const theme=await readJson(path.join(libraryRoot,entry.name,'theme.json'));let version='local';try{const manifest=await readJson(path.join(libraryRoot,entry.name,'manifest.json'),65536);if(typeof manifest.version==='string'&&/^\d+\.\d+\.\d+$/.test(manifest.version))version=manifest.version;}catch{}results.push({key:entry.name,version,id:typeof theme.id==='string'?theme.id:'custom',name:typeof theme.name==='string'?theme.name.slice(0,80):'Theme'});}catch{}}
 return results.sort((a,b)=>a.name.localeCompare(b.name));
}
