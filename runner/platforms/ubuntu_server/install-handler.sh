#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/task-hub"
SERVICE_NAME="taskhub-runner"
HANDLER=""
REGISTRATION_TOKEN=""
NO_REGISTER=0

usage() {
  cat <<'EOF'
Install a Task Hub runner handler.

Usage:
  sudo /opt/task-hub/runner/platforms/ubuntu_server/install-handler.sh shell [options]

Options:
  --registration-token TOKEN  Admin token allowed to register runners. Prefer the prompt or TASK_HUB_REGISTRATION_TOKEN.
  --no-register              Skip cloud re-registration and only update local runner config.
  --install-dir PATH         Install path. Defaults to /opt/task-hub.
  --service-name NAME        systemd service name. Defaults to taskhub-runner.
  --help                     Show this help.
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
    --registration-token)
      need_value "$@"
      REGISTRATION_TOKEN="$2"
      shift 2
      ;;
    --no-register)
      NO_REGISTER=1
      shift
      ;;
    --install-dir)
      need_value "$@"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --service-name)
      need_value "$@"
      SERVICE_NAME="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      die "unknown option: $1"
      ;;
    *)
      [[ -z "$HANDLER" ]] || die "only one handler can be installed at a time"
      HANDLER="$1"
      shift
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run this installer as root"
[[ -n "$HANDLER" ]] || die "handler name is required"
[[ "$INSTALL_DIR" = /* ]] || die "--install-dir must be an absolute path"

CONFIG_PATH="$INSTALL_DIR/runner/config/runner.json"
ENV_PATH="/etc/task-hub/runner.env"
CATALOG_DIR="$INSTALL_DIR/runner/handlers"
INSTALLED_DIR="$INSTALL_DIR/runner/installed-handlers"

# Calls taskhub_runner.handler_installer.install_handler.
PYTHONPATH="$INSTALL_DIR/runner" python3 -m taskhub_runner.handler_installer install "$HANDLER" \
  --catalog-dir "$CATALOG_DIR" \
  --install-dir "$INSTALLED_DIR" \
  --config "$CONFIG_PATH" \
  --platform linux

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
  [[ -f "$ENV_PATH" ]] || die "runner environment file not found at $ENV_PATH"

  set -a
  # shellcheck disable=SC1090
  . "$ENV_PATH"
  set +a

  PYTHONPATH="$INSTALL_DIR/runner" python3 - "$CONFIG_PATH" "$REGISTRATION_TOKEN" <<'PY'
import json
import os
import sys
from pathlib import Path
from urllib import error, request

from taskhub_runner.handler_installer import describe_config_handlers

config_path = Path(sys.argv[1])
registration_token = sys.argv[2]
config = json.loads(config_path.read_text(encoding="utf-8"))
credential = config.get("credential")
credential_env = config.get("credentialEnv")
if not credential and isinstance(credential_env, str):
    credential = os.environ.get(credential_env)
if not credential:
    raise SystemExit("runner credential is required")

handler_info = describe_config_handlers(config_path)
payload = {
    "runnerId": config["runnerId"],
    "credential": credential,
    "platform": "linux",
    "labels": ["ubuntu-server"],
    "taskTypes": handler_info.task_types,
    "capabilities": handler_info.capabilities,
}
body = json.dumps(payload).encode("utf-8")
req = request.Request(
    f"{config['baseUrl'].rstrip('/')}/runners/register",
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
    raise SystemExit(f"runner re-registration failed: HTTP {exc.code} {details}") from exc
PY
fi

systemctl restart "$SERVICE_NAME"
echo "Handler $HANDLER installed."
