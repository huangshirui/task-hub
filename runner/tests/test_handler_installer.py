import json
import tempfile
import unittest
from pathlib import Path

from taskhub_runner.handler_installer import install_handler


class HandlerInstallerTest(unittest.TestCase):
    def test_install_handler_copies_catalog_handler_and_updates_config_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = root / "catalog"
            catalog_handler = catalog / "builtin_shell"
            catalog_handler.mkdir(parents=True)
            catalog_handler.joinpath("handler.json").write_text(
                json.dumps(
                    {
                        "name": "builtin-shell",
                        "version": "1.0.0",
                        "taskTypes": ["shell"],
                        "platforms": ["linux", "windows", "darwin"],
                        "capabilities": ["shell.registered_scripts"],
                        "entrypoint": "taskhub_runner.handlers:ShellHandler",
                        "timeoutMaxSeconds": 3600,
                    }
                ),
                encoding="utf-8",
            )

            install_dir = root / "installed-handlers"
            config_path = root / "runner.json"
            config_path.write_text(
                json.dumps(
                    {
                        "baseUrl": "https://task-hub.example.workers.dev",
                        "runnerId": "runner_ubuntu_01",
                        "credential": "secret",
                        "workspaceRoot": "workspaces",
                        "handlerPaths": ["builtin_selfcheck"],
                    }
                ),
                encoding="utf-8",
            )

            result = install_handler(
                "shell",
                catalog_dir=catalog,
                install_dir=install_dir,
                config_path=config_path,
                platform="linux",
            )
            second = install_handler(
                "shell",
                catalog_dir=catalog,
                install_dir=install_dir,
                config_path=config_path,
                platform="linux",
            )

            config = json.loads(config_path.read_text(encoding="utf-8"))
            installed_path = str((install_dir / "builtin_shell").resolve())
            self.assertEqual(result.task_types, ["shell"])
            self.assertEqual(result.capabilities, ["shell.registered_scripts"])
            self.assertEqual(second.task_types, ["shell"])
            self.assertEqual(config["handlerPaths"].count(installed_path), 1)
            self.assertTrue((install_dir / "builtin_shell" / "handler.json").exists())

    def test_install_handler_rejects_disabled_handler(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = root / "catalog"
            install_dir = root / "installed-handlers"
            config_path = root / "runner.json"
            config_path.write_text('{"handlerPaths": []}', encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "not installable"):
                install_handler(
                    "git",
                    catalog_dir=catalog,
                    install_dir=install_dir,
                    config_path=config_path,
                    platform="linux",
                )

    def test_install_handler_isolated_by_install_dir_and_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = root / "catalog"
            catalog_handler = catalog / "builtin_shell"
            catalog_handler.mkdir(parents=True)
            catalog_handler.joinpath("handler.json").write_text(
                json.dumps(
                    {
                        "name": "builtin-shell",
                        "version": "1.0.0",
                        "taskTypes": ["shell"],
                        "platforms": ["linux", "windows", "darwin"],
                        "capabilities": ["shell.registered_scripts"],
                        "entrypoint": "taskhub_runner.handlers:ShellHandler",
                        "timeoutMaxSeconds": 3600,
                    }
                ),
                encoding="utf-8",
            )
            alice_config = root / "alice.json"
            bob_config = root / "bob.json"
            alice_config.write_text('{"handlerPaths": []}', encoding="utf-8")
            bob_config.write_text('{"handlerPaths": []}', encoding="utf-8")

            install_handler(
                "shell",
                catalog_dir=catalog,
                install_dir=root / "alice" / "installed-handlers",
                config_path=alice_config,
                platform="linux",
            )

            alice = json.loads(alice_config.read_text(encoding="utf-8"))
            bob = json.loads(bob_config.read_text(encoding="utf-8"))
            self.assertIn(str((root / "alice" / "installed-handlers" / "builtin_shell").resolve()), alice["handlerPaths"])
            self.assertEqual(bob["handlerPaths"], [])


if __name__ == "__main__":
    unittest.main()
