# ControlSphere ![Beta](https://img.shields.io/badge/status-beta-orange) ![License](https://img.shields.io/badge/license-Apache%202.0-blue)

**Your entire infrastructure. One dashboard. Zero complexity.**

ControlSphere gives you real-time visibility and full control over all your Linux systems — from a single, open-source web interface. Monitor live metrics, run terminal sessions, scan for CVEs, and manage packages across dozens of servers simultaneously. No SaaS subscriptions. No vendor lock-in. Runs entirely on your own hardware.

Born from the need to manage servers without the cost of large operators, and made fully available under the Apache 2.0 licence so every company and organisation can deploy, adapt, and benefit freely.

---

## What it looks like

### Live System Monitoring
![Live Telemetry Dashboard](docs/img/Live_Telemetry.png)
*Real-time CPU, RAM, disk usage, and uptime across all connected systems*

### System Details & Remote Terminal
![System Details](docs/img/System_Details.png)
*Full system info, live metrics, interactive terminal, and one-click actions — in one view*

### Security & CVE Overview
![Security Dashboard](docs/img/Security_Details.png)
*CVE matches, security events, package health, and audit logs across your entire fleet*

### Secure Login
![Login Screen](docs/img/Login.png)
*JWT-based authentication with a clean, modern interface*

---

## Why ControlSphere

| | ControlSphere | Typical SaaS tools |
|---|---|---|
| Cost | Free, self-hosted | $50–$500 / month |
| Data ownership | 100% yours | Vendor's servers |
| CVE scanning | Built-in, offline | Add-on or missing |
| Agent footprint | Single Go binary | Heavy daemons |
| Setup time | ~2 minutes | Hours of config |
| Open source | Apache 2.0 | Rarely |

---

## Get started in 2 minutes

### 🐳 Option A — Docker (recommended for testing & production)

Truly zero-config. No `.env` file, no passwords, no prerequisites.

> **[→ docker-compose.yml](docker-compose.yml)** — open, copy, deploy. That's it.

```bash
docker compose up -d
```

Open **http://localhost:3000** — done.

All secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_TOKEN_SECRET`) are generated automatically on first startup and persisted in a Docker volume. PostgreSQL is included and runs internally — never exposed to the network. The server image is pulled directly from GitHub Container Registry — no clone or build required.

> **TrueNAS / Portainer / Unraid**: Just paste the `docker-compose.yml` content into your custom app YAML editor and deploy. The image is pulled automatically from `ghcr.io/timexx/controlsphere:latest`. Nothing else needed.

**Useful Docker commands:**
```bash
docker compose logs -f server       # follow server logs
docker compose logs -f postgres     # follow database logs
docker compose down                 # stop
docker compose down -v              # stop + delete all data (resets secrets)
docker compose up -d --build        # rebuild after a code change
```

**Want to override secrets?** Set any of these as environment variables in a `.env` file or in your container platform:
- `POSTGRES_PASSWORD` — database password
- `JWT_SECRET` — JWT signing key
- `SESSION_TOKEN_SECRET` — session HMAC key
- `PORT` — host port (default: 3000)

---

### ⚙️ Capacity & resource configuration

Pick the profile that matches your fleet size, then copy the YAML snippets into [`docker-compose.yml`](docker-compose.yml).

| Profile | Agents | Server CPU | Server RAM | Postgres RAM | Disk | Metrics growth/day |
|---------|-------:|:----------:|:----------:|:------------:|:----:|:-----------------:|
| **Micro** | 1 – 10 | 0.5 vCPU | 512 MB | 256 MB | 20 GB | ~6 MB |
| **Small** | 10 – 50 | 1 vCPU | 1 GB | 512 MB | 50 GB | ~56 MB |
| **Medium** | 50 – 200 | 2 vCPU | 2 GB | 1 GB | 200 GB | ~225 MB |
| **Large** | 200 – 500 | 4 vCPU | 4 GB | 2 GB | 500 GB | ~560 MB |

> **Note on disk:** The `Metric` table has no automatic pruning. Each agent writes one row every ~15 s — disk consumption grows indefinitely. Plan for at least 6 months of the listed daily rate or add a cron job to `DELETE FROM "Metric" WHERE "createdAt" < NOW() - INTERVAL '90 days'`.

<details>
<summary><strong>Micro</strong> — up to 10 agents</summary>

Add or merge the following blocks into [`docker-compose.yml`](docker-compose.yml):

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          memory: 256M
    environment:
      HEARTBEAT_METRICS_INTERVAL_MS: 30000   # 30 s (default 15 s)
      HEARTBEAT_PORTS_INTERVAL_MS: 120000    # 2 min (default 60 s)

  postgres:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          memory: 128M
    command: >
      postgres
        -c shared_buffers=64MB
        -c max_connections=20
```
</details>

