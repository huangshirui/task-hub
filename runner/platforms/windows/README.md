# Windows Runner MVP

The Windows runner host is a per-user system tray app. Each Windows login account runs its own runner process, config, credential, workspaces, installed handlers, and logs.

## Per-user setup

Install dependencies for source runs:

```powershell
python -m pip install -r runner\platforms\windows\requirements.txt
```

Set up the current Windows user:

```powershell
set PYTHONPATH=runner
set TASK_HUB_RUNNER_TOKEN=replace-with-runner-secret
set TASK_HUB_REGISTRATION_TOKEN=replace-with-registration-secret
python -m taskhub_runner.platforms.windows.tray setup --base-url https://your-worker.workers.dev --name "Alice workstation"
```

The Worker generates the Runner ID and the setup command stores it in `runner.json`. Add `--runner-id runner_windows_alice` when a stable operator-selected ID is required. `--runner-id` remains mandatory with `--no-register` because no Worker response is available in that mode.

The setup command writes:

- `%LOCALAPPDATA%\TaskHubRunner\runner.json`
- `%LOCALAPPDATA%\TaskHubRunner\runner.env`
- `%LOCALAPPDATA%\TaskHubRunner\workspaces`
- `%LOCALAPPDATA%\TaskHubRunner\installed-handlers`
- `%LOCALAPPDATA%\TaskHubRunner\logs`

It registers the runner with only the `selfcheck` handler enabled.

## Run tray

Run with the current user's default config:

```powershell
set PYTHONPATH=runner
set TASK_HUB_RUNNER_TOKEN=replace-with-runner-secret
python -m taskhub_runner.platforms.windows.tray
```

The tray menu exposes status, start, stop, open logs, and exit.

You can still override the config path:

```powershell
python -m taskhub_runner.platforms.windows.tray --config C:\path\to\runner.json
```

## Install handlers

Install the shell handler for the current Windows user:

```powershell
set PYTHONPATH=runner
set TASK_HUB_REGISTRATION_TOKEN=replace-with-registration-secret
python -m taskhub_runner.platforms.windows.tray install-handler shell
```

The handler installer copies the trusted catalog handler into `%LOCALAPPDATA%\TaskHubRunner\installed-handlers`, updates the current user's `runner.json`, and re-registers the runner capabilities with the Worker.

## Build exe

```powershell
python -m pip install -r runner\platforms\windows\requirements.txt
cd runner\platforms\windows\packaging
pyinstaller taskhub-windows-runner.spec
```

The generated executable is named `taskhub-windows-runner.exe`.
