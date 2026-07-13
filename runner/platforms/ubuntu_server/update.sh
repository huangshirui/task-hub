#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/task-hub"
VERSION=""
TARGET_REF=""
DRY_RUN=0
CONFIG_ROOT="${TASK_HUB_CONFIG_ROOT:-/etc/task-hub/runners}"
DATA_ROOT="${TASK_HUB_DATA_ROOT:-/var/lib/task-hub/runners}"
SERVICE_NAME="taskhub-runner"
ID_BIN="${TASK_HUB_ID_BIN:-id}"
SYSTEMCTL_BIN="${TASK_HUB_SYSTEMCTL_BIN:-systemctl}"
APT_GET_BIN="${TASK_HUB_APT_GET_BIN:-apt-get}"
CHOWN_BIN="${TASK_HUB_CHOWN_BIN:-chown}"
OLD_SHA=""
TARGET_SHA=""
OLD_VERSION=""
TARGET_VERSION=""
BACKUP_DIR=""
TMP_ROOT="${TASK_HUB_TMPDIR:-${TMPDIR:-/tmp}}"
MUTATED=0
ROLLING_BACK=0
declare -a ACCOUNTS=()
declare -a ENABLED_ACCOUNTS=()
declare -a MANAGED_PATHS=()
declare -a SHARED_PATHS=()
declare -a CUSTOM_PATHS=()

usage() {
  cat <<'EOF'
Safely update all Task Hub Ubuntu runner instances on this server.

Usage:
  sudo update.sh (--version TAG | --ref TAG_OR_COMMIT) [options]

Options:
  --version TAG       Upgrade to an immutable Git tag, for example v0.2.0.
  --ref REF           Upgrade to a Git tag or commit SHA.
  --install-dir PATH  Shared Task Hub Git checkout. Defaults to /opt/task-hub.
  --dry-run           Validate and report without changing files or services.
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

native_path() {
  local path="$1"
  if command -v cygpath >/dev/null 2>&1 && [[ "$path" =~ ^[A-Za-z]:\\ ]]; then
    cygpath -u "$path"
  else
    printf '%s\n' "$path"
  fi
}

runner_version_for_sha() {
  local sha="$1"
  git -C "$INSTALL_DIR" show "$sha:runner/taskhub_runner/version.py" 2>/dev/null | python3 -c '
import ast, sys
tree = ast.parse(sys.stdin.read())
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets):
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            print(node.value.value)
            raise SystemExit(0)
raise SystemExit("runner version is missing")
'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) need_value "$@"; VERSION="$2"; shift 2 ;;
    --ref) need_value "$@"; TARGET_REF="$2"; shift 2 ;;
    --install-dir) need_value "$@"; INSTALL_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[[ -n "$VERSION" && -z "$TARGET_REF" || -z "$VERSION" && -n "$TARGET_REF" ]] \
  || die "exactly one of --version or --ref is required"

