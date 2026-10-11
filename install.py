#!/usr/bin/env python3
"""User-only XDG installer with staged engine replacement and output rollback."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
SOURCE=Path(__file__).resolve().parent

def owned_directory(path, private=False):
    if path.is_symlink(): raise RuntimeError('Refusing a symbolic link for an installation directory')
    path.mkdir(parents=True,exist_ok=True,mode=0o700 if private else 0o755)
    metadata=path.stat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid!=os.getuid() or metadata.st_mode&0o022:
        raise RuntimeError('Installation directories must belong to you and not be writable by others')
    if private: path.chmod(0o700)

def quote_desktop(value):
    if any(ch in value for ch in '\n\r\0'): raise RuntimeError('Invalid path for desktop entry')
    return '"'+value.replace('\\','\\\\\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$').replace('%','%%')+'"'

def existing_output(path):
    if path.is_symlink(): raise RuntimeError('Refusing to overwrite a symbolic link')
    if not path.exists(): return None
    metadata=path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid!=os.getuid() or metadata.st_size>65536:
        raise RuntimeError('Existing launcher identity is unsafe')
    content=path.read_bytes()
    if b'DreamSkin Linux' not in content: raise RuntimeError('Existing launcher belongs to another program')
    return content,stat.S_IMODE(metadata.st_mode)

def atomic_output(path,content,mode):
    fd,name=tempfile.mkstemp(prefix='.'+path.name+'-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream: stream.write(content)
        os.chmod(name,mode)
        if path.is_symlink(): raise RuntimeError('Launcher changed into a symbolic link')
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-home',type=Path,default=Path(os.environ.get('XDG_DATA_HOME',Path.home()/'.local/share')))
    parser.add_argument('--bin-home',type=Path,default=Path.home()/'.local/bin')
    parser.add_argument('--node',default=shutil.which('node'))
    options=parser.parse_args()
    if os.geteuid()==0: raise RuntimeError('Run as your normal user, without sudo')
    if not options.node: raise RuntimeError('Install Node.js 22 or newer first; see DISTROS.md')
    node=Path(options.node).resolve(strict=True)
    check=subprocess.run([str(node),'-e','if(Number(process.versions.node.split(".")[0])<22||typeof WebSocket!=="function")process.exit(1)'])
    if check.returncode: raise RuntimeError('Node.js 22 or newer with built-in WebSocket is required')
    if not options.data_home.is_absolute() or not options.bin_home.is_absolute(): raise RuntimeError('Installation directories must be absolute')
    root=options.data_home/'dreamskin-linux'
    owned_directory(root,True)
    lock=root/'.install-lock'
    try: lock.mkdir(mode=0o700)
    except FileExistsError: raise RuntimeError('An installation lock exists; finish or inspect the earlier installation first')
    stage=None
    previous=root/'.engine-previous'
    engine=root/'engine'
    committed=[]
    swapped=False
    had_engine=False
    try:
        if previous.exists() or previous.is_symlink(): raise RuntimeError('An upgrade backup exists; inspect it before installing')
        if engine.is_symlink(): raise RuntimeError('Engine must not be a symbolic link')
        if engine.exists():
            owned_directory(engine,True)
            metadata=engine/'package.json'
            if metadata.is_symlink() or not metadata.is_file() or metadata.stat().st_size>65536 or json.loads(metadata.read_text()).get('name')!='dreamskin-linux':
                raise RuntimeError('Existing engine identity cannot be confirmed')
        owned_directory(options.bin_home)
        applications=options.data_home/'applications'
        owned_directory(applications)
        cli=engine/'bin/dreamskin.mjs'
        env_command=shutil.which('env')
        if not env_command: raise RuntimeError('An env executable is required for desktop launchers')
        setting='DREAMSKIN_DATA_HOME='+str(root)
        shell='#!/bin/sh\n# DreamSkin Linux user launcher\nexec '+shlex.quote(env_command)+' '+shlex.quote(setting)+' '+shlex.quote(str(node))+' '+shlex.quote(str(cli))+' "$@"\n'
        desktop_command=' '.join(quote_desktop(value) for value in (env_command,setting,str(node),str(cli)))
        common='[Desktop Entry]\nType=Application\nCategories=Utility;\nTerminal=false\n'
        outputs=[(options.bin_home/'dreamskin',shell.encode(),0o700),(applications/'dreamskin-linux.desktop',(common+'Name=DreamSkin Linux\nComment=Manage local DreamSkin themes\nExec='+desktop_command+' gui\n').encode(),0o644),(applications/'dreamskin-linux-restore.desktop',(common+'Name=DreamSkin Linux Restore\nComment=Remove theme and close a managed debug session\nExec='+desktop_command+' gui --restore\n').encode(),0o644)]
        backups={filename:existing_output(filename) for filename,_,_ in outputs}
        stage=Path(tempfile.mkdtemp(prefix='.engine-stage-',dir=root))
        for name in ('assets','lib','scripts','bin'):
            shutil.copytree(SOURCE/name,stage/name,symlinks=False,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        for name in ('package.json','LICENSE','UPSTREAM.md','README.md','DISTROS.md','COMPATIBILITY.md','requirements-gui.txt'):
            shutil.copyfile(SOURCE/name,stage/name)
        result=subprocess.run([str(node),str(stage/'bin/dreamskin.mjs'),'help'],capture_output=True,text=True)
        if result.returncode: raise RuntimeError(result.stderr.strip() or 'Engine validation failed')
        had_engine=engine.exists()
        if had_engine: engine.rename(previous)
        try: stage.rename(engine)
        except Exception:
            if had_engine: previous.rename(engine)
            raise
        swapped=True
        for filename,content,mode in outputs:
            atomic_output(filename,content,mode)
            committed.append(filename)
        if previous.exists(): shutil.rmtree(previous)
        swapped=False
        print('Installed DreamSkin Linux. Open the application menu or run '+str(options.bin_home/'dreamskin')+' gui')
        print('Saved themes and managed profiles use '+str(root))
    except Exception:
        for filename in reversed(committed):
            old=backups[filename]
            if old: atomic_output(filename,old[0],old[1])
            else: filename.unlink()
        if swapped:
            engine.rename(stage)
            if had_engine: previous.rename(engine)
        raise
    finally:
        if stage is not None and stage.exists(): shutil.rmtree(stage)
        lock.rmdir()

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
