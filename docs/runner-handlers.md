# Runner Handlers

Runner handlers are local plugins. The cloud service does not download or install executable handler code.

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
