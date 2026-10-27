#!/usr/bin/env bash
# Prepares a fresh Hetzner Cloud server (Ubuntu 24.04, x86) for SurveyJS Studio and starts it:
# system updates and automatic security updates, a deploy user, SSH hardening, Docker with log
# rotation, the compose project (the app and Caddy for https), the registry login, then
# update.sh <tag>. It is safe to run again: each step checks what is already there, and a
# second run with other options rewrites the generated files.
#
#   sudo ./setup.sh --tag <tag> --env-file <app.env> [options]
#
# Required on the first run:
#   --tag TAG              the image tag: the full commit id of a master commit whose CI passed
#   --env-file PATH        the app's settings (start from app.env.example next to this script);
#                          installed as /etc/surveyjs-studio/app.env, root only. Delete PATH after.
# Options:
#   --domain NAME          the public host name (default studio.surveyjs.io)
#   --image NAME           the image without tag (default ghcr.io/surveyjs/surveyjs-studio)
#   --ghcr-user NAME       sign in to ghcr.io as NAME; the token (read:packages) comes from
#                          GHCR_TOKEN, the file named by GHCR_TOKEN_FILE, or a prompt
#   --readyz-allow "IPS"   addresses (space separated) that may call /readyz, e.g. a monitor
#   --restrict-to "IPS"    serve only these addresses, everyone else gets 403 (rollout step 1)
#   --deploy-user NAME     the everyday user (default deploy); --no-deploy-user skips it
#   --no-ssh-hardening     keep password and root sign-in over SSH
#
# Next to this script it needs update.sh, which it installs as /opt/surveyjs-studio/update.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/surveyjs-studio
ETC_DIR=/etc/surveyjs-studio
NETWORK_SUBNET=172.30.0.0/24
CADDY_IMAGE=caddy:2.10.2
REQUIRED_SETTINGS=(PUBLIC_BASE_URL SESSION_SECRET APP_EDITION STORAGE_PROVIDER
  LEGACY_SQL_CONNECTION_STRING LEGACY_SURVEYS_STORAGE_CONNECTION_STRING
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET)

TAG=""
ENV_FILE=""
DOMAIN=studio.surveyjs.io
IMAGE=ghcr.io/surveyjs/surveyjs-studio
GHCR_USER=""
READYZ_ALLOW=""
RESTRICT_TO=""
DEPLOY_USER=deploy
SSH_HARDENING=yes

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit "${1:-0}"
}

parse_args() {
  while (($#)); do
    case "$1" in
      --tag) TAG="${2:?--tag needs a value}" && shift ;;
      --env-file) ENV_FILE="${2:?--env-file needs a value}" && shift ;;
      --domain) DOMAIN="${2:?--domain needs a value}" && shift ;;
      --image) IMAGE="${2:?--image needs a value}" && shift ;;
      --ghcr-user) GHCR_USER="${2:?--ghcr-user needs a value}" && shift ;;
      --readyz-allow) READYZ_ALLOW="${2:?--readyz-allow needs a value}" && shift ;;
      --restrict-to) RESTRICT_TO="${2:?--restrict-to needs a value}" && shift ;;
      --deploy-user) DEPLOY_USER="${2:?--deploy-user needs a value}" && shift ;;
      --no-deploy-user) DEPLOY_USER="" ;;
      --no-ssh-hardening) SSH_HARDENING=no ;;
      -h | --help) usage 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
    shift
  done
}

