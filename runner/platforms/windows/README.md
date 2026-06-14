# Windows Runner MVP

The Windows runner host is a system tray app that starts the shared Python runner core in a background thread.

## Run from source

```powershell
copy runner\platforms\windows\config\runner.example.json runner\platforms\windows\config\runner.json
copy runner\platforms\windows\config\scripts.example.json runner\platforms\windows\config\scripts.json
set TASK_HUB_RUNNER_TOKEN=replace-with-runner-secret
python -m pip install -r runner\platforms\windows\requirements.txt
set PYTHONPATH=runner
python -m taskhub_runner.platforms.windows.tray --config runner\platforms\windows\config\runner.json
```

The tray menu exposes status, start, stop, open logs, and exit.

## Build exe

```powershell
python -m pip install -r runner\platforms\windows\requirements.txt
cd runner\platforms\windows\packaging
pyinstaller taskhub-windows-runner.spec
```

The generated executable is named `taskhub-windows-runner.exe`.