INSTALL_DIR="$(native_path "$INSTALL_DIR")"
CONFIG_ROOT="$(native_path "$CONFIG_ROOT")"
DATA_ROOT="$(native_path "$DATA_ROOT")"
ID_BIN="$(native_path "$ID_BIN")"
SYSTEMCTL_BIN="$(native_path "$SYSTEMCTL_BIN")"
APT_GET_BIN="$(native_path "$APT_GET_BIN")"
CHOWN_BIN="$(native_path "$CHOWN_BIN")"
TMP_ROOT="$(native_path "$TMP_ROOT")"
[[ "$("$ID_BIN" -u)" -eq 0 ]] || die "run this updater as root"
[[ "$INSTALL_DIR" = /* ]] || die "--install-dir must be an absolute path"
[[ -d "$INSTALL_DIR/.git" ]] || die "$INSTALL_DIR is not a Git checkout"
[[ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ]] || die "$INSTALL_DIR has uncommitted changes"

OLD_SHA="$(git -C "$INSTALL_DIR" rev-parse --verify HEAD)"
if [[ "$DRY_RUN" -eq 0 ]]; then
  git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1 || die "$INSTALL_DIR does not have an origin remote"
  git -C "$INSTALL_DIR" fetch --tags origin
fi
if [[ -n "$VERSION" ]]; then
  TARGET_REF="refs/tags/$VERSION"
  git -C "$INSTALL_DIR" show-ref --verify --quiet "$TARGET_REF" || die "version tag not found: $VERSION"
else
  if git -C "$INSTALL_DIR" show-ref --verify --quiet "refs/tags/$TARGET_REF"; then
    TARGET_REF="refs/tags/$TARGET_REF"
  elif [[ ! "$TARGET_REF" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
    die "--ref must name an existing tag or commit SHA"
  fi
fi
TARGET_SHA="$(git -C "$INSTALL_DIR" rev-parse --verify "$TARGET_REF^{commit}" 2>/dev/null)" \
  || die "target ref does not resolve to a commit: $TARGET_REF"
OLD_VERSION="$(runner_version_for_sha "$OLD_SHA")" || die "cannot read Runner version from $OLD_SHA"
TARGET_VERSION="$(runner_version_for_sha "$TARGET_SHA")" || die "cannot read Runner version from $TARGET_SHA"

[[ -d "$CONFIG_ROOT" ]] || die "runner config root not found: $CONFIG_ROOT"
while IFS= read -r config_path; do
  ACCOUNTS+=("$(basename "$(dirname "$config_path")")")
done < <(find "$CONFIG_ROOT" -mindepth 2 -maxdepth 2 -type f -name runner.json -print | sort)
[[ ${#ACCOUNTS[@]} -gt 0 ]] || die "no runner accounts found under $CONFIG_ROOT"

discover_handlers() {
  local account="$1"
  local config="$CONFIG_ROOT/$account/runner.json"
  while IFS=$'\t' read -r kind path; do
    path="$(native_path "$path")"
    case "$kind" in
      managed) MANAGED_PATHS+=("$account|$path") ;;
      shared) SHARED_PATHS+=("$account|$path") ;;
      custom) CUSTOM_PATHS+=("$account|$path") ;;
    esac
  done < <(python3 - "$config" "$DATA_ROOT/$account/installed-handlers" "$INSTALL_DIR/runner/handlers" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
installed_root = Path(sys.argv[2]).resolve()
shared_root = Path(sys.argv[3]).resolve()
raw = json.loads(config_path.read_text(encoding="utf-8"))
paths = raw.get("handlerPaths", [])
if not isinstance(paths, list):
    raise SystemExit("handlerPaths must be a list")
for value in paths:
    if not isinstance(value, str) or not value:
        raise SystemExit("handlerPaths entries must be non-empty strings")
    path = Path(value)
    if not path.is_absolute():
        path = config_path.parent / path
    path = path.resolve()
    try:
        relative = path.relative_to(installed_root)
        catalog_entry = shared_root / path.name / "handler.json"
        kind = "managed" if len(relative.parts) == 1 and catalog_entry.is_file() else "custom"
    except ValueError:
        try:
            path.relative_to(shared_root)
            kind = "shared"
        except ValueError:
            kind = "custom"
    print(f"{kind}\t{path}")
PY
  )
}

for account in "${ACCOUNTS[@]}"; do
  [[ -f "$CONFIG_ROOT/$account/runner.env" ]] || die "runner environment missing for $account"
  discover_handlers "$account"
  if "$SYSTEMCTL_BIN" is-enabled "$SERVICE_NAME@$account" >/dev/null 2>&1; then
    ENABLED_ACCOUNTS+=("$account")
  fi
done

echo "Task Hub runner update"
echo "Old SHA: $OLD_SHA"
echo "New SHA: $TARGET_SHA"
echo "Target ref: $TARGET_REF"
echo "Runner version: $OLD_VERSION -> $TARGET_VERSION"
echo "Accounts: ${ACCOUNTS[*]}"
echo "Managed handlers: ${#MANAGED_PATHS[@]}"
echo "Shared handlers: ${#SHARED_PATHS[@]}"
echo "Custom handlers unchanged: ${#CUSTOM_PATHS[@]}"

validate_accounts() {
  local account config env_path
  for account in "${ACCOUNTS[@]}"; do
    config="$CONFIG_ROOT/$account/runner.json"
    env_path="$CONFIG_ROOT/$account/runner.env"
    (
      set -a
      # runner.env is root-owned installation state and is never printed.
      source "$env_path"
      set +a
      PYTHONPATH="$INSTALL_DIR/runner" python3 - "$config" <<'PY'
import sys
from pathlib import Path

from taskhub_runner.config import load_runner_config
from taskhub_runner.plugin_loader import load_handlers

config = load_runner_config(Path(sys.argv[1]))
load_handlers(config.handler_paths, config.script_registry_path)
PY
    ) || return 1
  done
}

validate_target_handlers() {
  local item name manifest
  for item in "${MANAGED_PATHS[@]}" "${SHARED_PATHS[@]}"; do
    name="$(basename "${item#*|}")"
    manifest="$(git -C "$INSTALL_DIR" show "$TARGET_SHA:runner/handlers/$name/handler.json" 2>/dev/null)" \
      || die "managed handler is unavailable in target version: $name"
    python3 -c '
import json, sys
raw = json.load(sys.stdin)
for key in ("name", "version", "entrypoint"):
    if not isinstance(raw.get(key), str) or not raw[key]:
        raise SystemExit(f"{key} must be a non-empty string")
for key in ("taskTypes", "platforms", "capabilities"):
    if not isinstance(raw.get(key), list) or not all(isinstance(value, str) for value in raw[key]):
        raise SystemExit(f"{key} must be a string list")
if not isinstance(raw.get("timeoutMaxSeconds"), int) or raw["timeoutMaxSeconds"] <= 0:
    raise SystemExit("timeoutMaxSeconds must be a positive integer")
' <<<"$manifest" \
      || die "managed handler manifest is invalid in target version: $name"
  done
}

validate_target_handlers

if [[ "$DRY_RUN" -eq 1 ]]; then
  validate_accounts
  echo "Dry run: target and current runner configuration are valid; no changes made."
  exit 0
fi

rollback() {
  local exit_code=$?
  [[ "$MUTATED" -eq 1 && "$ROLLING_BACK" -eq 0 ]] || exit "$exit_code"
  ROLLING_BACK=1
  trap - ERR
  echo "Update failed; rolling back." >&2
  git -C "$INSTALL_DIR" checkout --detach --force "$OLD_SHA" >/dev/null 2>&1 || true
  for item in "${MANAGED_PATHS[@]}"; do
    local account="${item%%|*}" path="${item#*|}" name
    name="$(basename "$path")"
    rm -rf "$path"
    if [[ -d "$BACKUP_DIR/handlers/$account/$name" ]]; then
      mkdir -p "$(dirname "$path")"
      cp -a "$BACKUP_DIR/handlers/$account/$name" "$path"
      "$CHOWN_BIN" -R "$account:" "$path" >/dev/null 2>&1 || true
    fi
  done
  "$SYSTEMCTL_BIN" daemon-reload >/dev/null 2>&1 || true
  for account in "${ENABLED_ACCOUNTS[@]}"; do
    "$SYSTEMCTL_BIN" enable "$SERVICE_NAME@$account" >/dev/null 2>&1 || true
    "$SYSTEMCTL_BIN" start "$SERVICE_NAME@$account" >/dev/null 2>&1 || true
  done
  echo "Rollback: successful"
  exit "$exit_code"
}
trap rollback ERR

mkdir -p "$TMP_ROOT"
BACKUP_DIR="$(mktemp -d "$TMP_ROOT/task-hub-update.XXXXXX")"
trap 'rm -rf "$BACKUP_DIR"' EXIT
chmod 700 "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/config" "$BACKUP_DIR/handlers"
cp -a "$CONFIG_ROOT/." "$BACKUP_DIR/config/"
for item in "${MANAGED_PATHS[@]}"; do
  account="${item%%|*}"; path="${item#*|}"; name="$(basename "$path")"
  [[ -d "$path" ]] || die "managed handler missing: $path"
  mkdir -p "$BACKUP_DIR/handlers/$account"
  cp -a "$path" "$BACKUP_DIR/handlers/$account/$name"
done

MUTATED=1
for account in "${ACCOUNTS[@]}"; do
  "$SYSTEMCTL_BIN" stop "$SERVICE_NAME@$account"
done
git -C "$INSTALL_DIR" checkout --detach --force "$TARGET_SHA"

if [[ -x "$APT_GET_BIN" ]] || command -v "$APT_GET_BIN" >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  "$APT_GET_BIN" update
  "$APT_GET_BIN" install -y git python3 python3-websocket
else
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
fi

for item in "${MANAGED_PATHS[@]}"; do
  account="${item%%|*}"; path="${item#*|}"; name="$(basename "$path")"
  source_path="$INSTALL_DIR/runner/handlers/$name"
  [[ -f "$source_path/handler.json" ]] || die "managed handler is unavailable in target version: $name"
  rm -rf "$path"
  mkdir -p "$(dirname "$path")"
  cp -a "$source_path" "$path"
  "$CHOWN_BIN" -R "$account:" "$path"
done

validate_accounts
"$SYSTEMCTL_BIN" daemon-reload
for account in "${ENABLED_ACCOUNTS[@]}"; do
  "$SYSTEMCTL_BIN" enable "$SERVICE_NAME@$account"
  "$SYSTEMCTL_BIN" start "$SERVICE_NAME@$account"
  "$SYSTEMCTL_BIN" is-active "$SERVICE_NAME@$account" >/dev/null
done

MUTATED=0
echo "Updated accounts: ${ACCOUNTS[*]}"
echo "Refreshed managed handlers: ${#MANAGED_PATHS[@]}"
echo "Skipped custom handlers: ${#CUSTOM_PATHS[@]}"
echo "Rollback: not required"
