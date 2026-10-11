import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {secureRoot,secureChild,readState,writeState,processIdentity,endpoint,endpointOwner,withLock} from '../lib/control.mjs';
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dreamskin-control-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('private state round trip and active path traversal rejected',async t=>{
 const root=await temporary(t);await secureRoot(root);await writeState(root,{schema:1,mode:'paused',port:9222,browserId:'test'});assert.equal((await readState(root)).port,9222);
 await writeState(root,{schema:1,mode:'active',active:{key:'..'}});await assert.rejects(readState(root),/identity/);
});
test('symlinked state and child directories rejected before writes',async t=>{
 const root=await temporary(t),outside=await temporary(t);await fs.symlink(outside,path.join(root,'snapshots'));await assert.rejects(secureChild(root,'snapshots'),/Unsafe/);
 await fs.writeFile(path.join(outside,'state'),'{"schema":1,"mode":"idle"}',{mode:0o600});await fs.symlink(path.join(outside,'state'),path.join(root,'state.json'));await assert.rejects(readState(root));
 assert.deepEqual(await fs.readdir(outside),['state']);
});
test('state size and managed ownership record are bounded',async t=>{
 const root=await temporary(t);await fs.writeFile(path.join(root,'state.json'),' '.repeat(65537),{mode:0o600});await assert.rejects(readState(root),/Unsafe/);
 await writeState(root,{schema:1,mode:'paused',managedApp:{pid:1,start:'x',profile:'/tmp'}});await assert.rejects(readState(root),/ownership/);
});
test('Linux process identity includes start time and argv',async()=>{const identity=await processIdentity(process.pid);assert.equal(identity.pid,process.pid);assert.match(identity.start,/^\d+$/);assert.ok(identity.command.length);assert.equal(await processIdentity(-1),null);});
test('control operations serialize across asynchronous callbacks',async t=>{
 const root=await temporary(t),seen=[];
 await Promise.all([withLock(root,async()=>{seen.push('first');await new Promise(r=>setTimeout(r,120));seen.push('first-done');}),withLock(root,async()=>seen.push('second'))]);
 assert.ok(seen.indexOf('second')===0||seen.indexOf('second')===2);assert.equal((await fs.readdir(root)).includes('.control-lock'),false);
});
test('CDP endpoint rejects remote and oversized identity responses',async t=>{
 let body;const server=http.createServer((req,res)=>res.end(body));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port;
 body=JSON.stringify({webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/browser/test-id`});assert.equal((await endpoint(port)).browserId,'test-id');
 body=JSON.stringify({webSocketDebuggerUrl:`ws://example.com:${port}/devtools/browser/test-id`});await assert.rejects(endpoint(port),/loopback/);
 body=' '.repeat(65537);await assert.rejects(endpoint(port),/Oversized/);
 await assert.rejects(endpointOwner(port),/different application|uniquely verify/);
});
