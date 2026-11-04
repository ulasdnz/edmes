# MQTT Broker (Mosquitto) Design

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Infrastructure only — adds MQTT broker to Docker Compose. No application service changes.

## Context

MES sistemi sahadan veri toplamak icin bir MQTT broker'a ihtiyac duyuyor. Telemetry servisi (gelecek adim) bu broker uzerinden PLC, sensor gateway ve OPC-UA bridge gibi cihazlardan veri alacak.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Broker | Eclipse Mosquitto 2 | Lightweight (~10MB RAM), industry standard, on-premises MES icin yeterli. EMQX'e gecis kolay — MQTT standart protokol, servis kodu degismez. |
| Auth | Username/password (`password_file`) | Basit, yeterli guvenlik. TLS client cert gerekirse sonra eklenir. |
| Ports | 1883 TCP only | WebSocket (9001) gereksiz — frontend zaten Socket.io uzerinden realtime servisinden veri aliyor. |
| Persistence | Enabled | Retained message + session korunmasi. Named volume ile tutarli. |
| Logging | stdout only | Promtail zaten container stdout loglarini topluyor. Ayri log volume gereksiz. |

## Docker Compose Service

```yaml
mosquitto:
  image: eclipse-mosquitto:2
  container_name: mosquitto_dev
  restart: unless-stopped
  ports:
    - "1883:1883"
  environment:
    - MQTT_USERNAME=${MQTT_USERNAME:-mes_service}
    - MQTT_PASSWORD=${MQTT_PASSWORD:?MQTT_PASSWORD must be set}
    - MQTT_HEALTH_PASSWORD=${MQTT_HEALTH_PASSWORD:?MQTT_HEALTH_PASSWORD must be set}
  entrypoint: ["/bin/sh", "/mosquitto/init-passwords.sh"]
  command: ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
  volumes:
    - ./infra/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
    - ./infra/mosquitto/init-passwords.sh:/mosquitto/init-passwords.sh:ro
    - mosquitto_data:/mosquitto/data
  networks:
    - mes_network
  healthcheck:
    test: ["CMD-SHELL", "mosquitto_pub -h 127.0.0.1 -u health -P \"$$MQTT_HEALTH_PASSWORD\" -t _healthcheck -m ok -q 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 10s
  deploy:
    resources:
      limits:
        cpus: '0.25'
        memory: 128M
```

Named volume eklenmeli:
```yaml
volumes:
  mosquitto_data:
```

Port tum interface'lere acik — fabrika agindaki cihazlar (PLC gateway, Fledge, SCADA) dogrudan sunucu IP'si uzerinden baglanabilir.

## Mosquitto Config

**File:** `infra/mosquitto/mosquitto.conf`

```
listener 1883
protocol mqtt
allow_anonymous false
password_file /mosquitto/config/password_file
persistence true
persistence_location /mosquitto/data/
log_dest stdout
log_type all
connection_messages true
```

## Credential Strategy

**File:** `infra/mosquitto/init-passwords.sh` (broker konteynerinin entrypoint'i)

- Sifre dosyasi repo'da yok. Broker her acilista `mosquitto_passwd` ile dosyayi ortam degiskenlerinden yeniden uretir: her sifre salt'li PBKDF2-SHA512 hash olarak `/mosquitto/config/password_file`'a yazilir. Dosyanin sahibi `mosquitto`, izni 0600; Mosquitto'nun izin ve sahiplik uyarilari bu yuzden cikmaz.
- Kullanicilar:
  - `mes_service` (`MQTT_USERNAME`) — servisler icin (telemetry service baglantisi), sifresi `MQTT_PASSWORD`
  - `health` — healthcheck icin, sifresi `MQTT_HEALTH_PASSWORD`
- Sifreleri her kurulumu yapan kisi belirler ve kok `.env` dosyasina yazar (git'e girmez). Varsayilan sifre yok: ikisi de bos ise `docker compose` baslamaz. Telemetry ayni `MQTT_PASSWORD`'u kullanir.
- Sifre degistirmek icin `.env`'deki degeri degistirip broker'i ve telemetry'yi yeniden baslatmak yeter.

## Telemetry Service Integration (Future)

Gelecek telemetry servisi su environment variable'lari kullanacak:

```
MQTT_URL=mqtt://mosquitto:1883
MQTT_USERNAME=mes_service
MQTT_PASSWORD=<password>
```

## Directory Structure

```
infra/
  mosquitto/
    mosquitto.conf
    init-passwords.sh
```

## Healthcheck

`mosquitto_pub` tabanli — connect + auth + publish testi yapar. Bos broker'da bile calisir (`mosquitto_sub` tabanli check bos broker'da timeout olur).

## What This Does NOT Include

- Telemetry/Tag servisi — ayri spec ile tasarlanacak
- WebSocket listener — gerekirse tek satir config ile eklenir
- TLS — on-premises fabrika aginda baslangiç icin gereksiz
- MQTT topic hierarchy — telemetry servisi spec'inde tanimlanacak
