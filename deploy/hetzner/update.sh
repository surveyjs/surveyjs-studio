#!/usr/bin/env bash
# Deploys one image tag of SurveyJS Studio on a server that setup.sh prepared. When the new
# container does not become healthy it goes back to the tag that ran before.
#
#   sudo ./update.sh <tag>      deploy a tag: the full commit id of a master commit whose CI passed
#   sudo ./update.sh --status   show the running tag, the container's health and /readyz
#
# Rolling back is deploying the earlier tag. The app has no database migrations, so an earlier
# image runs on the same data. A failing /readyz (SQL or storage unreachable) is reported but
# does not roll back: the cause is outside the image.
#
# Environment: APP_DIR (default /opt/surveyjs-studio), HEALTH_TIMEOUT in seconds (default 150).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/surveyjs-studio}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-150}"
TAG_PATTERN='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

compose() { docker compose --project-directory "$APP_DIR" -f "$APP_DIR/compose.yaml" "$@"; }

# The value of KEY in $APP_DIR/.env (IMAGE or TAG), empty when unset.
setting() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | tail -n 1 || true; }

# Writes the tag into $APP_DIR/.env in one step, keeping IMAGE.
set_tag() {
  local tmp
  tmp="$(mktemp "$APP_DIR/.env.XXXXXX")"
  printf 'IMAGE=%s\nTAG=%s\n' "$IMAGE" "$1" >"$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$APP_DIR/.env"
}

# Waits until the app container reports healthy; fails at once when it restarts or stops.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) id state
  while ((SECONDS < deadline)); do
    id="$(compose ps -q app)"
    if [[ -n "$id" ]]; then
      state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
      case "$state" in
        "running 0 healthy") return 0 ;;
        "running 0 starting") ;;
        *)
          warn "app container: $state (status, restarts, health)"
          return 1
          ;;
      esac
    fi
    sleep 3
  done
  warn "app container not healthy after ${HEALTH_TIMEOUT} s"
  return 1
}

readyz() {
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)},e=>{console.log(String(e));process.exit(1)})"
}

starting_line() { compose logs --no-log-prefix app 2>/dev/null | grep '"msg":"starting"' | tail -n 1; }

# Keeps the images of the current and the previous tag for a fast rollback; removes older ones.
prune_images() {
  local keep_current="$1" keep_previous="$2" tag
  while read -r tag; do
    [[ "$tag" == "$keep_current" || "$tag" == "$keep_previous" || "$tag" == "<none>" ]] && continue
    if docker rmi "$IMAGE:$tag" >/dev/null 2>&1; then
      log "removed the old image $IMAGE:$tag"
    fi
  done < <(docker images "$IMAGE" --format '{{.Tag}}')
}

status() {
  local id
  printf 'image:  %s:%s\n' "$IMAGE" "$(setting TAG)"
  id="$(compose ps -q app)"
  if [[ -z "$id" ]]; then
    printf 'app:    not running\n'
    return 1
  fi
  printf 'app:    %s\n' "$(docker inspect -f '{{.State.Status}}, health {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}, restarts {{.RestartCount}}, since {{.State.StartedAt}}' "$id")"
  printf 'readyz: %s\n' "$(readyz || true)"
}

deploy() {
  local tag="$1" previous
  [[ "$tag" =~ $TAG_PATTERN ]] || die "not a valid image tag: $tag"
  [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || warn "$tag is not a full commit id; CI publishes only those"
  previous="$(setting TAG)"

  if docker image inspect "$IMAGE:$tag" >/dev/null 2>&1; then
    log "$IMAGE:$tag is already on this server"
  else
    log "pulling $IMAGE:$tag"
    docker pull "$IMAGE:$tag" || die "cannot pull $IMAGE:$tag (does the tag exist? is 'docker login ghcr.io' done?); nothing changed"
  fi

  [[ "$previous" == "$tag" ]] && log "$tag is already the configured tag; applying it again"
  set_tag "$tag"
  log "starting $IMAGE:$tag"
  compose up -d --remove-orphans

  if ! wait_healthy; then
    compose logs --tail 30 app >&2 || true
    if [[ -n "$previous" && "$previous" != "$tag" ]]; then
      warn "going back to $previous"
      set_tag "$previous"
      compose up -d --remove-orphans
      wait_healthy || warn "the previous tag is not healthy either; look at 'docker compose logs app'"
      die "$tag did not become healthy; $previous runs again"
    fi
    die "$tag did not become healthy; look at 'docker compose logs app' (often a setting in the app's env file)"
  fi
  log "app healthy"

  if readyz >/dev/null; then
    log "readyz ok"
  else
    warn "readyz: $(readyz || true). Check the Azure firewall rules and the connection strings; the app keeps running"
  fi
  starting_line || true
  # Applying the running tag again would take it as "previous" and drop the rollback image.
  [[ "$previous" == "$tag" ]] || prune_images "$tag" "$previous"
  log "done: $IMAGE:$tag"
}

main() {
  [[ $EUID -eq 0 ]] || die "run it as root: sudo $0 $*"
  [[ -f "$APP_DIR/compose.yaml" ]] || die "$APP_DIR/compose.yaml not found; run setup.sh first"
  IMAGE="$(setting IMAGE)"
  [[ -n "$IMAGE" ]] || die "IMAGE is not set in $APP_DIR/.env; run setup.sh first"

  case "${1:-}" in
    --status) status ;;
    "" | -h | --help)
      awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
      [[ -n "${1:-}" ]] || exit 2
      ;;
    -*) die "unknown option: $1" ;;
    *)
      exec 9>/run/surveyjs-studio-update.lock
      flock -n 9 || die "another update is running"
      deploy "$1"
      ;;
  esac
}

main "$@"
