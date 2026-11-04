# Remote Database Access (SSH Tunnel)

How to reach MongoDB, Redis and the Traefik dashboard of an on-prem EDMES installation from your own machine.

## Why the ports are not public

`docker-compose.yml` publishes these ports on the server's loopback interface only:

| Service | Host port | Reachable from |
|---------|-----------|----------------|
| MongoDB | `127.0.0.1:27017` | the server itself |
| Redis | `127.0.0.1:6379` | the server itself |
| Loki | `127.0.0.1:3100` | the server itself (use Grafana instead) |
| Traefik dashboard | `127.0.0.1:8080` | the server itself |
| Traefik (API) | `80` | the factory network |
| Mosquitto (MQTT) | `1883` | the factory network (password auth) |
| Grafana | `3001` | the factory network (admin password) |

MongoDB and Redis run **without authentication** inside the Docker network. Anyone who can open a TCP connection to them can read and delete production data, so they must never be reachable from the network. Binding to `127.0.0.1` also matters on Linux because Docker writes its own iptables rules for published ports, which bypass host firewalls such as `ufw`. A `0.0.0.0` binding would stay open even if the firewall says otherwise.

The services themselves are unaffected: they talk to `mongodb:27017` and `redis:6379` over the internal `mes_network`.

## How an SSH tunnel works

```
your laptop                         factory server
-----------                         --------------
Compass  -> localhost:27017 ==SSH==> sshd -> 127.0.0.1:27017 -> mongodb container
```

`ssh -L` opens a port on your laptop and forwards everything sent to it through the encrypted SSH connection to an address **as seen from the server**. For the server, the connection comes from its own loopback, so the `127.0.0.1` binding allows it.

The SSH login is the access control: whoever can SSH into the server can reach the databases. Nothing in EDMES needs to change for this to work.

## What you need

| Requirement | Who provides it | Notes |
|-------------|-----------------|-------|
| A stable server address | Customer IT | Static IP, DHCP reservation or a DNS name. The shop floor already needs this to reach the API on port 80. |
| SSH server running on the host | Whoever installs the server | Linux: `openssh-server`. Windows Server: the optional "OpenSSH Server" feature. |
| A personal user account on the host | Server admin | One account per person, so access can be revoked and audited. |
| An SSH key pair | You | Prefer keys over passwords. Disable password login once keys work. |
| SSH client on your laptop | Built in | Windows 10/11, macOS and Linux all ship `ssh`. |
| Network path to the server's port 22 | Depends on where you are | See below. |

You do **not** need a database password, a static IP on your laptop, or any change to `docker-compose.yml`.

## Where you connect from

**Same network (on site, or from the customer's IT network):** SSH directly to the server's LAN address, for example `10.20.0.15`.

**From outside the factory (your office, home):** first join the customer's network, then SSH exactly as if you were on site. Customer IT decides how:

- **Client VPN** (FortiClient, GlobalProtect, WireGuard, OpenVPN, ...): most common. You get an account, often time-limited or approved per session.
- **Jump host / remote desktop** (a bastion server, AnyDesk/TeamViewer to an IT machine): you SSH from that machine instead of your laptop.

Never ask the customer to forward port 22, 27017 or 6379 from the internet to the server. Factory networks are frequently segmented (OT vs IT), so expect to agree on the path with customer IT during installation, not during an incident.

## Step by step

### 1. Create a key pair (once, on your laptop)

```bash
ssh-keygen -t ed25519 -C "your.name@company"
```

Send the **public** key (`~/.ssh/id_ed25519.pub`, on Windows `C:\Users\<you>\.ssh\id_ed25519.pub`) to the server admin. Never share the private key.

### 2. Server admin authorizes the key (once, on the server)

```bash
sudo adduser alice
sudo -u alice mkdir -p /home/alice/.ssh
sudo -u alice tee -a /home/alice/.ssh/authorized_keys < alice_id_ed25519.pub
sudo chmod 700 /home/alice/.ssh && sudo chmod 600 /home/alice/.ssh/authorized_keys
```

The user does not need to be in the `docker` group to use a tunnel. Only grant it if they also need `docker` commands (see "Without a tunnel" below).

### 3. Check that plain SSH works

Connect to the customer VPN first if you are off site.

```bash
ssh alice@10.20.0.15
```

### 4. Open the tunnel

```bash
ssh -N -L 27017:127.0.0.1:27017 -L 6379:127.0.0.1:6379 -L 8080:127.0.0.1:8080 alice@10.20.0.15
```

- `-N` opens the tunnel without starting a shell. The terminal stays open; closing it (`Ctrl+C`) closes the tunnel.
- If a local MongoDB or Redis already uses one of these ports on your laptop, pick another local port: `-L 27018:127.0.0.1:27017`, then connect to `localhost:27018`.

### 5. Connect your tools to `localhost`

| Tool | Address while the tunnel is open |
|------|----------------------------------|
| MongoDB Compass / mongosh | `mongodb://localhost:27017/?directConnection=true` |
| Redis client (redis-cli, any GUI) | `localhost:6379`, no password |
| Traefik dashboard | `http://localhost:8080` |

Databases: `mes` (user, work-center, production), `mes_telemetry`, `mes_performance`.

Redis: cross-service streams are named `events.*`. Service-local keys carry a prefix (`user:`, `wc:`, `prod:`, `telemetry:`, `performance:`); keys shared across services, such as the auth-context cache, have none.

### Alternative: let Compass open the tunnel

Instead of step 4, open Compass → Advanced Connection Options → **Proxy/SSH** → **SSH with Identity File**:

- Connection string: `mongodb://127.0.0.1:27017/?directConnection=true` (the address as seen from the server)
- SSH hostname: `10.20.0.15`, port `22`, username `alice`
- Identity file: your private key

## Without a tunnel

For a quick look you can work on the server itself. This requires `docker` permissions on the host.

```bash
ssh alice@10.20.0.15
docker exec -it mongodb_dev mongosh mes
docker exec -it redis_dev redis-cli
```

## Rules for production data

- This is the live database of a running factory. Prefer read-only queries. Writes bypass validation, audit logging and the events that keep other services in sync.
- Close the tunnel when you are done.
- Remove the user's key from `authorized_keys` when someone leaves the project.
- Logs are available through Grafana on port 3001. You do not need a Loki tunnel to read logs.
