# MQTT Broker (Mosquitto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Eclipse Mosquitto MQTT broker to Docker Compose as infrastructure for future telemetry data ingestion.

**Architecture:** Standalone Mosquitto 2 container with username/password auth, persistence enabled, stdout logging (Promtail collects). No application code changes — infrastructure only.

**Tech Stack:** Eclipse Mosquitto 2, Docker Compose

**Spec:** `docs/superpowers/specs/2026-03-31-mqtt-broker-design.md`

---

### Task 1: Create Mosquitto config file

**Files:**
- Create: `infra/mosquitto/mosquitto.conf`

- [ ] **Step 1: Create the config file**

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

- [ ] **Step 2: Commit**

```bash
git add infra/mosquitto/mosquitto.conf
git commit -m "build: add mosquitto broker config"
```

---

### Task 2: Generate password file

**Files:**
- Create: `infra/mosquitto/password_file`

The `mosquitto_passwd` tool is inside the Mosquitto Docker image. We use a temporary container to generate the hashed password file.

- [ ] **Step 1: Generate password file with two users**

Run these commands sequentially. Each prompts for a password — use `dev123` for both (dev-only credentials):

```bash
docker run --rm -v ./infra/mosquitto:/tmp/mosquitto eclipse-mosquitto:2 mosquitto_passwd -c -b /tmp/mosquitto/password_file mes_service dev123
docker run --rm -v ./infra/mosquitto:/tmp/mosquitto eclipse-mosquitto:2 mosquitto_passwd -b /tmp/mosquitto/password_file health dev123
```

First command creates the file (`-c`) with `mes_service` user. Second command appends `health` user (no `-c`).

- [ ] **Step 2: Verify the file was created and contains two entries**

```bash
cat infra/mosquitto/password_file
```

Expected: Two lines, each with `username:$7$...` (PBKDF2 hash format).

- [ ] **Step 3: Commit**

```bash
git add infra/mosquitto/password_file
git commit -m "build: add mosquitto dev credentials"
```

---

### Task 3: Add Mosquitto service to Docker Compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add mosquitto service block**

Insert after the `redis` service block (after line 78) and before the `user` service block:

```yaml
  mosquitto:
    image: eclipse-mosquitto:2
    container_name: mosquitto_dev
    restart: unless-stopped
    ports:
      - "127.0.0.1:1883:1883"
    volumes:
      - ./infra/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - ./infra/mosquitto/password_file:/mosquitto/config/password_file:ro
      - mosquitto_data:/mosquitto/data
    networks:
      - mes_network
    healthcheck:
      test: ["CMD", "mosquitto_pub", "-h", "localhost", "-u", "health", "-P", "health", "-t", "_healthcheck", "-m", "ok", "-q", "1"]
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

- [ ] **Step 2: Add named volume**

Add `mosquitto_data:` to the `volumes:` section at the bottom of the file, after `promtail_positions:`:

```yaml
volumes:
  mongodb_data:
  redis_data:
  user_uploads:
  loki_data:
  grafana_data:
  promtail_positions:
  mosquitto_data:
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "build: add mosquitto mqtt broker service"
```

---

### Task 4: Verify broker works

- [ ] **Step 1: Start only the Mosquitto container**

```bash
docker compose up -d mosquitto
```

- [ ] **Step 2: Wait for healthy status**

```bash
docker compose ps mosquitto
```

Expected: Status shows `healthy`.

- [ ] **Step 3: Test pub/sub with authentication**

Open two terminals or use background process. Subscribe in background, publish, verify message received:

```bash
docker exec mosquitto_dev mosquitto_sub -h localhost -u mes_service -P dev123 -t "test/hello" -C 1 -W 5 &
sleep 1
docker exec mosquitto_dev mosquitto_pub -h localhost -u mes_service -P dev123 -t "test/hello" -m "mqtt works"
```

Expected: `mqtt works` printed from subscriber.

- [ ] **Step 4: Test auth rejection**

```bash
docker exec mosquitto_dev mosquitto_pub -h localhost -t "test/noauth" -m "should fail"
```

Expected: Connection refused (anonymous not allowed).

- [ ] **Step 5: Test persistence — restart broker and check retained message**

```bash
docker exec mosquitto_dev mosquitto_pub -h localhost -u mes_service -P dev123 -t "test/retain" -m "persistent" -r
docker compose restart mosquitto
sleep 3
docker exec mosquitto_dev mosquitto_sub -h localhost -u mes_service -P dev123 -t "test/retain" -C 1 -W 5
```

Expected: `persistent` printed — retained message survived restart.

- [ ] **Step 6: Stop the container**

```bash
docker compose down mosquitto
```
