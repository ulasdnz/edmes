#!/usr/bin/env bash
# Installs or upgrades EDMES on this server and starts it. Running it again is safe: it fills only
# the settings that are still empty, so an upgrade keeps the secrets of the first install.
#
#   sudo ./install.sh                                    first install, or an upgrade
#   sudo SYSTEM_ADMIN_PASSWORD='...' ./install.sh        sets the system admin's password
#
# In a release package it starts the published images, and loads images.tar.gz first when it lies
# beside this script, for a server without internet access. In a source checkout it builds them.
set -euo pipefail
umask 077
cd "$(dirname "$0")"

die() {
  echo "install: $*" >&2
  exit 1
}

# Hex digits from the kernel's random source; needs no openssl
random_hex() {
  head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# A setting's value in an env file, without the quotes around it
current() {
  local value
  value=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2-) || true
  value=${value#[\"\']}
  echo "${value%[\"\']}"
}

# Sets a setting in an env file, replacing its line or adding one. The file keeps its permissions.
set_value() {
  KEY=$2 VALUE=$3 awk '
    BEGIN { found = 0 }
    index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; found = 1; next }
    { print }
    END { if (!found) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }
  ' "$1" > "$1.tmp"
  cat "$1.tmp" > "$1"
  rm -f "$1.tmp"
}

# Machine-to-machine secrets: generated once, never shown
fill_secret() {
  if [ -z "$(current .env "$1")" ]; then
    set_value .env "$1" "$(random_hex 32)"
    echo "  $1: generated"
  fi
}

shown=()

echo "Checking Docker"
command -v docker > /dev/null || die "Docker is not installed (https://docs.docker.com/engine/install/)"
docker compose version > /dev/null 2>&1 || die "the Docker Compose plugin is not installed"
docker info > /dev/null 2>&1 || die "cannot reach the Docker daemon; run as root or as a member of the docker group"

echo "Preparing .env"
[ -f .env ] || cp .env.example .env
chmod 600 .env
fill_secret JWT_SECRET
fill_secret INTERNAL_API_TOKEN
fill_secret MQTT_PASSWORD
fill_secret MQTT_HEALTH_PASSWORD

# People sign in with these two, so a generated one is shown once at the end
if [ -z "$(current .env GRAFANA_PASSWORD)" ]; then
  password=$(random_hex 12)
  set_value .env GRAFANA_PASSWORD "$password"
  shown+=("Grafana password (user admin): $password")
fi

if [ -z "$(current .env SYSTEM_ADMIN_PASSWORD)" ]; then
  password=${SYSTEM_ADMIN_PASSWORD:-}
  if [ -z "$password" ] && [ -t 0 ]; then
    read -r -s -p "  System admin password, 8 to 20 characters (Enter generates one): " password
    echo
  fi
  generated=false
  if [ -z "$password" ]; then
    password=$(random_hex 8)
    generated=true
    shown+=("System admin password (user system, to be changed at the first sign-in): $password")
  fi
  [ "${#password}" -ge 8 ] && [ "${#password}" -le 20 ] ||
    die "the system admin password needs 8 to 20 characters"
  case $password in
    *"'"* | *[[:space:]]*) die "the system admin password cannot hold quotes or spaces" ;;
  esac
  set_value .env SYSTEM_ADMIN_PASSWORD "'$password'"
  # Printed on this screen, so the system admin replaces it at the first sign-in
  [ "$generated" = false ] || set_value .env SYSTEM_ADMIN_MUST_CHANGE_PASSWORD true
  echo "  SYSTEM_ADMIN_PASSWORD: set"
fi

if [ -f VERSION ]; then
  version=$(tr -d '[:space:]' < VERSION)
  set_value .env EDMES_VERSION "$version"
  if [ -f images.tar.gz ]; then
    echo "Loading the images from images.tar.gz"
    docker load -i images.tar.gz
  else
    echo "Pulling the images of version $version"
    docker compose pull
  fi
  echo "Starting EDMES $version"
  # Every image is here by now; a missing one fails at once instead of reaching for the internet
  docker compose up -d --pull never --wait --wait-timeout 300
else
  version=dev
  # Local development: telemetry's own .env connects to this broker with the same password
  if [ -f telemetry/.env ] && [ -z "$(current telemetry/.env MQTT_PASSWORD)" ]; then
    set_value telemetry/.env MQTT_PASSWORD "$(current .env MQTT_PASSWORD)"
    echo "  telemetry/.env MQTT_PASSWORD: copied from .env"
  fi
  echo "Building and starting EDMES from this checkout"
  docker compose up -d --build --wait --wait-timeout 600
fi

host=$(hostname -I 2> /dev/null | awk '{print $1}') || true
host=${host:-this-server}
echo
echo "EDMES $version is running"
echo "  Web and API:  http://$host/"
echo "  Grafana:      http://$host:3001/"
echo "  MQTT broker:  $host:1883"
echo "  Settings:     $(pwd)/.env (keep it: an upgrade reuses its secrets)"
if [ "${#shown[@]}" -gt 0 ]; then
  echo
  echo "Generated now and shown only once. Note them down:"
  for line in "${shown[@]}"; do echo "  $line"; done
fi
