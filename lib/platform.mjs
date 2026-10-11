import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function parseOsRelease(text){
 const result={};for(const line of text.split('\n')){const match=line.match(/^([A-Z_]+)=(.*)$/);if(!match)continue;let value=match[2];if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);result[match[1]]=value.replace(/\\([\\"$`])/g,'$1');}return result;
}
async function executable(filename){try{await fs.access(filename,constants.X_OK);const real=await fs.realpath(filename);return (await fs.stat(real)).isFile()?real:null;}catch{return null;}}
async function which(name){if(name.includes('/'))return executable(path.resolve(name));for(const dir of (process.env.PATH||'').split(path.delimiter).filter(Boolean)){const result=await executable(path.join(dir,name));if(result)return result;}return null;}
export async function discoverApps(){
 const paths=['/usr/lib/chatgpt/ChatGPT','/usr/lib/codex/Codex','/opt/ChatGPT/ChatGPT','/opt/ChatGPT/chatgpt','/opt/chatgpt/ChatGPT','/opt/chatgpt/chatgpt','/opt/Codex/Codex','/opt/codex/Codex','/opt/codex/codex','/usr/bin/chatgpt','/usr/bin/codex-desktop'];
 for(const name of ['ChatGPT','chatgpt','codex-desktop']){const match=await which(name);if(match)paths.push(match);}
 const seen=new Set(),apps=[];
 for(const name of paths){const real=await executable(name);if(!real||seen.has(real))continue;seen.add(real);apps.push({label:path.basename(real),executable:real,args:[],kind:real.endsWith('.AppImage')?'appimage':real.includes('launcher')?'wrapper':'native',verified:false});}
 return apps;
}
export async function resolveLaunch(filename,args=[]){
 if(typeof filename!=='string'||!filename||filename.length>4096||/[\0\r\n]/.test(filename))throw new Error('Choose a valid app executable path');
 if(!Array.isArray(args)||args.length>32||args.some(arg=>typeof arg!=='string'||arg.length>4096||/[\0\r\n]/.test(arg)))throw new Error('Invalid app launcher arguments');
 for(const argument of args)if(/^--(?:remote-debugging(?:-|=|$)|user-data-dir(?:=|$)|no-sandbox(?:=|$)|disable-(?:setuid-sandbox|sandbox)(?:=|$))/.test(argument))throw new Error('Debug/profile and sandbox flags are managed by the loader');
 const command=await which(filename);if(!command)throw new Error('App executable was not found or is not executable');
 const header=await fs.open(command,'r');let magic;try{const bytes=Buffer.alloc(4);await header.read(bytes,0,4,0);magic=bytes;}finally{await header.close();}
 if(!(magic[0]===0x7f&&magic.subarray(1,4).toString()==='ELF')&&magic.subarray(0,2).toString()!=='#!')throw new Error('Selected file is not a Linux executable or launcher script');
 return {executable:command,args:[...args],kind:command.endsWith('.AppImage')?'appimage':['flatpak','snap'].includes(path.basename(command))?'sandbox-wrapper':'native'};
}
export function packageGuidance(release){
 const family=(release.ID+' '+(release.ID_LIKE||'')).toLowerCase();
 if(/\b(arch|manjaro|endeavouros)\b/.test(family))return {family:'Arch',dependencies:'nodejs python python-pillow python-pyqt6 (or python-pyqt5)',manager:'pacman',note:'Rolling Node packages should satisfy the version check; verify rather than pinning a distro release.'};
 if(/\b(ubuntu|debian|linuxmint|pop)\b/.test(family))return {family:'Debian/Ubuntu',dependencies:'python3 python3-pil python3-pyqt6 (or python3-pyqt5); Node.js 22+ separately if the distro nodejs is older',manager:'apt',note:'Stable releases can ship Node below 22. The installer checks the runtime version before proceeding.'};
 if(/\b(fedora|rhel|centos|rocky|almalinux)\b/.test(family))return {family:'Fedora/RHEL',dependencies:'nodejs (22+) python3 python3-pillow and PyQt6/PyQt5 for that interpreter (Fedora: python3-pyqt6)',manager:'dnf',note:'Node modules/streams vary on long-lived RHEL releases; choose a supported 22+ runtime.'};
 if(/\b(opensuse|suse|opensuse-tumbleweed|opensuse-leap)\b/.test(family))return {family:'openSUSE',dependencies:'nodejs22 or newer, Pillow and PyQt6/PyQt5 packages for the selected Python stream',manager:'zypper',note:'Python package names depend on the selected Python stream.'};
 if(/\b(nixos)\b/.test(family))return {family:'NixOS',dependencies:'nodejs_22 and a Python environment containing pillow and pyqt6 (or pyqt5)',manager:'Nix',note:'Launch in that environment and set DREAMSKIN_PYTHON/DREAMSKIN_GUI_PYTHON explicitly; /usr/bin/python3 may not exist.'};
 return {family:'Other',dependencies:'Node.js 22+, Python 3 + Pillow; PyQt6 or PyQt5 for GUI',manager:'distribution-specific',note:'musl systems also require a working desktop-app build; a glibc-only Electron binary is not made portable by this loader.'};
}
export async function diagnose(){
 let release={};try{release=parseOsRelease(await fs.readFile('/etc/os-release','utf8'));}catch{}
 const pythonCandidates=[...new Set([process.env.DREAMSKIN_PYTHON,process.env.DREAMSKIN_GUI_PYTHON,'/usr/bin/python3','python3'].filter(Boolean))];
 const python=[];
 for(const candidate of pythonCandidates){try{const {stdout}=await exec(candidate,['-c',`import importlib.util,json,sys; print(json.dumps({'version':sys.version.split()[0],'pillow':importlib.util.find_spec('PIL') is not None,'pyqt6':importlib.util.find_spec('PyQt6') is not None,'pyqt5':importlib.util.find_spec('PyQt5') is not None}))`],{timeout:4000,maxBuffer:8192});python.push({executable:candidate,...JSON.parse(stdout)});}catch{python.push({executable:candidate,available:false});}}
 const apps=await discoverApps();
 const [flatpak,snap]=await Promise.all([which('flatpak'),which('snap')]);
 return {platform:process.platform,architecture:os.arch(),distribution:release.PRETTY_NAME||release.ID||'Unknown',session:process.env.XDG_SESSION_TYPE||((process.env.WAYLAND_DISPLAY&&'wayland')||(process.env.DISPLAY&&'x11')||'headless'),node:{version:process.versions.node,supported:Number(process.versions.node.split('.')[0])>=22&&typeof WebSocket==='function'},python,apps,guidance:packageGuidance(release),managerDisplay:{x11Available:!!process.env.DISPLAY,waylandAvailable:!!process.env.WAYLAND_DISPLAY,note:'PyQt uses the installed Qt platform plugin for Wayland or X11; module availability alone does not confirm that the plugin can start' },sandboxWrappers:{flatpak:!!flatpak,snap:!!snap,support:'conditional; wrappers must pass debug flags and expose a verifiable owner process'},nativeAppCompatibility:'App candidates are discovered, not certified. Applying requires a recognized app:// shell and successful renderer verification.'};
}
