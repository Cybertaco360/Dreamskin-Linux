import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('dreamskin_installer',Path(__file__).resolve().parents[1]/'install.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='dreamskin-install-check-')
        self.base=Path(self.temp.name)
        self.data=self.base/'data'
        self.bin=self.base/'bin'
        self.root=self.data/'dreamskin-linux'
        self.argv=['install.py','--data-home',str(self.data),'--bin-home',str(self.bin),'--node','/usr/bin/node']
    def tearDown(self): self.temp.cleanup()
    def install(self):
        with patch.object(sys,'argv',self.argv),contextlib.redirect_stdout(io.StringIO()): installer.main()
    def test_install_upgrade_preserves_saved_data_and_custom_location(self):
        self.install()
        library=self.root/'themes'
        library.mkdir(mode=0o700)
        (library/'keep.txt').write_text('saved')
        self.install()
        self.assertEqual((library/'keep.txt').read_text(),'saved')
        self.assertIn('DREAMSKIN_DATA_HOME='+str(self.root),(self.bin/'dreamskin').read_text())
        self.assertIn('DREAMSKIN_DATA_HOME='+str(self.root),(self.data/'applications/dreamskin-linux.desktop').read_text())
        self.assertFalse((self.root/'.engine-previous').exists())
    def test_failed_upgrade_restores_old_engine_and_launcher(self):
        self.install()
        marker=self.root/'engine/keep.marker'
        marker.write_text('old engine')
        old=(self.bin/'dreamskin').read_bytes()
        real=installer.atomic_output
        def fail_desktop(filename,content,mode):
            if filename.name.endswith('.desktop'): raise OSError('simulated desktop output failure')
            return real(filename,content,mode)
        with patch.object(installer,'atomic_output',fail_desktop):
            with self.assertRaises(OSError): self.install()
        self.assertEqual(marker.read_text(),'old engine')
        self.assertEqual((self.bin/'dreamskin').read_bytes(),old)
        self.assertFalse((self.root/'.engine-previous').exists())
        self.assertFalse((self.root/'.install-lock').exists())
    def test_foreign_launcher_rejected_before_engine_swap(self):
        self.install()
        marker=self.root/'engine/keep.marker'
        marker.write_text('old')
        (self.bin/'dreamskin').write_text('#!/bin/sh\n# another program\n')
        with self.assertRaisesRegex(RuntimeError,'another program'): self.install()
        self.assertEqual(marker.read_text(),'old')
    def test_parent_symlink_rejected(self):
        destination=self.base/'elsewhere';destination.mkdir()
        self.bin.symlink_to(destination,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'symbolic link'): self.install()
        self.assertEqual(list(destination.iterdir()),[])

if __name__=='__main__': unittest.main()
