from __future__ import annotations

import sys
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


class WorkspaceTemporaryDirectory:
    def __init__(self):
        self.name = ""

    def __enter__(self):
        base = ROOT.parent / ".tmp" / "runner-tests"
        base.mkdir(parents=True, exist_ok=True)
        self.name = str(base / f"tmp-{uuid.uuid4().hex}")
        Path(self.name).mkdir()
        return self.name

    def __exit__(self, exc_type, exc, traceback):
        if self.name:
            shutil.rmtree(self.name, ignore_errors=True)


tempfile.TemporaryDirectory = WorkspaceTemporaryDirectory

suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
