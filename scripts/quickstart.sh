#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${FLAWLESS_STATE_DIR:-$ROOT_DIR/.flawless}"
VENV_DIR="${FLAWLESS_VENV_DIR:-$ROOT_DIR/.venv}"
ENV_FILE="${FLAWLESS_ENV_FILE:-$ROOT_DIR/.env}"
COMPOSE_FILE="$ROOT_DIR/compose.yaml"
PID_FILE="$STATE_DIR/flawless.pid"
PORT_FILE="$STATE_DIR/flawless.port"
LOG_FILE="$STATE_DIR/flawless.log"

COMMAND="start"
MODE="${FLAWLESS_MODE:-auto}"
PORT="${FLAWLESS_PORT:-8080}"
PORT_EXPLICIT=0
CHINA_MIRRORS=0
REBUILD=0
OPEN_BROWSER=0

usage() {
  cat <<'EOF'
Flawless one-click local deployment

Usage:
  ./scripts/quickstart.sh [start|stop|status|logs] [options]

Options:
  --mode auto|docker|native  Prefer Docker when available (default: auto)
  --port PORT                Console port (default: 8080)
  --china                    Use mainland China package/image mirrors
  --rebuild                  Reinstall dependencies and rebuild the console
  --open                     Open the console in the default browser
  -h, --help                 Show this help

Examples:
  ./scripts/quickstart.sh
  ./scripts/quickstart.sh --china
  ./scripts/quickstart.sh --mode native --port 18080
  ./scripts/quickstart.sh status
  ./scripts/quickstart.sh logs
  ./scripts/quickstart.sh stop
EOF
}

log() {
  printf '[flawless] %s\n' "$*"
}

fail() {
  printf '[flawless] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"
}

signature() {
  cksum "$1" | awk '{print $1 "-" $2}'
}

env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -v wanted="$key" '
    index($0, wanted "=") == 1 {
      sub(/^[^=]*=/, "")
      print
      exit
    }
  ' "$ENV_FILE"
}

dockerize_local_url() {
  local value="$1"
  value="${value//localhost/host.docker.internal}"
  value="${value//127.0.0.1/host.docker.internal}"
  printf '%s' "$value"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ROOT_DIR/.env.example" "$ENV_FILE"
    log "created $(basename "$ENV_FILE") from .env.example"
  fi
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

compose() {
  docker compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" "$@"
}

native_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid process_command
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  process_command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$process_command" == *"scripts/run_local_stack.py"* ]]
}

docker_running() {
  docker_ready || return 1
  [ -n "$(compose ps --status running -q flawless 2>/dev/null || true)" ]
}

resolve_mode() {
  case "$MODE" in
    docker|native) ;;
    auto)
      if native_running; then
        MODE="native"
      elif docker_running; then
        MODE="docker"
      elif docker_ready; then
        MODE="docker"
      else
        MODE="native"
      fi
      ;;
    *) fail "--mode must be auto, docker, or native" ;;
  esac
}

check_port() {
  local python_bin="$1"
  local port="$2"
  "$python_bin" - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.2)
    raise SystemExit(0 if sock.connect_ex(("127.0.0.1", port)) == 0 else 1)
PY
}

