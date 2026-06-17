# Runner Handlers

Runner handlers are local plugins. The cloud service does not download or install executable handler code.

Ubuntu one-line installs enable only the built-in `selfcheck` handler by default. Other handlers are installed on demand from the trusted handler catalog in this repository.

## Runner Config

`runner/config/runner.json` defines:

- `baseUrl`: Cloudflare Worker URL
- `runnerId`: registered Runner ID
- `credentialEnv`: environment variable containing the Runner credential
- `workspaceRoot`: per-task workspace parent directory
- `pollIntervalSeconds`: idle polling interval
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

Ubuntu handler installs copy catalog entries into:

```text
/opt/task-hub/runner/installed-handlers/<handler-name>
```

Then the installer adds that managed directory to `runner/config/runner.json` `handlerPaths`, re-registers the runner task types and capabilities with the Worker, and restarts the systemd service.

Install the registered-script shell handler:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh shell
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
