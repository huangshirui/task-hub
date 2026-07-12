# Runner Handlers

Runner handlers are local plugins. The cloud service does not download or install executable handler code.

Ubuntu one-line installs enable only the built-in `selfcheck` handler by default. Other handlers are installed on demand from the trusted handler catalog in this repository.

## Runner Config

Each runner instance has its own `runner.json`. For example:

- Ubuntu one-line install: `/etc/task-hub/runners/<account>/runner.json`
- Windows per-user setup: `%LOCALAPPDATA%\TaskHubRunner\runner.json`
- local development: `runner/config/runner.json`

The config defines:

- `baseUrl`: Cloudflare Worker URL
- `runnerId`: registered Runner ID
- `credentialEnv`: environment variable containing the Runner credential
- `workspaceRoot`: per-task workspace parent directory
- `fallbackPollIntervalSeconds`: fallback claim interval when no wake notification arrives; defaults to 600 seconds
- `fallbackJitterRatio`: randomizes fallback claims by the configured ratio; defaults to 0.1
- `heartbeatIntervalSeconds`: lease-renewal interval while a task is running; defaults to 20 seconds
- `handlerPaths`: directories containing `handler.json`
- `scriptRegistryPath`: JSON file containing registered shell scripts

## Handler Manifest

Every handler directory must include `handler.json`:

```json
{
  "name": "builtin-shell",
  "version": "1.0.0",
  "taskTypes": ["shell"],
  "platforms": ["linux", "windows", "darwin"],
  "capabilities": ["shell.registered_scripts"],
  "entrypoint": "taskhub_runner.handlers:ShellHandler",
  "timeoutMaxSeconds": 3600
}
```

The Runner scans `handlerPaths`, loads each manifest, imports the `entrypoint`, and registers the handler for every declared task type.

## Selfcheck Handler

`selfcheck` is the default handler on Ubuntu server installs. It has no external dependencies and does not execute user-provided scripts.

It returns runner metadata including:

- runner ID
- runner version
- OS/platform
- Python version
- current user
- current working directory
- task workspace path
- enabled handler task types

Use it to verify that a new runner is online before installing task-specific handlers.

## Handler Catalog and Installation

Committed handler catalog entries live under `runner/handlers/<handler-name>`.

Ubuntu handler installs copy catalog entries into the target account's private managed directory:

```text
/var/lib/task-hub/runners/<account>/installed-handlers/<handler-name>
```

Then the installer adds that managed directory to `/etc/task-hub/runners/<account>/runner.json` `handlerPaths`, re-registers that runner account's task types and capabilities with the Worker, and restarts `taskhub-runner@<account>.service`.

Install the registered-script shell handler:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh --account taskhub shell
sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh --account alice shell
```

Windows handler installs run as the current Windows user and copy catalog entries into:

```text
%LOCALAPPDATA%\TaskHubRunner\installed-handlers\<handler-name>
```

Install the registered-script shell handler for the current Windows user:

```powershell
taskhub-windows-runner.exe install-handler shell
```

Only implemented handlers are installable. v1 allows `shell`; `python` and `git` remain disabled until their Python handler classes exist.

Handler installation does not execute arbitrary GitHub code at task runtime. It copies a trusted repository directory containing `handler.json` and the Python entrypoint referenced by that manifest into a fixed local directory.

## Shell Scripts

Shell tasks do not execute arbitrary command strings. They reference a registered `scriptId` in `runner/config/scripts.json`:

```json
{
  "hello": {
    "command": ["python", "-c", "print('hello from task-hub runner')"]
  }
}
```

Task payload:

```json
{
  "scriptId": "hello"
}
```

Unregistered `scriptId` values are rejected by the Runner.
