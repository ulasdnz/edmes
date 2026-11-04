# Installing AIMES

AIMES runs on one Linux server with Docker. A release is a small package,
`aimes-<version>.tar.gz`, with the compose file, the infrastructure settings and `install.sh`. The
six service images come from `ghcr.io/ulasdnz`, tagged with the version; a version's images are
never replaced, so every server on `1.0.0` runs the same images.

## Requirements

- Docker Engine with the Compose plugin
- Ports 80 (web and API), 1883 (MQTT for the devices) and 3001 (Grafana) free
- Internet access to `ghcr.io` and Docker Hub, or the offline package (see below)

## First install

```bash
sudo tar -xzf aimes-1.0.0.tar.gz -C /opt
sudo /opt/aimes/install.sh
```

`install.sh` does five things:

1. Checks that Docker and the Compose plugin are there and reachable.
2. Creates `/opt/aimes/.env` from `.env.example`, readable by its owner only, and fills every
   empty secret with a random value. A value already there is never changed.
3. Asks for the system admin's password. Press Enter to have one generated, or pass it in:
   `sudo SYSTEM_ADMIN_PASSWORD='...' /opt/aimes/install.sh`.
4. Pulls the images of the package's version, or loads `images.tar.gz` when it is in the package.
5. Starts everything and waits until every service reports healthy.

It ends by printing the addresses, and the system admin and Grafana passwords when it generated
them. Those two are shown only once.

## Upgrade

Unpack the new package over the same folder and run the script again:

```bash
sudo tar -xzf aimes-1.1.0.tar.gz -C /opt
sudo /opt/aimes/install.sh
```

`.env` is not in the package, so the secrets of the first install stay. The data lives in Docker
volumes and stays too; only the services whose image or settings changed restart. Database
migrations run forward only, so going back to an older version needs a backup taken before the
upgrade.

## A server without internet access

On a machine that has internet access and a checkout of the repository:

```bash
scripts/package-release.sh 1.0.0 --offline
```

This writes `dist/aimes-1.0.0-offline.tar.gz` with every image inside. Copy it to the server and
install it the same way. This was tested with Docker's containerd image store, which keeps each
image's digest when it loads, so the digest-pinned infrastructure images are found offline.

## Settings and passwords

- `/opt/aimes/.env` holds every setting and secret. Keep it, back it up, never share it.
- The system admin's and Grafana's passwords are set at the first start. Change them later in the
  application and in Grafana; a new value in `.env` does not change them.
- To change the MQTT passwords, edit them in `.env` and run `install.sh` again. The broker and
  telemetry restart with the new ones; update the devices with `MQTT_PASSWORD` as well.
- A new `JWT_SECRET` signs everyone out.

## Publishing a version

```bash
git tag v1.0.0
git push origin v1.0.0
```

The release workflow builds and pushes the six images, then attaches `aimes-1.0.0.tar.gz` to the
GitHub release. It refuses a version whose images already exist.

## Local development

In a checkout, the same script builds the images from source instead of pulling them, and copies
the broker password into `telemetry/.env` for `pnpm dev`:

```bash
SYSTEM_ADMIN_PASSWORD='<8 to 20 characters>' ./install.sh
```