wait_for_stack() {
  local url="http://127.0.0.1:$PORT"
  local attempt payload
  for attempt in $(seq 1 90); do
    if curl --fail --silent --show-error --max-time 3 "$url/health" >/dev/null 2>&1; then
      payload="$(curl --fail --silent --show-error --max-time 12 "$url/api/health" 2>/dev/null || true)"
      if printf '%s' "$payload" | grep -Eq '"all_healthy"[[:space:]]*:[[:space:]]*true'; then
        log "console and core services are healthy"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

open_console() {
  [ "$OPEN_BROWSER" -eq 1 ] || return 0
  local url="http://127.0.0.1:$PORT"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

prepare_native() {
  require_command python3
  require_command node
  require_command npm

  python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' \
    || fail "Python 3.11 or newer is required"
  node -e 'const [major] = process.versions.node.split(".").map(Number); process.exit(major >= 20 ? 0 : 1)' \
    || fail "Node.js 20 or newer is required"

  mkdir -p "$STATE_DIR" "$STATE_DIR/data" "$STATE_DIR/npm-cache"

  local npm_signature npm_marker frontend_stale
  npm_signature="$(signature "$ROOT_DIR/frontend/modern/package-lock.json")"
  npm_marker="$STATE_DIR/npm-lock.signature"
  if [ "$REBUILD" -eq 1 ] || [ ! -x "$ROOT_DIR/frontend/modern/node_modules/.bin/vite" ] \
    || [ "$(cat "$npm_marker" 2>/dev/null || true)" != "$npm_signature" ]; then
    log "installing frontend dependencies from package-lock.json"
    local npm_args=(--prefix "$ROOT_DIR/frontend/modern" ci --cache "$STATE_DIR/npm-cache" --no-audit --no-fund)
    if [ "$CHINA_MIRRORS" -eq 1 ]; then
      npm_args+=(--registry https://registry.npmmirror.com)
    fi
    npm "${npm_args[@]}"
    printf '%s\n' "$npm_signature" > "$npm_marker"
  fi

  frontend_stale=0
  if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ] || [ "$REBUILD" -eq 1 ]; then
    frontend_stale=1
  elif [ "$ROOT_DIR/frontend/modern/package-lock.json" -nt "$ROOT_DIR/frontend/dist/index.html" ] \
    || [ "$ROOT_DIR/frontend/modern/package.json" -nt "$ROOT_DIR/frontend/dist/index.html" ] \
    || [ -n "$(find "$ROOT_DIR/frontend/modern/src" -type f -newer "$ROOT_DIR/frontend/dist/index.html" -print -quit)" ]; then
    frontend_stale=1
  fi
  if [ "$frontend_stale" -eq 1 ]; then
    log "building the web console"
    npm --prefix "$ROOT_DIR/frontend/modern" run build
  fi

  if [ ! -x "$VENV_DIR/bin/python" ]; then
    log "creating Python virtual environment"
    python3 -m venv "$VENV_DIR"
  fi

  local requirements_signature requirements_marker
  requirements_signature="$(signature "$ROOT_DIR/requirements.lock")"
  requirements_marker="$STATE_DIR/requirements-lock.signature"
  if [ "$REBUILD" -eq 1 ] || [ ! -x "$VENV_DIR/bin/uvicorn" ] \
    || [ "$(cat "$requirements_marker" 2>/dev/null || true)" != "$requirements_signature" ]; then
    log "installing locked Python dependencies"
    "$VENV_DIR/bin/python" -m pip install --upgrade pip
    local pip_args=(install --require-hashes -r "$ROOT_DIR/requirements.lock")
    if [ "$CHINA_MIRRORS" -eq 1 ]; then
      pip_args+=(--index-url https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com)
    fi
    "$VENV_DIR/bin/python" -m pip "${pip_args[@]}"
    printf '%s\n' "$requirements_signature" > "$requirements_marker"
  fi
}

start_native() {
  if native_running; then
    log "native stack is already running (PID $(cat "$PID_FILE"))"
    return 0
  fi

  prepare_native
  local service_port
  for service_port in "$PORT" 8100 8101 8102 8103 8105 8200 8300; do
    if check_port "$VENV_DIR/bin/python" "$service_port"; then
      fail "port $service_port is already in use; stop that process or choose --port for the console"
    fi
  done

  log "starting the complete native service group"
  (
    cd "$ROOT_DIR"
    export OBSERVABILITY_URL="http://127.0.0.1:8100"
    export HEALING_AGENT_URL="http://127.0.0.1:8101/a2a/tasks"
    export INCIDENT_AGENT_URL="http://127.0.0.1:8102/a2a/tasks"
    export POSTMORTEM_AGENT_URL="http://127.0.0.1:8103/a2a/tasks"
    export MCP_SERVER_URL="http://127.0.0.1:8105/mcp"
    export ADAPTER_URL="http://127.0.0.1:8200"
    export CMDB_URL="http://127.0.0.1:8300"
    export KNOWLEDGE_STORE_PATH="$STATE_DIR/data/knowledge-base.json"
    export MODEL_PROFILES_STORE="$STATE_DIR/data/model-profiles.json"
    export OPS_SKILL_ROOT="$STATE_DIR/data/ops-skills"
    export OPS_SKILL_STORE_PATH="$STATE_DIR/data/ops-skills.json"
    export RELIABILITY_STORE_PATH="$STATE_DIR/data/reliability-state.json"
    export RELIABILITY_STORE_FALLBACK_PATH="$STATE_DIR/data/reliability-state.fallback.json"
    export EFFECTIVENESS_STORE_PATH="$STATE_DIR/data/effectiveness-state.json"
    export EFFECTIVENESS_STORE_FALLBACK_PATH="$STATE_DIR/data/effectiveness-state.fallback.json"
    "$VENV_DIR/bin/python" scripts/run_local_stack.py \
      --host 127.0.0.1 \
      --api-port "$PORT" \
      --daemon \
      --pid-file "$PID_FILE" \
      --log-file "$LOG_FILE" >/dev/null
    printf '%s\n' "$PORT" > "$PORT_FILE"
  )

  if ! wait_for_stack; then
    tail -n 80 "$LOG_FILE" >&2 || true
    stop_native
    fail "native stack did not become healthy within 90 seconds"
  fi
  log "ready: http://127.0.0.1:$PORT"
  log "logs:  ./scripts/quickstart.sh logs"
  log "stop:  ./scripts/quickstart.sh stop"
  open_console
}

stop_native() {
  if ! native_running; then
    rm -f "$PID_FILE"
    log "native stack is not running"
    return 0
  fi
  local pid attempt
  pid="$(cat "$PID_FILE")"
  log "stopping native stack (PID $pid)"
  kill "$pid" >/dev/null 2>&1 || true
  for attempt in $(seq 1 80); do
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
}

status_native() {
  if native_running; then
    log "native stack is running (PID $(cat "$PID_FILE"))"
    curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$PORT/health" || true
    printf '\n'
  else
    log "native stack is stopped"
  fi
}

start_docker() {
  require_command docker
  docker_ready || fail "Docker is installed but the daemon is not running"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

  local saved_port
  saved_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
  if docker_running && [ "$REBUILD" -eq 0 ] \
    && { [ "$PORT_EXPLICIT" -eq 0 ] || [ "$PORT" = "$saved_port" ]; }; then
    [ -n "$saved_port" ] && PORT="$saved_port"
    log "Docker stack is already running"
    log "ready: http://127.0.0.1:$PORT"
    open_console
    return 0
  fi

  local current_context
  if [ -n "${FLAWLESS_BUILDX_BUILDER:-}" ]; then
    export BUILDX_BUILDER="$FLAWLESS_BUILDX_BUILDER"
  else
    current_context="$(docker context show)"
    if docker buildx inspect "$current_context" >/dev/null 2>&1; then
      export BUILDX_BUILDER="$current_context"
    fi
  fi
  export FLAWLESS_PORT="$PORT"
  printf '%s\n' "$PORT" > "$PORT_FILE"
  local llm_url embedding_url
  llm_url="$(env_value LLM_API_BASE)"
  embedding_url="$(env_value EMBEDDING_API_BASE)"
  export FLAWLESS_DOCKER_LLM_API_BASE="$(dockerize_local_url "${llm_url:-http://localhost:11434/v1}")"
  export FLAWLESS_DOCKER_EMBEDDING_API_BASE="$(dockerize_local_url "${embedding_url:-http://localhost:11434/v1}")"

  if [ "$CHINA_MIRRORS" -eq 1 ]; then
    export FLAWLESS_NODE_IMAGE="docker.m.daocloud.io/library/node:24-slim"
    export FLAWLESS_PYTHON_IMAGE="docker.m.daocloud.io/library/python:3.13-slim"
    export FLAWLESS_NGINX_IMAGE="docker.m.daocloud.io/nginxinc/nginx-unprivileged:stable-alpine3.23"
    export FLAWLESS_NPM_REGISTRY="https://registry.npmmirror.com"
    export FLAWLESS_PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple"
    export FLAWLESS_PIP_TRUSTED_HOST="mirrors.aliyun.com"
    export FLAWLESS_DEBIAN_MIRROR="https://mirrors.aliyun.com/debian"
  fi

  log "building and starting the Docker stack"
  compose up -d --build || return "$?"
  docker_running || fail "Docker container did not remain running after startup"
  if ! wait_for_stack; then
    compose logs --tail 120 >&2 || true
    fail "Docker stack did not become healthy within 90 seconds"
  fi
  log "ready: http://127.0.0.1:$PORT"
  log "logs:  ./scripts/quickstart.sh logs"
  log "stop:  ./scripts/quickstart.sh stop"
  open_console
}

stop_docker() {
  docker_ready || fail "Docker daemon is not running"
  compose down
}

status_docker() {
  docker_ready || fail "Docker daemon is not running"
  compose ps
}

logs_native() {
  [ -f "$LOG_FILE" ] || fail "no native log exists yet"
  tail -n 200 -f "$LOG_FILE"
}

logs_docker() {
  docker_ready || fail "Docker daemon is not running"
  compose logs --tail 200 -f
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    start|stop|status|logs) COMMAND="$1" ;;
    --mode)
      [ "$#" -ge 2 ] || fail "--mode requires a value"
      MODE="$2"
      shift
      ;;
    --port)
      [ "$#" -ge 2 ] || fail "--port requires a value"
      PORT="$2"
      PORT_EXPLICIT=1
      shift
      ;;
    --china) CHINA_MIRRORS=1 ;;
    --rebuild) REBUILD=1 ;;
    --open) OPEN_BROWSER=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

