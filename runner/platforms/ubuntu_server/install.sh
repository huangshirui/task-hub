#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/huangshirui/task-hub.git"
BRANCH="main"
INSTALL_DIR="/opt/task-hub"
ACCOUNT="taskhub"
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
  sudo bash install.sh --base-url URL [options]

Options:
  --base-url URL       Deployed Cloudflare Worker URL.
  --runner-id ID       Optional stable Runner ID. The Worker generates one when omitted.
  --token TOKEN        Runner credential for this runner ID. Defaults to a generated token.
  --registration-token TOKEN
                       Admin token allowed to register runners. Prefer the prompt or TASK_HUB_REGISTRATION_TOKEN.
  --no-register        Skip cloud registration and only install the local runner service.
  --repo-url URL       Git repository URL. Defaults to the upstream task-hub repo.
  --branch NAME        Git branch to install. Defaults to main.
  --install-dir PATH   Install path. Defaults to /opt/task-hub.
  --account NAME       Local Linux account and runner instance name. Defaults to taskhub.
  --service-user USER  Alias for --account.
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
    --account)
      need_value "$@"
      ACCOUNT="$2"
      shift 2
      ;;
    --service-user)
      need_value "$@"
      ACCOUNT="$2"
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
[[ "$NO_REGISTER" -eq 0 || -n "$RUNNER_ID" ]] || die "--runner-id is required with --no-register"
[[ "$ACCOUNT" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || die "--account must be a valid Linux account name"
[[ "$INSTALL_DIR" = /* ]] || die "--install-dir must be an absolute path"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y git python3
else
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
fi

if ! id -u "$ACCOUNT" >/dev/null 2>&1; then
  useradd --system --create-home --user-group --shell /usr/sbin/nologin "$ACCOUNT"
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

CONFIG_DIR="/etc/task-hub/runners/$ACCOUNT"
CONFIG_PATH="$CONFIG_DIR/runner.json"
SCRIPTS_PATH="$CONFIG_DIR/scripts.json"
WORKSPACE_DIR="/var/lib/task-hub/runners/$ACCOUNT/workspaces"
INSTALLED_DIR="/var/lib/task-hub/runners/$ACCOUNT/installed-handlers"
ENV_PATH="/etc/task-hub/runners/$ACCOUNT/runner.env"
SERVICE_PATH="/etc/systemd/system/taskhub-runner@.service"

mkdir -p "$CONFIG_DIR" "$WORKSPACE_DIR" "$INSTALLED_DIR"

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

  RUNNER_ID="$(python3 - "$BASE_URL" "$RUNNER_ID" "$TOKEN" "$REGISTRATION_TOKEN" <<'PY'
import json
import sys
from urllib import error, request

base_url, runner_id, credential, registration_token = sys.argv[1:5]
payload = {
    "credential": credential,
    "platform": "linux",
    "labels": ["ubuntu-server"],
    "taskTypes": ["selfcheck"],
    "capabilities": ["runner.selfcheck"],
}
if runner_id:
    payload["runnerId"] = runner_id
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
        result = json.loads(response.read().decode("utf-8"))
except error.HTTPError as exc:
    details = exc.read().decode("utf-8", errors="replace")
    raise SystemExit(f"runner registration failed: HTTP {exc.code} {details}") from exc
registered_runner_id = result.get("runnerId")
if not isinstance(registered_runner_id, str) or not registered_runner_id:
    raise SystemExit("runner registration response did not include runnerId")
print(registered_runner_id)
PY
)"
fi

[[ -n "$RUNNER_ID" ]] || die "runner ID is required"

python3 - "$CONFIG_PATH" "$BASE_URL" "$RUNNER_ID" "$WORKSPACE_DIR" "$INSTALL_DIR" "$SCRIPTS_PATH" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
base_url = sys.argv[2]
runner_id = sys.argv[3]
workspace_dir = sys.argv[4]
install_dir = Path(sys.argv[5])
scripts_path = sys.argv[6]
config = {
    "baseUrl": base_url,
    "runnerId": runner_id,
    "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
    "workspaceRoot": workspace_dir,
    "pollIntervalSeconds": 5,
    "handlerPaths": [str(install_dir / "runner" / "handlers" / "builtin_selfcheck")],
    "scriptRegistryPath": scripts_path,
}
path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
PY

if [[ ! -f "$SCRIPTS_PATH" ]]; then
  cp "$INSTALL_DIR/runner/config/scripts.example.json" "$SCRIPTS_PATH"
fi

cat >"$ENV_PATH" <<EOF
TASK_HUB_RUNNER_TOKEN=$TOKEN
EOF
chmod 600 "$ENV_PATH"
chown root:root "$ENV_PATH"

chown -R "$ACCOUNT:" "/var/lib/task-hub/runners/$ACCOUNT"

cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=Task Hub Ubuntu Runner (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=%i
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=/etc/task-hub/runners/%i/runner.env
Environment=PYTHONPATH=$INSTALL_DIR/runner
ExecStart=/usr/bin/python3 -m taskhub_runner.cli --config /etc/task-hub/runners/%i/runner.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME@$ACCOUNT"

echo "Task Hub runner installed."
echo "Runner ID: $RUNNER_ID"
echo "Service: $SERVICE_NAME@$ACCOUNT"
echo "Config: $CONFIG_PATH"
echo "Logs: journalctl -u $SERVICE_NAME@$ACCOUNT -f"