<details>
<summary><strong>Small</strong> — 10 – 50 agents</summary>

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          memory: 512M
    environment:
      HEARTBEAT_METRICS_INTERVAL_MS: 30000
      HEARTBEAT_PORTS_INTERVAL_MS: 120000

  postgres:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          memory: 256M
    command: >
      postgres
        -c shared_buffers=128MB
        -c max_connections=40
```
</details>

<details>
<summary><strong>Medium</strong> — 50 – 200 agents</summary>

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          memory: 1G
    environment:
      HEARTBEAT_METRICS_INTERVAL_MS: 30000
      HEARTBEAT_PORTS_INTERVAL_MS: 120000

  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          memory: 512M
    command: >
      postgres
        -c shared_buffers=256MB
        -c max_connections=100
```
</details>

<details>
<summary><strong>Large</strong> — 200 – 500 agents</summary>

```yaml
services:
  server:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          memory: 2G
    environment:
      HEARTBEAT_METRICS_INTERVAL_MS: 60000   # 60 s — reduce DB write rate at scale
      HEARTBEAT_PORTS_INTERVAL_MS: 300000    # 5 min

  postgres:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 2G
        reservations:
          memory: 1G
    command: >
      postgres
        -c shared_buffers=512MB
        -c max_connections=200
        -c work_mem=4MB
```
</details>

---

### 🔌 Automatic DB connection pool sizing

Prisma's default pool is ~10 connections. With many agents writing metrics simultaneously this becomes a bottleneck. Use the formula below to derive the right value for your fleet:

$$\text{connection\_limit} = \max\!\left(10,\;\left\lfloor \text{agents} \times 0.25 \right\rfloor\right)$$

| Profile | Agents | `connection_limit` |
|---------|-------:|:------------------:|
| Micro | 10 | 10 |
| Small | 50 | 13 |
| Medium | 200 | 50 |
| Large | 500 | 125 |

**Calculate your value before deploying:**
```bash
AGENTS=50   # ← set your agent count
LIMIT=$(( AGENTS / 4 > 10 ? AGENTS / 4 : 10 ))
echo "Use connection_limit=${LIMIT}"
```

Then add a `DATABASE_URL` entry to the `server` service in [`docker-compose.yml`](docker-compose.yml):
```yaml
services:
  server:
    environment:
      DATABASE_URL: "postgresql://maintainer:${POSTGRES_PASSWORD}@postgres:5432/maintainer?connection_limit=${LIMIT}&pool_timeout=10"
```