REQUESTED_MODE="$MODE"

if [ "$COMMAND" != "start" ] && [ "$PORT_EXPLICIT" -eq 0 ] && [ -f "$PORT_FILE" ]; then
  PORT="$(cat "$PORT_FILE")"
fi

[[ "$PORT" =~ ^[0-9]+$ ]] || fail "--port must be an integer"
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "--port must be between 1 and 65535"
case "$PORT" in
  8100|8101|8102|8103|8105|8200|8300)
    fail "--port $PORT is reserved by an internal Flawless service"
    ;;
esac

cd "$ROOT_DIR"
mkdir -p "$STATE_DIR"
ensure_env
require_command curl
resolve_mode
log "selected mode: $MODE"

case "$COMMAND:$MODE" in
  start:native) start_native ;;
  stop:native) stop_native ;;
  status:native) status_native ;;
  logs:native) logs_native ;;
  start:docker)
    if [ "$REQUESTED_MODE" = "auto" ]; then
      if (start_docker); then
        :
      else
        docker_status="$?"
        if [ "$docker_status" -eq 130 ] || [ "$docker_status" -eq 143 ]; then
          exit "$docker_status"
        fi
        log "Docker startup failed; cleaning up and falling back to native mode"
        compose down >/dev/null 2>&1 || true
        MODE="native"
        start_native
      fi
    else
      start_docker
    fi
    ;;
  stop:docker) stop_docker ;;
  status:docker) status_docker ;;
  logs:docker) logs_docker ;;
  *) fail "unsupported command or mode" ;;
esac
