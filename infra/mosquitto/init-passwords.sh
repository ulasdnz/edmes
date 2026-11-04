#!/bin/sh
# Writes the broker's password file from the environment at every start, so neither a password
# nor its hash is kept in the repository. mosquitto_passwd stores each password as a salted
# PBKDF2-SHA512 hash, and only the mosquitto user can read the file.
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME must be set}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD must be set}"
: "${MQTT_HEALTH_PASSWORD:?MQTT_HEALTH_PASSWORD must be set}"

file=/mosquitto/config/password_file
umask 077
rm -f "$file"
mosquitto_passwd -c -b "$file" "$MQTT_USERNAME" "$MQTT_PASSWORD"
mosquitto_passwd -b "$file" health "$MQTT_HEALTH_PASSWORD"
chown mosquitto:mosquitto "$file"

exec /docker-entrypoint.sh "$@"
