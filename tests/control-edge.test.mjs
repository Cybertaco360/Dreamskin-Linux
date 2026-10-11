import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {readState,writeState,secureChild,debugPortOpen,restore} from '../lib/control.mjs';

async function temporary(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dreamskin-control-edge-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return root;
}
async function listening(t) {
  const sockets=new Set();
  const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));});
  return server;
}

test('Restore clears an attached session when its listener has exited',async t=>{
  const root=await temporary(t),server=await listening(t),port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  await writeState(root,{schema:1,mode:'paused',port,browserId:'closed-browser'});
  const result=await restore(root);
  assert.equal(result.restored,true);
  assert.equal(result.externalDebugSessionOpen,false);
  assert.deepEqual(await readState(root),{schema:1,mode:'idle'});
});

test('a TCP listener with no valid CDP response is still an open debug port',async t=>{
  const root=await temporary(t),server=await listening(t),port=server.address().port;
  assert.equal(await debugPortOpen(port),true);
  await writeState(root,{schema:1,mode:'unconfirmed',port,managedApp:{pid:2147483647,start:'1',profile:path.join(root,'profiles',randomUUID()),executable:'/unused',args:[]}});
  await assert.rejects(restore(root),/remains open/);
  assert.equal((await readState(root)).mode,'unconfirmed');
});

test('ownership records and escaped managed profile paths are rejected',async t=>{
  const root=await temporary(t);
  for(const key of ['watcher','endpointOwner','managedApp']) {
    for(const record of [{pid:2,start:1},{pid:2.5,start:'1'},[],{pid:2,start:'abc'}]) {
      await writeState(root,{schema:1,mode:'paused',[key]:record});
      await assert.rejects(readState(root),/ownership/);
    }
  }
  await writeState(root,{schema:1,mode:'unconfirmed',managedApp:{pid:2,start:'1',profile:path.join(root,'profiles','..',randomUUID())}});
  await assert.rejects(readState(root),/profile/);
});

test('managed directories reject public permissions and regular files',async t=>{
  const root=await temporary(t);
  await fs.mkdir(path.join(root,'profiles'),{mode:0o755});
  await fs.chmod(path.join(root,'profiles'),0o755);
  await assert.rejects(secureChild(root,'profiles'),/Unsafe/);
  await fs.writeFile(path.join(root,'snapshots'),'existing file',{mode:0o600});
  await assert.rejects(secureChild(root,'snapshots'),/Unsafe/);
});
