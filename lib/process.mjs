import fs from 'node:fs/promises';
import path from 'node:path';

export async function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try {
    const directory = `/proc/${pid}`;
    const [metadata, raw, command] = await Promise.all([
      fs.stat(directory), fs.readFile(`${directory}/stat`, 'utf8'), fs.readFile(`${directory}/cmdline`)
    ]);
    if (metadata.uid !== process.getuid()) return null;
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (fields[0] === 'Z' || fields[0] === 'X' || !/^\d+$/.test(fields[19])) return null;
    return {pid, start: fields[19], ppid: Number(fields[1]), command: command.toString().split('\0').filter(Boolean)};
  } catch { return null; }
}

function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Electron can replace argv with one process-title string. Match literal switches,
// including paths with spaces, without interpreting that string as shell code.
export function hasSwitch(command, name, value) {
  if (!Array.isArray(command)) return false;
  for (let index = 0; index < command.length; index++) {
    if (value === undefined && (command[index] === name || command[index].startsWith(name + '='))) return true;
    if (value !== undefined && (command[index] === `${name}=${value}` || (command[index] === name && command[index + 1] === String(value)))) return true;
  }
  if (command.length !== 1) return false;
  const suffix = value === undefined ? '(?:=|\\s|$)' : '(?:=|\\s+)' + escape(String(value)) + '(?=\\s|$)';
  return new RegExp('(?:^|\\s)' + escape(name) + suffix).test(command[0]);
}

export function descendantOf(child, ancestor, identities) {
  const seen = new Set();
  let current = child;
  while (current && !seen.has(current.pid)) {
    if (current.pid === ancestor.pid) return current.start === ancestor.start;
    seen.add(current.pid);
    const parent = identities.get(current.ppid);
    if (!parent || BigInt(parent.start) > BigInt(current.start)) return false;
    current = parent;
  }
  return false;
}

export function selectSocketOwner(owners, identities) {
  // Inherited descriptors do not represent independent browser listeners. Only
  // accept the one holder that is an ancestor of every other readable holder.
  const roots = owners.filter(candidate => owners.every(other => descendantOf(other, candidate, identities)));
  if (roots.length !== 1) {
    throw new Error(owners.length ? `The debug socket has ${owners.length} unrelated process owners; no app was attached.` : 'The debug listener is present, but its process descriptors are unreadable. Run the manager outside a restricted sandbox; do not disable the app sandbox.');
  }
  return roots[0];
}

export async function listeningSockets(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Debug port must be 1024–65535');
  const result = [];
  for (const table of ['tcp', 'tcp6']) {
    let text;
    try { text = await fs.readFile(`/proc/net/${table}`, 'utf8'); }
    catch (error) { throw new Error(`Cannot read Linux socket ownership (${error.code}); run the manager outside a restricted sandbox.`); }
    for (const line of text.trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] !== '0A') continue;
      const [address, hexPort] = fields[1].split(':');
      if (parseInt(hexPort, 16) !== port) continue;
      const loopback = table === 'tcp' ? address === '0100007F' : address === '00000000000000000000000001000000';
      if (!loopback) throw new Error('Debug port also listens outside loopback; quit that debug session and relaunch locally');
      if (Number(fields[7]) !== process.getuid() || !/^[1-9]\d*$/.test(fields[9])) throw new Error('Cannot verify the debug listener UID or socket inode');
      result.push(fields[9]);
    }
  }
  if (!result.length) throw new Error('No loopback listening socket found');
  return new Set(result);
}

async function heldSockets(pid, inodes) {
  const result = new Set();
  let descriptors;
  try { descriptors = await fs.readdir(`/proc/${pid}/fd`); } catch { return result; }
  for (const fd of descriptors) {
    try {
      const link = await fs.readlink(`/proc/${pid}/fd/${fd}`);
      const inode = link.match(/^socket:\[(\d+)\]$/)?.[1];
      if (inodes.has(inode)) result.add(inode);
    } catch { /* A descriptor can close during enumeration. */ }
  }
  return result;
}

export async function endpointOwner(port) {
  const sockets = await listeningSockets(port);
  const identities = new Map(), owners = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const identity = await processIdentity(Number(name));
    if (!identity) continue;
    identities.set(identity.pid, identity);
    if ((await heldSockets(identity.pid, sockets)).size) owners.push(identity);
  }
  const owner = selectSocketOwner(owners, identities);
  let executable;
  try { executable = await fs.readlink(`/proc/${owner.pid}/exe`); }
  catch { throw new Error('Cannot verify app executable'); }
  if (!/^(?:ChatGPT|Codex|chatgpt|codex)(?:-bin|-desktop)?$/i.test(path.basename(executable)) || hasSwitch(owner.command, '--type')) {
    throw new Error('Debug port belongs to a different application or an app subprocess');
  }
  if (!hasSwitch(owner.command, '--remote-debugging-port', port)) throw new Error('The listening process does not identify itself as the app launched with this debugging port');
  const current = await processIdentity(owner.pid);
  const currentSockets = await listeningSockets(port);
  const held = await heldSockets(owner.pid, currentSockets);
  if (!current || current.start !== owner.start || [...currentSockets].some(inode => !sockets.has(inode) || !held.has(inode))) {
    throw new Error('Debug socket ownership changed during verification; retry the connection');
  }
  return {...current, executable, inheritedHolders: owners.length - 1};
}

export async function runningOriginalApps(executable) {
  const result = [];
  for (const name of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const identity = await processIdentity(Number(name));
    if (!identity || hasSwitch(identity.command, '--type') || hasSwitch(identity.command, '--user-data-dir')) continue;
    try { if (await fs.readlink(`/proc/${name}/exe`) === executable) result.push(identity); } catch {}
  }
  return result;
}