> For Large deployments (200+ agents) consider adding [PgBouncer](https://www.pgbouncer.org/) in front of Postgres and setting `connection_limit=10` on the Prisma side — PgBouncer then handles the multiplexing.

---

### 🖥️ Option B — Native install (Debian/Ubuntu, RHEL, macOS, Alpine)

One script. No prerequisites.

```bash
sudo ./setup-server.sh
```

The script fully automates:
- ✅ Node.js 20 LTS (installs or upgrades automatically)
- ✅ PostgreSQL (installs if missing)
- ✅ Database user, database, and password (auto-generated)
- ✅ `JWT_SECRET` and `SESSION_TOKEN_SECRET` (generated via `openssl rand`)
- ✅ `server/.env` configured — nothing to edit manually
- ✅ npm dependencies, Prisma client, and database migrations

Then start the server:
```bash
cd server && npm run dev          # development
# — or —
cd server && npm run build && npm start   # production
```

Server runs at **http://localhost:3000**.

---

### 🤖 Adding systems (agents)

Once the server is running, open the dashboard and click **"+ Agent"** in the top bar. You'll see a ready-to-run install command — copy it and paste it into any Linux system you want to monitor:

```bash
curl -sSL https://your-server/install-agent.sh | sudo bash
```

The agent installs itself as a systemd service and the system appears in your dashboard automatically. Nothing else to configure.

**What the agent installer does:**
- Downloads the compiled binary for your architecture (amd64 / arm64)
- Writes `/etc/maintainer-agent/config.json`
- Registers and starts the `maintainer-agent` systemd service
- Connects to your server — and reconnects automatically after every reboot

---

## Features

**Monitoring & Visibility**
- Real-time CPU, RAM, disk, and uptime metrics across all systems
- Live status indicators (online / offline / error)
- Historical metric charts

**Fleet Management**
- Bulk operations: update all systems, run commands on multiple servers at once
- One-click quick actions: system update, reboot, custom commands
- Full command history per system

**Remote Access**
- Web-based interactive terminal with PTY support (SSH-like, directly in the browser)
- Copy & paste, dynamic resizing, coloured output
- Encrypted connection with fingerprint verification and full audit logging

**Security & Compliance**
- Automatic CVE database download — all packages matched against known vulnerabilities
- CSV export for audit reports and compliance documentation
- Port scanning — monitors all open ports across your fleet
- Package security scanner — highlights outdated packages that need updates
- Security event dashboard

**System & Access**
- JWT-based authentication
- Auto-discovery — agents register themselves on first connect
- Zero-config agent — single static binary, no external dependencies
- German and English UI

---

## Security model

- Every agent has a unique secret key — no shared credentials
- Agents connect **outbound only** — no inbound firewall rules needed
- All WebSocket connections are authenticated via JWT
- PTY sessions are encrypted and fingerprinted; every command is audit-logged
- Root access on agents is used only for system management operations

---

## Troubleshooting

**Agent does not appear in the dashboard**
```bash
sudo journalctl -u maintainer-agent -f       # live logs
sudo systemctl status maintainer-agent       # service status

# Test connection manually
/usr/local/bin/maintainer-agent -server ws://your-server:3000/ws/agent -key your-key
```

**Server does not start**
```bash
./setup-server.sh        # re-running the script fixes most issues
lsof -i :3000            # check if port is in use
cd server && npm run dev # shows detailed startup errors
```

---

## Development

**Server**
```bash
cd server
npm run dev            # start dev server with hot reload
npm run prisma:studio  # open database GUI
npm run lint           # lint
npm run test           # run tests
```

**Agent**
```bash
cd agent
go run main.go -server ws://localhost:3000/ws/agent -key test-key
go build               # build binary
```

**Cross-compile agent**
```bash
GOOS=linux GOARCH=amd64 go build -o maintainer-agent-linux-amd64
GOOS=linux GOARCH=arm64 go build -o maintainer-agent-linux-arm64
```

**Rebuild and deploy agents**
```bash
./rebuild-and-deploy-agents.sh
```

---

## Architecture

```
Browser  ──WebSocket──►  Next.js Server (Node.js)  ◄──WebSocket──  Go Agent (per system)
                               │
                         PostgreSQL (Prisma)
```

- **Server**: Next.js 14 App Router · Tailwind CSS · PostgreSQL via Prisma · Socket.io · WebSocket
- **Agent**: Single Go binary · gopsutil (metrics) · creack/pty (terminal) · gorilla/websocket

---

## Roadmap

- [x] Real-time monitoring dashboard
- [x] Remote terminal (PTY, encrypted, audit-logged)
- [x] Bulk operations across fleet
- [x] CVE scanning with CSV export
- [x] Historical metric charts
- [x] Package security scanner
- [x] Port monitoring
- [x] Audit logging
- [ ] Multi-user support with roles
- [ ] Alert system (email / Slack / webhook for threshold events)
- [ ] File manager
- [ ] Custom scripts library

---

## License

ControlSphere is licensed under the **Apache License, Version 2.0** (SPDX: `Apache-2.0`).

**Copyright © 2025 Tim Klement**

```
http://www.apache.org/licenses/LICENSE-2.0
```

Distributed on an **"AS IS"** basis, without warranties or conditions of any kind.  
By contributing to this repository, you agree your contributions are licensed under the same Apache-2.0 licence.

---

*Built and maintained by **Tim Klement** · Contributions welcome · [Apache 2.0](http://www.apache.org/licenses/LICENSE-2.0)*
