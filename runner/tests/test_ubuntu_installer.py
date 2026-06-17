import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "runner" / "platforms" / "ubuntu_server" / "install.sh"
HANDLER_INSTALLER = ROOT / "runner" / "platforms" / "ubuntu_server" / "install-handler.sh"
README = ROOT / "runner" / "platforms" / "ubuntu_server" / "README.md"


class UbuntuInstallerTest(unittest.TestCase):
    def test_installer_registers_runner_with_registration_token(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", content)
        self.assertIn("/runners/register", content)
        self.assertIn('"platform": "linux"', content)
        self.assertIn('"labels": ["ubuntu-server"]', content)
        self.assertIn('"taskTypes": ["selfcheck"]', content)
        self.assertIn('"capabilities": ["runner.selfcheck"]', content)
        self.assertIn('../handlers/builtin_selfcheck', content)

    def test_installer_supports_manual_registration_fallback(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertIn("--no-register", content)
        self.assertIn("NO_REGISTER", content)

    def test_readme_documents_registration_token_not_runner_token_for_one_line_install(self):
        content = README.read_text(encoding="utf-8")
        one_line_section = content.split("## Install from source", 1)[0]
        default_install_section = one_line_section.split("To skip cloud registration", 1)[0]

        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", one_line_section)
        self.assertNotIn("TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret'", default_install_section)

    def test_ubuntu_handler_installer_installs_shell_handler(self):
        content = HANDLER_INSTALLER.read_text(encoding="utf-8")

        self.assertIn("install_handler", content)
        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", content)
        self.assertIn("/runners/register", content)
        self.assertIn("systemctl restart", content)
        self.assertIn("--no-register", content)


if __name__ == "__main__":
    unittest.main()
