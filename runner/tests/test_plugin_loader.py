import json
import tempfile
import unittest
from pathlib import Path

from taskhub_runner.handlers import HandlerContext
from taskhub_runner.plugin_loader import load_handlers


class PluginLoaderTest(unittest.TestCase):
    def test_load_handlers_scans_manifest_and_wires_shell_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_dir = root / "builtin_shell"
            plugin_dir.mkdir()
            plugin_dir.joinpath("handler.json").write_text(
                json.dumps(
                    {
                        "name": "builtin-shell",
                        "version": "1.0.0",
                        "taskTypes": ["shell"],
                        "platforms": ["linux", "windows"],
                        "capabilities": ["shell.registered_scripts"],
                        "entrypoint": "taskhub_runner.handlers:ShellHandler",
                        "timeoutMaxSeconds": 60,
                    }
                ),
                encoding="utf-8",
            )
            scripts_path = root / "scripts.json"
            marker = root / "marker.txt"
            scripts_path.write_text(
                json.dumps(
                    {
                        "write-marker": {
                            "command": [
                                "python",
                                "-c",
                                f"from pathlib import Path; Path({str(marker)!r}).write_text('ok')",
                            ]
                        }
                    }
                ),
                encoding="utf-8",
            )

            handlers = load_handlers([plugin_dir], scripts_path)
            result = handlers["shell"].run(
                {"scriptId": "write-marker"},
                HandlerContext(task_id="task_1", workspace=root / "workspace", timeout_seconds=10),
            )

            self.assertEqual(result.status, "succeeded")
            self.assertEqual(marker.read_text(), "ok")

    def test_load_handlers_rejects_invalid_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            plugin_dir = Path(tmp) / "broken"
            plugin_dir.mkdir()
            plugin_dir.joinpath("handler.json").write_text("{}", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "invalid handler manifest"):
                load_handlers([plugin_dir], None)
