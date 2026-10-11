#!/usr/bin/env python3
"""Bounded data-only ZIP extraction and static image decoding for Linux."""
import argparse
import json
import os
from pathlib import Path
import stat
import zipfile

ARCHIVE_LIMIT=32*1024*1024
EXPANDED_LIMIT=64*1024*1024
IMAGE_LIMIT=10*1024*1024

def extract(source, output):
    output=Path(output)
    if output.is_symlink() or not output.is_dir() or list(output.iterdir()):
        raise ValueError('Extraction target must be a new empty directory')
    fd=os.open(source, os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        initial=os.fstat(stream.fileno())
        if not stat.S_ISREG(initial.st_mode) or not 1<=initial.st_size<=ARCHIVE_LIMIT:
            raise ValueError('Archive must be a regular file of at most 32 MiB')
        if stream.read(4) != b'PK\x03\x04':
            raise ValueError('Not an ordinary ZIP archive')
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            entries=archive.infolist()
            if not 1<=len(entries)<=32:
                raise ValueError('Archive exceeds the 32-entry limit')
            seen=set()
            files=[]
            declared=0
            for entry in entries:
                name=entry.filename
                if name!=entry.orig_filename or any(ord(c)<32 or ord(c)==127 for c in name) or '\\' in name or ':' in name:
                    raise ValueError('Invalid archive path')
                directory=entry.is_dir()
                normalized=name[:-1] if directory else name
                parts=normalized.split('/')
                if any(p in ('','.', '..') for p in parts) or len(parts)>2 or (directory and len(parts)!=1):
                    raise ValueError('Archive paths must be at root or in one theme folder')
                if normalized.casefold() in seen:
                    raise ValueError('Duplicate or ambiguous archive path')
                seen.add(normalized.casefold())
                filetype=stat.S_IFMT(entry.external_attr>>16)
                if filetype not in (0,stat.S_IFREG,stat.S_IFDIR) or (entry.external_attr&0x400):
                    raise ValueError('Archive links and special files are forbidden')
                if directory!=(filetype==stat.S_IFDIR) and filetype!=0:
                    raise ValueError('Archive file type conflicts with its path')
                if entry.flag_bits&1 or entry.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
                    raise ValueError('Encrypted or unsupported archive compression')
                declared+=entry.file_size
                if declared>EXPANDED_LIMIT or entry.file_size<0:
                    raise ValueError('Archive exceeds the 64 MiB expanded limit')
                if not directory:
                    files.append((entry,parts))
            if not files:
                raise ValueError('Theme ZIP has no files')
            depths={len(parts) for _,parts in files}
            if len(depths)!=1:
                raise ValueError('Ambiguous archive root')
            wrapped=next(iter(depths))==2
            wrapper=files[0][1][0] if wrapped else None
            if wrapped and any(parts[0]!=wrapper for _,parts in files):
                raise ValueError('Archive has multiple theme folders')
            if any(e.is_dir() and (not wrapped or e.filename[:-1]!=wrapper) for e in entries):
                raise ValueError('Unexpected archive directory')
            names={parts[-1] for _,parts in files}
            if not {'theme.json','theme.css'}<=names:
                raise ValueError('Theme ZIP needs theme.json and theme.css')
            allowed={'manifest.json','manifest.sig','theme.json','theme.css','LICENSE.txt'}
            images=[n for n in names if Path(n).suffix.lower() in ('.jpg','.jpeg','.png','.webp')]
            if len(images)!=1 or names-allowed-set(images):
                raise ValueError('Theme ZIP needs exactly one image and no unexpected files')
            actual=0
            for entry,parts in files:
                limit=IMAGE_LIMIT if parts[-1] in images else (1024*1024 if parts[-1]=='theme.json' else 262144 if parts[-1]=='theme.css' else 65536)
                if not 1<=entry.file_size<=limit:
                    raise ValueError('Payload file is empty or exceeds its size limit')
                destination=output/parts[-1]
                outfd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(outfd,'wb') as target, archive.open(entry) as payload:
                    count=0
                    while True:
                        chunk=payload.read(min(256*1024,limit-count+1))
                        if not chunk: break
                        count+=len(chunk)
                        actual+=len(chunk)
                        if count>limit or actual>EXPANDED_LIMIT:
                            raise ValueError('Expanded payload exceeds its limit')
                        target.write(chunk)
                    if count!=entry.file_size:
                        raise ValueError('Payload length conflicts with archive directory')
        final=os.fstat(stream.fileno())
        if (initial.st_size,initial.st_mtime_ns,initial.st_ino)!=(final.st_size,final.st_mtime_ns,final.st_ino):
            raise ValueError('Archive changed during extraction')
    return {'files':len(files),'wrapped':wrapped}

def check_image(filename):
    from PIL import Image, ImageFile
    Image.MAX_IMAGE_PIXELS=50_000_000
    ImageFile.LOAD_TRUNCATED_IMAGES=False
    fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        stat_=os.fstat(stream.fileno())
        if not stat.S_ISREG(stat_.st_mode) or not 1<=stat_.st_size<=IMAGE_LIMIT:
            raise ValueError('Image exceeds 10 MiB')
        with Image.open(stream) as image:
            w,h=image.size
            if image.format not in ('JPEG','PNG','WEBP') or not 1<=w<=16384 or not 1<=h<=16384 or w*h>50_000_000:
                raise ValueError('Unsupported image or unsafe dimensions')
            if getattr(image,'is_animated',False) or getattr(image,'n_frames',1)!=1:
                raise ValueError('Animated images are forbidden')
            image.verify()
        stream.seek(0)
        with Image.open(stream) as image:
            image.load()
    return {'width':w,'height':h,'decoded':True}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source')
    parser.add_argument('--output')
    parser.add_argument('--image')
    args=parser.parse_args()
    if args.image:
        return check_image(args.image)
    if not args.source or not args.output:
        raise ValueError('Extraction needs --source and --output')
    return extract(args.source,args.output)

if __name__=='__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        import sys
        print('Theme validation failed: '+str(error),file=sys.stderr)
        sys.exit(1)
