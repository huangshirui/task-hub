# Ubuntu Server Runner

The Ubuntu server runner is a headless host for the shared Python runner core. It is intended to run as a `systemd` service and write process logs to journald/stdout. No GUI behavior belongs in this platform directory.

## One-line install

Install the runner as a `systemd` service:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo bash -s -- \
  --base-url https://your-worker.workers.dev \
  --account taskhub
```

The installer prompts for `TASK_HUB_REGISTRATION_TOKEN`, registers the runner with the Worker, receives a generated Runner ID, generates a runner credential, and writes both values to the account-scoped configuration. The default install only enables the `selfcheck` handler.

Pass `--runner-id runner_ubuntu_01` when a stable operator-selected ID is preferred. Without it, the Worker generates an ID such as `runner_7db26f65-...` and the installer writes that value to `runner.json`.

When the account already has `runner.json`, rerunning the installer without `--runner-id` reuses that existing ID. Pass a different explicit `--runner-id` only when intentionally replacing the runner identity.

The installer:

- installs `git`, `python3`, and `python3-websocket`
- creates the local account system user
- clones or updates the repo at `/opt/task-hub`
- registers the runner with the Worker for `selfcheck`
- writes `/etc/task-hub/runners/<account>/runner.json`
- stores the runner credential in `/etc/task-hub/runners/<account>/runner.env`
- creates and starts `taskhub-runner@<account>.service`

The service keeps one outbound `wss://` connection to receive task notifications. It claims immediately after a notification and also claims every 9-11 minutes as a recovery path. While executing a task, it sends an HTTPS lease heartbeat every 20 seconds.

Install another account on the same server by changing `--account`; optionally supply a stable `--runner-id`:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo bash -s -- \
  --base-url https://your-worker.workers.dev \
  --account alice \
  --runner-id runner_alice
```

For an auditable install, download the script first:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh -o install.sh
less install.sh
sudo bash install.sh \
  --base-url https://your-worker.workers.dev \
  --account taskhub
```

The registration token must match the Worker secret `RUNNER_REGISTRATION_TOKEN`.

For non-interactive automation, pass the registration token through the command environment:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo TASK_HUB_REGISTRATION_TOKEN='replace-with-registration-secret' bash -s -- \
  --base-url https://your-worker.workers.dev \
  --account taskhub
```

To skip cloud registration and use a pre-registered runner credential:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret' bash -s -- \
  --base-url https://your-worker.workers.dev \
  --account taskhub \
  --runner-id runner_ubuntu_01 \
  --no-register
```

View logs after installation:

```bash
journalctl -u taskhub-runner@taskhub -f
```

## Update all runners on a server

All account instances share the code in `/opt/task-hub`, so update that checkout once with the dedicated updater. Do not rerun `install.sh` to upgrade: the installer performs registration and rewrites account configuration.

Use an immutable release tag for normal production upgrades:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/update.sh --version v0.2.0
```

Preview discovery and compatibility checks without stopping services or changing files:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/update.sh --version v0.2.0 --dry-run
```

An audited tag or commit SHA can be selected explicitly, and non-default installations can supply their shared checkout:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/update.sh \
  --ref 0123456789abcdef \
  --install-dir /srv/task-hub
```

The updater discovers every `/etc/task-hub/runners/<account>/runner.json`, backs up account configuration and repository-managed installed handlers, stops the instances, installs Ubuntu dependencies, switches the shared checkout, refreshes only handlers under each account's `installed-handlers` directory, validates each configuration with its own `runner.env`, and restores the previously enabled services. Built-in handlers under `/opt/task-hub/runner/handlers` update with the shared checkout. Handler paths outside both the account's managed directory and the shared built-in catalog are treated as custom and are never changed.

If dependency installation, handler validation, or service health checks fail, the updater restores the previous Git SHA and managed handlers and restarts the previously enabled services. It does not register runners, change Runner IDs, rewrite credentials, or print credential values.

## Install handlers

The default runner only accepts `selfcheck` tasks. Install additional handlers on demand:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh --account taskhub shell
```

The handler installer copies the trusted catalog handler from `/opt/task-hub/runner/handlers` into `/var/lib/task-hub/runners/<account>/installed-handlers`, updates `/etc/task-hub/runners/<account>/runner.json`, re-registers the runner with the Worker, and restarts `taskhub-runner@<account>`.

For automation:

```bash
sudo TASK_HUB_REGISTRATION_TOKEN='replace-with-registration-secret' \
  /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh --account taskhub shell
```

To only update local config without cloud re-registration:

```bash
sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh --account taskhub shell --no-register
```

## Install from source

Use a fixed install path so the service file can reference stable absolute paths:

```bash
sudo apt-get update
sudo apt-get install -y git python3 python3-websocket

sudo useradd --system --create-home --user-group --shell /usr/sbin/nologin taskhub
sudo mkdir -p /opt/task-hub
sudo chown "$USER":"$USER" /opt/task-hub
git clone https://github.com/huangshirui/task-hub.git /opt/task-hub
cd /opt/task-hub
```

Create local runner config files:

```bash
cp runner/config/runner.example.json runner/config/runner.json
cp runner/config/scripts.example.json runner/config/scripts.json
```

Edit `runner/config/runner.json` before starting the runner:

- `baseUrl`: deployed Cloudflare Worker URL
- `runnerId`: Ubuntu runner ID registered with the Worker
- `credentialEnv`: keep as `TASK_HUB_RUNNER_TOKEN`
- `handlerPaths`: local handler plugin directories
- `scriptRegistryPath`: local registered script config

The credential must match the credential used when registering this `runnerId` with the Worker.

## Run from source

Run one poll and exit:

```bash
cd /opt/task-hub
export TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret'
export PYTHONPATH=/opt/task-hub/runner
python3 -m taskhub_runner.cli --config runner/config/runner.json --once
```

Run continuously in the foreground:

```bash
cd /opt/task-hub
export TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret'
export PYTHONPATH=/opt/task-hub/runner
python3 -m taskhub_runner.cli --config runner/config/runner.json
```

## Install systemd template service

Store each runner credential outside the repository:

```bash
sudo mkdir -p /etc/task-hub/runners/alice
sudo tee /etc/task-hub/runners/alice/runner.env >/dev/null <<'EOF'
TASK_HUB_RUNNER_TOKEN=replace-with-runner-secret
EOF
sudo chmod 600 /etc/task-hub/runners/alice/runner.env
sudo chown root:root /etc/task-hub/runners/alice/runner.env
```

Allow the account to write its own runner state:

```bash
sudo mkdir -p /var/lib/task-hub/runners/alice/workspaces
sudo mkdir -p /var/lib/task-hub/runners/alice/installed-handlers
sudo chown -R alice: /var/lib/task-hub/runners/alice
```

Create `/etc/systemd/system/taskhub-runner@.service`:

```ini
[Unit]
Description=Task Hub Ubuntu Runner (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=/opt/task-hub
EnvironmentFile=/etc/task-hub/runners/%i/runner.env
Environment=PYTHONPATH=/opt/task-hub/runner
ExecStart=/usr/bin/python3 -m taskhub_runner.cli --config /etc/task-hub/runners/%i/runner.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taskhub-runner@alice
sudo systemctl status taskhub-runner@alice
```

View logs:

```bash
journalctl -u taskhub-runner@alice -f
```

Stop or restart:

```bash
sudo systemctl stop taskhub-runner@alice
sudo systemctl restart taskhub-runner@alice
```
