#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/huangshirui/task-hub.git"
BRANCH="main"
INSTALL_DIR="/opt/task-hub"
SERVICE_USER="taskhub"
SERVICE_NAME="taskhub-runner"
BASE_URL=""
RUNNER_ID=""
TOKEN=""
REGISTRATION_TOKEN=""
NO_REGISTER=0

usage() {
  cat <<'EOF'
Install the Task Hub Ubuntu runner.

Usage:
  sudo bash install.sh --base-url URL --runner-id ID [options]

Options:
  --base-url URL       Deployed Cloudflare Worker URL.
  --runner-id ID       Runner ID registered with the Worker.
  --token TOKEN        Runner credential for this runner ID. Defaults to a generated token.
  --registration-token TOKEN
                       Admin token allowed to register runners. Prefer the prompt or TASK_HUB_REGISTRATION_TOKEN.
  --no-register        Skip cloud registration and only install the local runner service.
  --repo-url URL       Git repository URL. Defaults to the upstream task-hub repo.
  --branch NAME        Git branch to install. Defaults to main.
  --install-dir PATH   Install path. Defaults to /opt/task-hub.
  --service-user USER  System user for the service. Defaults to taskhub.
  --help              Show this help.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

need_value() {
  [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      need_value "$@"
      BASE_URL="$2"
      shift 2
      ;;
    --runner-id)
      need_value "$@"
      RUNNER_ID="$2"
      shift 2
      ;;
    --token)
      need_value "$@"
      TOKEN="$2"
      shift 2
      ;;
    --registration-token)
      need_value "$@"
      REGISTRATION_TOKEN="$2"
      shift 2
      ;;
    --no-register)
      NO_REGISTER=1
      shift
      ;;
    --repo-url)
      need_value "$@"
      REPO_URL="$2"
      shift 2
      ;;
    --branch)
      need_value "$@"
      BRANCH="$2"
      shift 2
      ;;
    --install-dir)
      need_value "$@"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --service-user)
      need_value "$@"
      SERVICE_USER="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run this installer as root, for example: curl -fsSL URL | sudo bash -s -- ..."
[[ -n "$BASE_URL" ]] || die "--base-url is required"
[[ -n "$RUNNER_ID" ]] || die "--runner-id is required"
[[ "$INSTALL_DIR" = /* ]] || die "--install-dir must be an absolute path"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y git python3
else
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [[ -e "$INSTALL_DIR" ]]; then
  die "$INSTALL_DIR exists but is not a git checkout"
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

CONFIG_DIR="$INSTALL_DIR/runner/config"
CONFIG_PATH="$CONFIG_DIR/runner.json"
SCRIPTS_PATH="$CONFIG_DIR/scripts.json"
WORKSPACE_DIR="$INSTALL_DIR/runner-workspaces"
ENV_DIR="/etc/task-hub"
ENV_PATH="$ENV_DIR/runner.env"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME.service"

mkdir -p "$CONFIG_DIR" "$WORKSPACE_DIR" "$ENV_DIR"

if [[ -z "$TOKEN" && -n "${TASK_HUB_RUNNER_TOKEN:-}" ]]; then
  TOKEN="$TASK_HUB_RUNNER_TOKEN"
fi

if [[ "$NO_REGISTER" -eq 1 && -z "$TOKEN" ]]; then
  [[ -r /dev/tty ]] || die "runner token is required with --no-register; set TASK_HUB_RUNNER_TOKEN or pass --token"
  printf "Runner token for %s: " "$RUNNER_ID" >/dev/tty
  IFS= read -r -s TOKEN </dev/tty
  printf "\n" >/dev/tty
fi

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(python3 - <<'PY'
import secrets

print(secrets.token_urlsafe(48))
PY
)"
fi

[[ -n "$TOKEN" ]] || die "runner token is required"
[[ "$TOKEN" != *$'\n'* ]] || die "--token must not contain newlines"

if [[ "$NO_REGISTER" -eq 0 ]]; then
  if [[ -z "$REGISTRATION_TOKEN" && -n "${TASK_HUB_REGISTRATION_TOKEN:-}" ]]; then
    REGISTRATION_TOKEN="$TASK_HUB_REGISTRATION_TOKEN"
  fi

  if [[ -z "$REGISTRATION_TOKEN" ]]; then
    [[ -r /dev/tty ]] || die "registration token is required; set TASK_HUB_REGISTRATION_TOKEN or pass --registration-token"
    printf "Runner registration token: " >/dev/tty
    IFS= read -r -s REGISTRATION_TOKEN </dev/tty
    printf "\n" >/dev/tty
  fi

  [[ -n "$REGISTRATION_TOKEN" ]] || die "registration token is required"
  [[ "$REGISTRATION_TOKEN" != *$'\n'* ]] || die "--registration-token must not contain newlines"

  python3 - "$BASE_URL" "$RUNNER_ID" "$TOKEN" "$REGISTRATION_TOKEN" <<'PY'
import json
import sys
from urllib import error, request

base_url, runner_id, credential, registration_token = sys.argv[1:5]
payload = {
    "runnerId": runner_id,
    "credential": credential,
    "platform": "linux",
    "labels": ["ubuntu-server"],
    "taskTypes": ["selfcheck"],
    "capabilities": ["runner.selfcheck"],
}
body = json.dumps(payload).encode("utf-8")
req = request.Request(
    f"{base_url.rstrip('/')}/runners/register",
    data=body,
    method="POST",
    headers={
        "authorization": f"Bearer {registration_token}",
        "content-type": "application/json",
    },
)
try:
    with request.urlopen(req, timeout=30) as response:
        response.read()
except error.HTTPError as exc:
    details = exc.read().decode("utf-8", errors="replace")
    raise SystemExit(f"runner registration failed: HTTP {exc.code} {details}") from exc
PY
fi

python3 - "$CONFIG_PATH" "$BASE_URL" "$RUNNER_ID" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
base_url = sys.argv[2]
runner_id = sys.argv[3]
config = {
    "baseUrl": base_url,
    "runnerId": runner_id,
    "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
    "workspaceRoot": "../../runner-workspaces",
    "pollIntervalSeconds": 5,
    "handlerPaths": ["../handlers/builtin_selfcheck"],
    "scriptRegistryPath": "scripts.json",
}
path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
PY

if [[ ! -f "$SCRIPTS_PATH" ]]; then
  cp "$CONFIG_DIR/scripts.example.json" "$SCRIPTS_PATH"
fi

cat >"$ENV_PATH" <<EOF
TASK_HUB_RUNNER_TOKEN=$TOKEN
EOF
chmod 600 "$ENV_PATH"
chown root:root "$ENV_PATH"

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=Task Hub Ubuntu Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_PATH
Environment=PYTHONPATH=$INSTALL_DIR/runner
ExecStart=/usr/bin/python3 -m taskhub_runner.cli --config $CONFIG_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "Task Hub runner installed."
echo "Service: $SERVICE_NAME"
echo "Config: $CONFIG_PATH"
echo "Logs: journalctl -u $SERVICE_NAME -f"
