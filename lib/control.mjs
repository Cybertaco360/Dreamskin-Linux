import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { validateTheme } from './themes.mjs';
import { resolveLaunch } from './platform.mjs';
import { processIdentity, endpointOwner, hasSwitch, runningOriginalApps } from './process.mjs';
export { processIdentity, endpointOwner } from './process.mjs';
const exec = promisify(execFile);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const injector = path.join(projectRoot, 'scripts', 'injector.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function dataRoot() {
  const result = process.env.DREAMSKIN_DATA_HOME || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'dreamskin-linux');
  if (!path.isAbsolute(result)) throw new Error('Theme data directory must be absolute');
  return path.resolve(result);
}
export async function secureRoot(root = dataRoot()) {
  await fs.mkdir(root, {recursive:true, mode:0o700});
  const s = await fs.lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o022)) throw new Error('Theme data directory must be owned by you and not writable by others');
  await fs.chmod(root, 0o700);
  return root;
}
export async function secureChild(root, name) {
  const directory=path.join(root,name);
  await fs.mkdir(directory,{recursive:false,mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw new Error(`Unsafe managed ${name} directory`);
  return directory;
}
export async function readState(root = dataRoot()) {
  try {
    const handle = await fs.open(path.join(root, 'state.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== process.getuid() || stat.size > 65536 || (stat.mode & 0o077)) throw new Error('Unsafe state file');
      const state = JSON.parse(await handle.readFile('utf8'));
      if (state.schema !== 1 || !['idle','active','paused','unconfirmed'].includes(state.mode)) throw new Error('Unsupported state file');
      if (state.port != null && (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535)) throw new Error('Invalid state port');
      if (state.browserId != null && !/^[A-Za-z0-9._-]{1,200}$/.test(state.browserId)) throw new Error('Invalid browser identity');
      for (const key of ['active','previous']) {
        if (state[key] && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(state[key].key) || path.basename(state[key].key) !== state[key].key)) throw new Error('Invalid saved theme identity');
      }
      for(const key of ['watcher','endpointOwner','managedApp']) {
        const record=state[key];
        if(record && (typeof record!=='object'||Array.isArray(record)||!Number.isSafeInteger(record.pid)||record.pid<2||typeof record.start!=='string'||!/^\d+$/.test(record.start)))throw new Error('Invalid process ownership record');
      }
      if(state.managedApp){
        const app=state.managedApp;
        if(app.profileMode!=null&&!['original','separate'].includes(app.profileMode))throw new Error('Invalid managed profile mode');
        if(app.profileMode==='original'){
          if(app.profile!=null||typeof app.executable!=='string'||!path.isAbsolute(app.executable)||!state.port)throw new Error('Invalid original-profile ownership record');
        }else if(typeof app.profile!=='string'||path.dirname(app.profile)!==path.join(root,'profiles')||!/^[-a-f0-9]{36}$/.test(path.basename(app.profile)))throw new Error('Invalid managed profile');
      }
      return state;
    } finally { await handle.close(); }
  } catch(e) { if (e.code === 'ENOENT') return {schema:1,mode:'idle'}; throw e; }
}
export async function writeState(root,state) {
  const temporary = path.join(root, `.state-${randomUUID()}`);
  await fs.writeFile(temporary, JSON.stringify({...state,schema:1},null,2)+'\n', {flag:'wx',mode:0o600});
  await fs.rename(temporary, path.join(root,'state.json'));
}
export async function withLock(root, fn) {
  await secureRoot(root);
  const lock=path.join(root,'.control-lock');
  const me=await processIdentity(process.pid);
  let acquired=false;
  for (let attempt=0;attempt<120;attempt++) {
    try { await fs.mkdir(lock,{mode:0o700}); await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify(me),{flag:'wx',mode:0o600}); acquired=true; break; }
    catch(e) {
      if(e.code!=='EEXIST') throw e;
      const stat=await fs.lstat(lock);
      if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid()) throw new Error('Unsafe control lock');
      let owner; try {owner=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));} catch { if(Date.now()-stat.mtimeMs>10000) throw new Error('Incomplete control lock; inspect before removing it'); }
      const live=owner && await processIdentity(owner.pid);
      if(owner && (!live || live.start!==owner.start)) {await fs.rm(lock,{recursive:true});continue;}
      if(attempt===119) throw new Error('Another theme operation is still running');
      await sleep(100);
    }
  }
  if(!acquired)throw new Error('Could not acquire the theme operation lock');
  try{return await fn();}finally{await fs.rm(lock,{recursive:true,force:true});}
}
export async function endpoint(port) {
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Debug port must be 1024–65535');
  const response=await fetch(`http://127.0.0.1:${port}/json/version`,{redirect:'error',signal:AbortSignal.timeout(2500)});
  if(!response.ok) throw new Error('Debug endpoint is not available');
  const reader=response.body.getReader();let total=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>65536){await reader.cancel();throw new Error('Oversized debug response');}chunks.push(Buffer.from(value));}
  const version=JSON.parse(Buffer.concat(chunks).toString());
  const url=new URL(version.webSocketDebuggerUrl);
  const match=url.pathname.match(/^\/devtools\/browser\/([A-Za-z0-9._-]{1,200})$/);
  if(url.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||Number(url.port)!==port||url.username||url.password||url.search||url.hash||!match)throw new Error('Debug endpoint is not a loopback browser endpoint');
  return {port,browserId:match[1],url:url.href};
}
export async function runInjector(mode, state, directory) {
  const args=[injector,`--${mode}`,'--port',String(state.port),'--browser-id',state.browserId,'--timeout-ms','20000'];
  if(directory)args.push('--theme-dir',directory);
  try {
    const result=await exec(process.execPath,args,{timeout:30000,maxBuffer:2*1024*1024});
    return JSON.parse(result.stdout);
  }catch(e){const error=new Error(`Theme ${mode} failed. Bring the app window into view and check its UI compatibility.`);error.details=(e.stdout||e.stderr||e.message).slice(-12000);throw error;}
}
async function pinnedEndpoint(state) {
  const current=await endpoint(state.port);
  if(current.browserId!==state.browserId)throw new Error('The debug app changed; attach again explicitly');
  const owner=await endpointOwner(state.port);
  if(state.endpointOwner && (owner.pid!==state.endpointOwner.pid||owner.start!==state.endpointOwner.start))throw new Error('The debug port changed owner; attach again explicitly');
  if(state.managedApp)await checkManagedProcess(state,owner);
  return current;
}

