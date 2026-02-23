# NAS Docker Deployment Guide

> Synology DSM · QNAP QTS · Other NAS systems with Docker support

---

## The problem

NAS systems often have **shorter Docker pull timeouts** than standard Docker installations.
The ControlSphere server image (`ghcr.io/timexx/controlsphere:latest`, ~400–600 MB) may fail to download:

```
Error response from daemon: Get https://registry-1.docker.io/v2/": context deadline exceeded
```

This guide provides three solutions, ordered by reliability.

---

## Solution 1 — Build locally (recommended)

Instead of pulling the pre-built image from GitHub Container Registry, build it on the NAS itself.
This avoids the registry timeout entirely.

### Prerequisites

- Docker + Docker Compose installed (Synology: *Container Manager* package)
- SSH access to the NAS (Synology: *Control Panel → Terminal & SNMP → Enable SSH*)
- Git installed (`sudo apt install git` / `opkg install git` / Synology community package)

### Steps

```bash
# 1. SSH into your NAS
ssh admin@your-nas-ip

# 2. Navigate to a suitable directory
cd /volume1/docker    # Synology typical path
# cd /share/Container  # QNAP typical path

# 3. Clone the repository
git clone https://github.com/timexx/controlsphere.git
cd controlsphere

# 4. Start with local build (uses docker-compose.nas.yml)
docker compose -f docker-compose.nas.yml up -d
```

Build time: **5–15 minutes** depending on NAS hardware.

### Updating

```bash
cd /volume1/docker/controlsphere
git pull
docker compose -f docker-compose.nas.yml up -d --build
```

---

## Solution 2 — Manual pre-pull with retry

If you prefer the pre-built image, pull it manually with retries before starting Compose.

```bash
# SSH into your NAS, then:

# Pull images one at a time (reduces concurrent network load)
docker pull alpine:3.19
docker pull postgres:16-alpine

# Pull the large server image — retry if it times out
for i in 1 2 3 4 5; do
  docker pull ghcr.io/timexx/controlsphere:latest && break
  echo "Attempt $i failed, retrying in 30s..."
  sleep 30
done

# Now start Compose (images are already cached)
cd /volume1/docker/controlsphere
docker compose up -d
```

---

## Solution 3 — Adjust Docker daemon timeout (advanced)

On Synology DSM, you can increase the Docker daemon's timeout:

```bash
# SSH into Synology as root
sudo su -

# Edit Docker daemon config
cat > /var/packages/ContainerManager/etc/dockerd.json.tmp << 'EOF'
{
  "max-concurrent-downloads": 1,
  "storage-driver": "btrfs"
}
EOF

# Merge with existing config if present, then restart Docker
cp /var/packages/ContainerManager/etc/dockerd.json /var/packages/ContainerManager/etc/dockerd.json.bak 2>/dev/null || true
mv /var/packages/ContainerManager/etc/dockerd.json.tmp /var/packages/ContainerManager/etc/dockerd.json
synopkg restart ContainerManager
```

> **Note**: The exact config path varies by DSM version. On older DSM versions, the package is called `Docker` instead of `ContainerManager`.

---

## Synology-specific notes

### Ports

ControlSphere uses these ports by default:

| Port | Service | Configurable via |
|------|---------|-----------------|
| 3000 | Web UI + WebSocket | `PORT` env variable |

Make sure port 3000 (or your custom port) is open in:
- **DSM Firewall** (*Control Panel → Security → Firewall*)
- **Your router** (if accessing from outside your LAN)

### File paths

| NAS | Typical Docker path |
|-----|-------------------|
| Synology | `/volume1/docker/controlsphere` |
| QNAP | `/share/Container/controlsphere` |

### Resource limits

NAS systems often have limited RAM. Start with the **Micro** profile (512 MB server + 256 MB Postgres).
The `docker-compose.nas.yml` file uses this profile by default.

### DSM Container Manager GUI

If you prefer using the Synology GUI instead of SSH:

1. Open **Container Manager → Project**
2. Click **Create**
3. Set the path to your cloned `controlsphere` directory
4. Select `docker-compose.nas.yml` as the compose file
5. Click **Build & Start**

---

## Troubleshooting

**Build fails with "no space left on device"**
```bash
docker system prune -a    # remove unused images/containers
```

**Container restarts in a loop**
```bash
docker compose -f docker-compose.nas.yml logs -f server
```

**Cannot connect to web UI**
- Check that port 3000 is not blocked by DSM firewall
- Try `http://your-nas-ip:3000` (not `https`)
- Verify container is running: `docker compose -f docker-compose.nas.yml ps`

**Permission denied errors**
```bash
# Synology: ensure the docker group has access
sudo chown -R :docker /volume1/docker/controlsphere
```