check_inputs() {
  [[ $EUID -eq 0 ]] || die "run it as root: sudo $0 ..."
  [[ -f "$SCRIPT_DIR/update.sh" ]] || die "update.sh must be next to this script"
  [[ "$(uname -m)" == x86_64 ]] || die "the image is built for x86_64 (amd64); this server is $(uname -m)"
  # shellcheck disable=SC1091
  if [[ -r /etc/os-release ]] && . /etc/os-release && [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != 24.04 ]]; then
    warn "written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}"
  fi
  [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "not a host name: $DOMAIN"
  local ips="$READYZ_ALLOW $RESTRICT_TO" ip_list='^[0-9A-Fa-f:./ ]*$'
  [[ "$ips" =~ $ip_list ]] || die "--readyz-allow and --restrict-to take IP addresses or CIDR ranges"

  if [[ -z "$TAG" ]]; then
    TAG="$(sed -n 's/^TAG=//p' "$APP_DIR/.env" 2>/dev/null | tail -n 1 || true)"
    [[ -n "$TAG" ]] || die "--tag is required on the first run"
    warn "no --tag: keeping the configured tag $TAG"
  fi
  if [[ -z "$ENV_FILE" ]]; then
    [[ -f "$ETC_DIR/app.env" ]] || die "--env-file is required on the first run"
    check_env_file "$ETC_DIR/app.env"
  else
    [[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
    check_env_file "$ENV_FILE"
  fi
}

# The app checks every setting when it starts; this catches the common mistakes before that.
check_env_file() {
  local file="$1" key value missing=()
  for key in "${REQUIRED_SETTINGS[@]}"; do
    grep -Eq "^${key}=.+" "$file" || missing+=("$key")
  done
  ((${#missing[@]} == 0)) || die "missing in $file: ${missing[*]}"
  grep -Eq '^[A-Z_]+=<' "$file" && die "$file still holds <placeholders>"
  value="$(sed -n 's/^PUBLIC_BASE_URL=//p' "$file" | tail -n 1 | tr -d "'\"")"
  [[ "$value" == "https://$DOMAIN" ]] || die "PUBLIC_BASE_URL is $value, expected https://$DOMAIN"
  value="$(sed -n 's/^TRUST_PROXY=//p' "$file" | tail -n 1 | tr -d "'\"")"
  [[ "$value" == "$NETWORK_SUBNET" ]] ||
    warn "TRUST_PROXY is '${value}'; behind this Caddy it should be $NETWORK_SUBNET, or every user shares the proxy's rate limits"
  # Compose expands $ in unquoted and double-quoted values.
  if grep -E '^[A-Z_]+=[^'"'"'].*\$' "$file" >/dev/null; then
    warn "a value in $file holds \$ without single quotes; Compose would expand it. Quote it: KEY='value'"
  fi
}

install_packages() {
  log "System updates and automatic security updates"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get -q -y -o Dpkg::Options::=--force-confold upgrade
  apt-get -q -y install ca-certificates curl unattended-upgrades
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

create_deploy_user() {
  [[ -n "$DEPLOY_USER" ]] || return 0
  log "User $DEPLOY_USER"
  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --groups sudo "$DEPLOY_USER"
  fi
  # SSH keys only, no password: sudo must not ask for one.
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" >"/etc/sudoers.d/90-$DEPLOY_USER"
  chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
  visudo -cf "/etc/sudoers.d/90-$DEPLOY_USER" >/dev/null
  local home ssh_dir
  home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  ssh_dir="$home/.ssh"
  if [[ ! -s "$ssh_dir/authorized_keys" && -s /root/.ssh/authorized_keys ]]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "$ssh_dir/authorized_keys"
    echo "copied root's SSH keys to $DEPLOY_USER"
  fi
}

harden_ssh() {
  [[ "$SSH_HARDENING" == yes ]] || return 0
  log "SSH: keys only, no root sign-in"
  local home=""
  [[ -n "$DEPLOY_USER" ]] && home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  if [[ -z "$home" || ! -s "$home/.ssh/authorized_keys" ]]; then
    warn "skipped: no user with an SSH key would be left to sign in (give $DEPLOY_USER a key, or use --no-ssh-hardening)"
    return 0
  fi
  cat >/etc/ssh/sshd_config.d/10-surveyjs-studio.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  sshd -t
  systemctl reload ssh
  echo "from now on: ssh $DEPLOY_USER@<server> (root sign-in is off)"
}

install_docker() {
  log "Docker"
  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck disable=SC1091
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$(. /etc/os-release && echo "$VERSION_CODENAME")" >/etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get -q -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # The app logs every request; Docker's default json-file driver never rotates.
  local wanted='{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }'
  if [[ "$(cat /etc/docker/daemon.json 2>/dev/null)" != "$wanted" ]]; then
    printf '%s\n' "$wanted" >/etc/docker/daemon.json
    systemctl restart docker
    echo "log rotation set (applies to containers created from now on)"
  fi
  systemctl enable --now docker >/dev/null
  docker --version
  docker compose version
}

write_files() {
  log "Files in $APP_DIR and $ETC_DIR"
  install -d -m 755 "$APP_DIR"
  install -d -m 700 "$ETC_DIR"
  if [[ -n "$ENV_FILE" ]]; then
    install -m 600 -o root -g root "$ENV_FILE" "$ETC_DIR/app.env"
    echo "installed $ETC_DIR/app.env; delete $ENV_FILE"
  fi
  install -m 755 "$SCRIPT_DIR/update.sh" "$APP_DIR/update.sh"

  cat >"$APP_DIR/compose.yaml" <<EOF
# Written by setup.sh; run it again to change this file. IMAGE and TAG come from .env (update.sh).
name: surveyjs-studio
services:
  app:
    image: \${IMAGE}:\${TAG}
    env_file: $ETC_DIR/app.env
    restart: unless-stopped
    stop_grace_period: 60s
    networks: [web]
  caddy:
    image: $CADDY_IMAGE
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [web]
networks:
  web:
    ipam:
      config: [{ subnet: $NETWORK_SUBNET }]
volumes:
  caddy_data:
  caddy_config:
EOF

  local restrict=""
  if [[ -n "$RESTRICT_TO" ]]; then
    restrict=$'\t@outsiders not remote_ip '"$RESTRICT_TO"$'\n\trespond @outsiders "Not available yet" 403\n'
  fi
  local caddyfile
  caddyfile="$(
    cat <<EOF
# Written by setup.sh; run it again to change this file.
$DOMAIN {
	encode zstd gzip
	@readyz_blocked {
		path /readyz
		not remote_ip 127.0.0.1${READYZ_ALLOW:+ $READYZ_ALLOW}
	}
	respond @readyz_blocked 404
${restrict}	reverse_proxy app:3000
}
EOF
  )"
  CADDY_CHANGED=no
  if [[ "$(cat "$APP_DIR/Caddyfile" 2>/dev/null)" != "$caddyfile" ]]; then
    printf '%s\n' "$caddyfile" >"$APP_DIR/Caddyfile"
    CADDY_CHANGED=yes
  fi

  if [[ "$(sed -n 's/^IMAGE=//p' "$APP_DIR/.env" 2>/dev/null)" != "$IMAGE" ]]; then
    printf 'IMAGE=%s\nTAG=%s\n' "$IMAGE" "$(sed -n 's/^TAG=//p' "$APP_DIR/.env" 2>/dev/null | tail -n 1)" >"$APP_DIR/.env"
  fi
  ln -sf "$APP_DIR/update.sh" /usr/local/bin/surveyjs-studio-update
}

registry_login() {
  [[ "$IMAGE" == ghcr.io/* ]] || return 0
  log "Registry ghcr.io"
  if [[ -z "$GHCR_USER" ]]; then
    if grep -q '"ghcr.io"' /root/.docker/config.json 2>/dev/null; then
      echo "already signed in"
    else
      warn "not signed in to ghcr.io and no --ghcr-user: pulling works only for a public package"
    fi
    return 0
  fi
  local token="${GHCR_TOKEN:-}"
  if [[ -z "$token" && -n "${GHCR_TOKEN_FILE:-}" ]]; then
    token="$(<"$GHCR_TOKEN_FILE")"
  fi
  if [[ -z "$token" && -t 0 ]]; then
    read -r -s -p "GitHub token (classic, read:packages) for $GHCR_USER: " token
    echo
  fi
  [[ -n "$token" ]] || die "no token for ghcr.io: set GHCR_TOKEN or GHCR_TOKEN_FILE, or run it in a terminal"
  printf '%s' "$token" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
}

check_dns() {
  log "DNS"
  local own resolved
  # Hetzner's metadata service; empty elsewhere.
  own="$(curl -fsS --max-time 3 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 2>/dev/null || true)"
  resolved="$(getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }' || true)"
  if [[ -z "$resolved" ]]; then
    warn "$DOMAIN does not resolve yet; Caddy gets the certificate once it points to ${own:-this server}"
  elif [[ -n "$own" && "$resolved" != "$own" ]]; then
    warn "$DOMAIN points to $resolved, this server is $own; https will not work until it points here"
  else
    echo "$DOMAIN -> $resolved"
  fi
}

start() {
  log "Starting $IMAGE:$TAG"
  "$APP_DIR/update.sh" "$TAG"
  local compose=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/compose.yaml")
  if [[ "$CADDY_CHANGED" == yes ]] && [[ -n "$("${compose[@]}" ps -q caddy)" ]]; then
    "${compose[@]}" restart caddy >/dev/null
    echo "Caddy restarted with the new Caddyfile"
  fi
}

main() {
  parse_args "$@"
  check_inputs
  install_packages
  create_deploy_user
  harden_ssh
  install_docker
  write_files
  registry_login
  check_dns
  start
  log "Ready: https://$DOMAIN"
  cat <<EOF
Check:  curl -sI https://$DOMAIN/ | grep -i -E '^HTTP|content-security-policy|strict-transport'
Status: sudo surveyjs-studio-update --status
Update: sudo surveyjs-studio-update <tag>
EOF
  [[ ! -f /var/run/reboot-required ]] || warn "the system updates need a reboot: sudo reboot (the app starts again by itself)"
}

main "$@"
