#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dataRoot,withLock,attach,applyTheme,pause,restore,launch,reconnect,verify,status} from '../lib/control.mjs';
import {importTheme,listThemes} from '../lib/themes.mjs';
import {diagnose} from '../lib/platform.mjs';
const USAGE=`DreamSkin Linux 0.1.2 (Skin API 1, upstream runtime 1.5.20)

  dreamskin gui                      Open the theme manager
  dreamskin doctor                   Check distro, dependencies, and app candidates
  dreamskin import THEME.zip         Validate and save a DreamSkin package
  dreamskin list                     List saved theme keys
  dreamskin launch --app /path       Launch a separate managed debug profile
    --profile original              Use the app's usual profile (quit it first)
    --profile separate              Use an isolated profile (CLI default)
  dreamskin reconnect               Retry a recorded managed app connection
  dreamskin attach --port 9222       Attach to an existing local debug app
  dreamskin apply THEME_KEY          Apply, verify, and watch a saved theme
  dreamskin pause                    Remove theme; debugging stays open
  dreamskin verify                   Verify current theme in the visible app
  dreamskin restore                  Remove theme; close an owned managed app
  dreamskin status                   Show current session

Optional: --json for machine-readable output. --app-arg VALUE (repeat) for
trusted launcher arguments. No root access or application-file patching.
`;
if(Number(process.versions.node.split('.')[0])<22 || typeof WebSocket!=='function'){
  console.error('DreamSkin Linux requires Node.js 22 or newer with built-in WebSocket.');process.exit(1);
}
const raw=process.argv.slice(2),json=raw.includes('--json');
const argv=raw.filter(x=>x!=='--json'),command=argv.shift()||'gui';
async function main(){
  if(command==='help'||command==='--help'||command==='-h'){console.log(USAGE);return;}
  if(command==='gui'){
    if(argv.length && (argv.length!==1||argv[0]!=='--restore'))throw new Error('gui accepts only optional --restore');
    const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'manager.py');
    const python=process.env.DREAMSKIN_GUI_PYTHON||'/usr/bin/python3';
    const child=spawn(python,[script,...argv],{stdio:'inherit',env:{...process.env,DREAMSKIN_NODE:process.execPath}});
    return await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Theme manager needs Python with PyQt6 or PyQt5 and a working Qt display plugin. Use doctor for dependency guidance.')));});
  }
  if(command==='doctor'){if(argv.length)throw new Error('doctor takes no arguments');return await diagnose();}
  const root=dataRoot();
  if(command==='list'){if(argv.length)throw new Error('list takes no arguments');return {themes:await listThemes(path.join(root,'themes'))};}
  if(command==='status'){if(argv.length)throw new Error('status takes no arguments');return await status(root);}
  return await withLock(root,async()=>{
    if(command==='import'){if(argv.length!==1)throw new Error('import requires one .zip path');return await importTheme(path.resolve(argv[0]),path.join(root,'themes'));}
    if(command==='attach'){if(argv.length!==2||argv[0]!=='--port')throw new Error('attach requires --port NUMBER');return await attach(root,Number(argv[1]));}
    if(command==='launch'){
      let app=null,profile=null;const args=[];
      for(let i=0;i<argv.length;i++){if(argv[i]==='--app'&&!app&&argv[i+1])app=argv[++i];else if(argv[i]==='--profile'&&!profile&&argv[i+1])profile=argv[++i];else if(argv[i]==='--app-arg'&&argv[i+1])args.push(argv[++i]);else throw new Error('launch requires --app PATH, optional --profile original|separate, and optional --app-arg VALUE');}
      if(!app)throw new Error('Choose an app path from doctor and pass --app PATH');
      return await launch(root,app,args,profile||'separate');
    }
    if(command==='apply'){if(argv.length!==1)throw new Error('apply requires a saved theme key from list');return await applyTheme(root,argv[0]);}
    if(argv.length)throw new Error(`${command} takes no arguments`);
    if(command==='pause')return await pause(root);
    if(command==='restore')return await restore(root);
    if(command==='reconnect')return await reconnect(root);
    if(command==='verify')return await verify(root);
    throw new Error(`Unknown command: ${command}. Run dreamskin help.`);
  });
}
try{const result=await main();if(result!==undefined)console.log(JSON.stringify(result,null,json?0:2));}
catch(error){if(json)console.log(JSON.stringify({ok:false,error:error.message,details:error.details||null}));else console.error(error.message+(error.details?'\n'+error.details:''));process.exitCode=1;}
