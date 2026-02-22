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

No installation, no prerequisites. PostgreSQL is included.

```bash
# 1. Copy env template
cp .env.docker.example .env

# 2. Open .env and set POSTGRES_PASSWORD to a strong password

# 3. Start everything
docker compose up -d
```

Open **http://localhost:3000** — done.

> `JWT_SECRET` and `SESSION_TOKEN_SECRET` are generated automatically on first startup and persisted in a Docker volume. No action needed.

**Useful Docker commands:**
```bash
docker compose logs -f server       # follow server logs
docker compose logs -f postgres     # follow database logs
docker compose down                 # stop
docker compose down -v              # stop + delete all data
docker compose up -d --build        # rebuild after a code change
```

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