async function checkManagedProcess(state, live) {
  const app=state.managedApp;
  if(!app||!live||live.pid!==app.pid||live.start!==app.start)throw new Error('The launched app has exited or changed; quit its debug window normally and use Restore');
  let executable;
  try{executable=await fs.readlink(`/proc/${live.pid}/exe`);}catch{throw new Error('Cannot verify the launched app executable');}
  if(executable!==app.executable||!hasSwitch(live.command,'--remote-debugging-port',state.port))throw new Error('Managed app identity could not be verified; quit the debug app manually');
  if(app.profileMode==='original'){
    if(hasSwitch(live.command,'--user-data-dir'))throw new Error('The app no longer matches its original-profile launch');
  }else if(!hasSwitch(live.command,'--user-data-dir',app.profile))throw new Error('The app no longer matches its separate-profile launch');
  return live;
}

export async function reconnect(root) {
  const state=await readState(root);
  if(!state.managedApp||!state.port)throw new Error('No launched app to reconnect. Use Connect app or Attach.');
  if(state.active||state.watcher)throw new Error('Use Pause or Restore to recover an unconfirmed theme before reconnecting.');
  const [ep,owner]=await Promise.all([endpoint(state.port),endpointOwner(state.port)]);
  await checkManagedProcess(state,owner);
  state.browserId=ep.browserId;
  state.endpointOwner={pid:owner.pid,start:owner.start};
  state.mode='paused';
  await writeState(root,state);
  return {connected:true,port:state.port,managed:true,profileMode:state.managedApp.profileMode||'separate',inheritedSocketHolders:owner.inheritedHolders,note:'Your running app is connected. You can apply a theme now.'};
}
async function stopWatcher(root,state) {
  if(!state.watcher)return;
  const actual=await processIdentity(state.watcher.pid);
  if(actual && actual.start===state.watcher.start){
    if(!actual.command.includes(injector)||!actual.command.includes('--watch')||!actual.command.includes(path.join(root,'snapshots',state.active?.key||'')))throw new Error('Watcher process identity is unconfirmed');
    try{process.kill(actual.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
    for(let i=0;i<60;i++){const now=await processIdentity(actual.pid);if(!now||now.start!==actual.start)break;await sleep(100);if(i===59)throw new Error('Theme watcher has not stopped');}
  }
  delete state.watcher;
}
async function startWatcher(root,state,directory) {
  const log=await fs.open(path.join(root,'watcher.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
  try{
    const child=spawn(process.execPath,[injector,'--watch','--port',String(state.port),'--browser-id',state.browserId,'--theme-dir',directory],{stdio:['ignore',log.fd,log.fd],detached:true});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    const identity=await processIdentity(child.pid);if(!identity)throw new Error('Theme watcher failed to start; inspect watcher.log');
    state.watcher={pid:identity.pid,start:identity.start};
    await sleep(350);const live=await processIdentity(child.pid);if(!live||live.start!==identity.start)throw new Error('Theme watcher exited; inspect watcher.log');
  }finally{await log.close();}
}
export async function attach(root,port) {
  const state=await readState(root);
  if(state.watcher || state.managedApp)throw new Error('Restore the current session before attaching another app');
  const [ep,owner]=await Promise.all([endpoint(port),endpointOwner(port)]);
  const next={schema:1,mode:'paused',port,browserId:ep.browserId,endpointOwner:{pid:owner.pid,start:owner.start}};
  await writeState(root,next);return {attached:true,port,managed:false};
}
export async function applyTheme(root,key) {
  if(!/^[a-zA-Z0-9._-]+$/.test(key)||key==='.'||key==='..')throw new Error('Invalid saved theme key');
  const state=await readState(root);await pinnedEndpoint(state);
  const checked=await validateTheme(path.join(root,'themes',key));
  let snapshots,snapshot;
  try{snapshots=await secureChild(root,'snapshots');snapshot=path.join(snapshots,key+'-'+randomUUID());await fs.cp(checked.directory,snapshot,{recursive:true,force:false,errorOnExist:true});}catch(e){if(snapshot)await fs.rm(snapshot,{recursive:true,force:true});await checked.cleanup();throw e;}
  await checked.cleanup();
  const nextActive={key:path.basename(snapshot),libraryKey:key,id:checked.theme.id,name:checked.theme.name};
  const previous=state.mode==='active'?state.active:null;
  await stopWatcher(root,state);
  try{
    const verified=await runInjector('once',state,snapshot);
    state.previous=previous;state.active=nextActive;state.mode='active';state.verifiedAt=new Date().toISOString();
    await startWatcher(root,state,snapshot);await writeState(root,state);
    return {applied:true,themeId:checked.theme.id,name:checked.theme.name,verified:true,targetCount:verified.targets.length};
  }catch(error){
    await stopWatcher(root,state);
    let recovered=false;
    try{
      if(previous){await runInjector('once',state,path.join(snapshots,previous.key));state.active=previous;state.mode='active';await startWatcher(root,state,path.join(snapshots,previous.key));}
      else{await runInjector('remove',state);delete state.active;state.mode='paused';}
      recovered=true;
    }catch{state.active=nextActive;state.mode='unconfirmed';}
    try{await writeState(root,state);}catch(e){await stopWatcher(root,state);throw new Error(`Recovered appearance but could not save session state: ${e.message}`);}
    if(recovered)await fs.rm(snapshot,{recursive:true,force:true});
    error.message+=recovered?' Previous appearance was restored and verified.':' Recovery could not be verified; use Pause or quit the debug app.';throw error;
  }
}
export async function pause(root) {
  const state=await readState(root);await stopWatcher(root,state);
  let result;try{await pinnedEndpoint(state);result=await runInjector('remove',state);}catch(error){state.mode='unconfirmed';await writeState(root,state);throw error;}
  state.mode='paused';await writeState(root,state);
  return {paused:true,verified:true,debugSessionOpen:true,targets:result.targets.length};
}
export async function verify(root) {
  const state=await readState(root);await pinnedEndpoint(state);
  if(!state.active)throw new Error('No active theme to verify');
  return await runInjector('verify',state,path.join(root,'snapshots',state.active.key));
}
async function freePort() {
  const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});const port=server.address().port;await new Promise(r=>server.close(r));return port;
}
export function launchArguments(launchSpec, port, profile) {
  return [...launchSpec.args,...(profile?[`--user-data-dir=${profile}`]:[]),'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`];
}
export async function launch(root, executable, args=[], profileMode='separate') {
  const old=await readState(root);
  if(old.watcher || old.managedApp || old.port)throw new Error('Retry connection or Restore the current session before launching another');
  if(!['original','separate'].includes(profileMode))throw new Error('Profile must be original or separate');
  const launchSpec=await resolveLaunch(executable,args);
  if(profileMode==='original'&&(await runningOriginalApps(launchSpec.executable)).length)throw new Error('Your usual app is already running. Save your work and quit it normally, then launch it here. Debugging must be enabled when the app starts.');
  const port=await freePort();let profile=null;
  if(profileMode==='separate'){const profiles=await secureChild(root,'profiles');profile=path.join(profiles,randomUUID());await fs.mkdir(profile,{mode:0o700});}
  const log=await fs.open(path.join(root,'app.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
  let child;
  try{child=spawn(launchSpec.executable,launchArguments(launchSpec,port,profile),{stdio:['ignore',log.fd,log.fd],detached:true});await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});child.unref();}finally{await log.close();}
  const identity=await processIdentity(child.pid);
  if(!identity)throw new Error('App launcher exited before its identity could be recorded. Select the direct ChatGPT/Codex executable instead of a wrapper. If your usual app was open, quit it normally first.');
  const managedApp={pid:identity.pid,start:identity.start,profile,profileMode,executable:launchSpec.executable,args:launchSpec.args};
  const state={schema:1,mode:'unconfirmed',managedApp,port};
  try{await writeState(root,state);}catch(error){
    const live=await processIdentity(identity.pid);
    let stopped=false;
    try{await checkManagedProcess(state,live);process.kill(identity.pid,'SIGTERM');stopped=true;}catch{}
    throw new Error(`Could not save managed launch. ${stopped?'Stop requested for the verified launched app.':'If its window opened, quit it normally.'} ${error.message}`);
  }
  const deadline=Date.now()+25000;let last;
  while(Date.now()<deadline){
    try{const ep=await endpoint(port);const owner=await endpointOwner(port);await checkManagedProcess(state,owner);state.browserId=ep.browserId;state.endpointOwner={pid:owner.pid,start:owner.start};state.mode='paused';await writeState(root,state);return {launched:true,port,managed:true,profileMode,profile:profileMode==='original'?'your usual app profile':'separate managed profile',note:profileMode==='original'?'Connected using your usual profile. Restore closes this app; reopening it normally closes debugging.':'Sign in to this profile if the app asks. Your normal profile is preserved.'};}catch(e){last=e;}
    const live=await processIdentity(identity.pid);if(!live||live.start!==identity.start)break;await sleep(350);
  }
  throw new Error(`The app connection could not be verified. Use Retry connection if its window opened, or Restore before trying again. ${last?.message||'Select the direct executable; this wrapper may not pass debugging flags.'}`);
}
export async function debugPortOpen(port) {
  return await new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    socket.setTimeout(1500);
    socket.once('connect',()=>{socket.destroy();resolve(true);});
    socket.once('error',error=>{socket.destroy();if(error.code==='ECONNREFUSED')resolve(false);else reject(new Error('Cannot confirm debug port closure'));});
    socket.once('timeout',()=>{socket.destroy();reject(new Error('Cannot confirm debug port closure'));});
  });
}
export async function restore(root) {
  const state=await readState(root);await stopWatcher(root,state);
  let removed=false;
  const wasOpen=state.port?await debugPortOpen(state.port):false;
  if(wasOpen&&state.browserId){try{await pinnedEndpoint(state);await runInjector('remove',state);removed=true;}catch(e){if(!state.managedApp){state.mode='unconfirmed';await writeState(root,state);throw e;}}}
  let closed=false;
  if(state.managedApp){
    const app=state.managedApp;const live=await processIdentity(app.pid);
    if(live && live.start===app.start){
      await checkManagedProcess(state,live);
      try{process.kill(app.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
      for(let i=0;i<100;i++){const now=await processIdentity(app.pid);if(!now||now.start!==app.start){closed=true;break;}await sleep(100);}
      if(!closed)throw new Error('App has not exited yet; finish any pending app prompt and run Restore again');
    }else closed=true;
    if(await debugPortOpen(state.port))throw new Error('Debug endpoint remains open; quit that app manually');
  }
  await writeState(root,{schema:1,mode:'idle'});
  return {restored:true,appearanceRemoved:removed,managedAppClosed:closed,externalDebugSessionOpen:!state.managedApp&&wasOpen,note:!state.managedApp&&wasOpen?'This was an attached app. Quit it and reopen normally to close its debug port.':'Reopen your normal app from its usual launcher.'};
}
export async function status(root) {
  const state=await readState(root);const watcher=state.watcher&&await processIdentity(state.watcher.pid);
  const record=state.endpointOwner;const owner=record&&await processIdentity(record.pid);
  return {mode:state.mode,theme:state.active?.name||null,port:state.port||null,watcherRunning:!!watcher&&watcher.start===state.watcher.start,managed:!!state.managedApp,connected:!!state.browserId&&!!owner&&owner.start===record.start&&['active','paused'].includes(state.mode),profileMode:state.managedApp?(state.managedApp.profileMode||'separate'):'attached'};
}
