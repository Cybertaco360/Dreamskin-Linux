import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {importTheme,listThemes,validateTheme} from '../lib/themes.mjs';
const exec=promisify(execFile);
const fixture=`import sys,zipfile,json,hashlib,io,stat
from PIL import Image
out,mode=sys.argv[1:]
picture=io.BytesIO(); Image.new('RGB',(16,9),'purple').save(picture,format='PNG')
theme={'schemaVersion':1,'id':'test-theme','name':'Test Theme','image':'background.png','appearance':'dark','art':{'focusX':0.5,'focusY':0.5,'safeArea':'none','taskMode':'ambient'},'colors':{k:'#112233' for k in ['background','panel','panelAlt','accent','accentAlt','secondary','highlight','text','muted','line']}}
css=b'[data-ds-part="composer"] { border-radius: var(--ds-theme-surface-radius); }'
if mode=='unsafe-css': css=b'[data-ds-part="root"] { background-image: url(https://example.com/x); }'
payload={'theme.json':json.dumps(theme).encode(),'theme.css':css,'background.png':picture.getvalue()}
manifest={'packageVersion':1,'themeId':'test-theme','version':'0.1.0','skinApiVersion':1,'minClientVersion':'0.0.0','platforms':['windows','macos'],'capabilities':['background','tokens','safe-css'],'publisher':{'id':'tester','displayName':'Tester'},'license':'MIT','provenance':{'aiGenerated':False,'summary':'Generated test fixture'},'createdAt':'2026-10-10T08:48:37.830Z','files':[{'path':n,'mediaType':{'theme.json':'application/json','theme.css':'text/css','background.png':'image/png'}[n],'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in payload.items()]}
if mode=='hash-mismatch':manifest['files'][0]['sha256']='0'*64
if mode=='future-runtime':manifest['minClientVersion']='999.0.0'
if mode=='missing-css':del payload['theme.css']
if mode not in ('simple',):payload['manifest.json']=json.dumps(manifest).encode()
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for n,b in payload.items():z.writestr(('Theme/' if mode=='wrapped' else '')+n,b)
 if mode=='traversal':z.writestr('../outside','bad')
 if mode=='duplicate':z.writestr('theme.css',css)
 if mode=='nested':z.writestr('other.zip',b'PKxx')
 if mode=='symlink':
  i=zipfile.ZipInfo('link.png');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'/etc/passwd')
 if mode=='many-entries':
  for i in range(33):z.writestr('extra'+str(i),b'x')
`;
async function context(t,mode){const root=await fs.mkdtemp(path.join(os.tmpdir(),'dreamskin-pack-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const archive=path.join(root,'theme.zip');await exec(process.env.DREAMSKIN_PYTHON||'/usr/bin/python3',['-c',fixture,archive,mode]);return {root,archive,library:path.join(root,'themes')};}
for(const mode of ['official','simple','wrapped'])test(`${mode} imports data, validates image, and leaves active theme unchanged`,async t=>{const c=await context(t,mode);const imported=await importTheme(c.archive,c.library);assert.equal(imported.applied,false);assert.equal(imported.id,'test-theme');assert.equal((await listThemes(c.library)).length,1);const v=await validateTheme(path.join(c.library,imported.key));assert.equal(v.image.decoded,true);await v.cleanup();const duplicate=await importTheme(c.archive,c.library);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.key,imported.key);});
for(const mode of ['hash-mismatch','future-runtime','missing-css','unsafe-css','traversal','duplicate','nested','symlink','many-entries'])test(`rejects ${mode} before admission`,async t=>{const c=await context(t,mode);await assert.rejects(importTheme(c.archive,c.library));assert.deepEqual(await listThemes(c.library),[]);});
test('apply revalidation rejects later corruption',async t=>{const c=await context(t,'official');const i=await importTheme(c.archive,c.library);const d=path.join(c.library,i.key);await fs.appendFile(path.join(d,'theme.css'),'\n');await assert.rejects(validateTheme(d),/byte length|SHA-256/);});
test('saved library symlink is rejected',async t=>{const c=await context(t,'official');const other=path.join(c.root,'other');await fs.mkdir(other,{mode:0o700});await fs.symlink(other,c.library);await assert.rejects(importTheme(c.archive,c.library),/private/);assert.deepEqual(await fs.readdir(other),[]);});
