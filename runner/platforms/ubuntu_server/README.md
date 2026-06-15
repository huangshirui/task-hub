# Ubuntu Server Runner

The Ubuntu server runner is a headless host for the shared Python runner core. It is intended to run as a `systemd` service and write process logs to journald/stdout. No GUI behavior belongs in this platform directory.

## One-line install

Install the runner as a `systemd` service:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo bash -s -- \
  --base-url https://your-worker.workers.dev \
  --runner-id runner_ubuntu_01
```

The installer prompts for the runner token and writes it to `/etc/task-hub/runner.env`.

The installer:

- installs `git` and `python3`
- creates the `taskhub` system user
- clones or updates the repo at `/opt/task-hub`
- writes `runner/config/runner.json`
- stores the runner credential in `/etc/task-hub/runner.env`
- creates and starts `taskhub-runner.service`

For an auditable install, download the script first:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh -o install.sh
less install.sh
sudo bash install.sh \
  --base-url https://your-worker.workers.dev \
  --runner-id runner_ubuntu_01
```

The credential must match the credential used when registering this `runnerId` with the Worker.

For non-interactive automation, pass the token through the command environment:

```bash
curl -fsSL https://raw.githubusercontent.com/huangshirui/task-hub/main/runner/platforms/ubuntu_server/install.sh | sudo TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret' bash -s -- \
  --base-url https://your-worker.workers.dev \
  --runner-id runner_ubuntu_01
```

View logs after installation:

```bash
journalctl -u taskhub-runner -f
```

## Install from source

Use a fixed install path so the service file can reference stable absolute paths:

```bash
sudo apt-get update
sudo apt-get install -y git python3

sudo useradd --system --create-home --shell /usr/sbin/nologin taskhub
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

## Install systemd service

Store the runner credential outside the repository:

```bash
sudo mkdir -p /etc/task-hub
sudo tee /etc/task-hub/runner.env >/dev/null <<'EOF'
TASK_HUB_RUNNER_TOKEN=replace-with-runner-secret
EOF
sudo chmod 600 /etc/task-hub/runner.env
sudo chown root:root /etc/task-hub/runner.env
```

Allow the service account to read the app and write runner workspaces:

```bash
sudo mkdir -p /opt/task-hub/runner-workspaces
sudo chown -R taskhub:taskhub /opt/task-hub
```

Create `/etc/systemd/system/taskhub-runner.service`:

```ini
[Unit]
Description=Task Hub Ubuntu Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=taskhub
Group=taskhub
WorkingDirectory=/opt/task-hub
EnvironmentFile=/etc/task-hub/runner.env
Environment=PYTHONPATH=/opt/task-hub/runner
ExecStart=/usr/bin/python3 -m taskhub_runner.cli --config /opt/task-hub/runner/config/runner.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now taskhub-runner
sudo systemctl status taskhub-runner
```

View logs:

```bash
journalctl -u taskhub-runner -f
```

Stop or restart:

```bash
sudo systemctl stop taskhub-runner
sudo systemctl restart taskhub-runner
```
