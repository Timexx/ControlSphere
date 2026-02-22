# ControlSphere ![Beta](https://img.shields.io/badge/status-beta-orange)

This is a modern, web-based platform for managing and monitoring multiple Linux systems, with lightweight agents installed on each system. 

The project was born from the idea of managing my servers more efficiently without spending money on large operators. 
To support EU states in the open-source initiative, I am making the entire project available under the Apache 2 licence so that all companies and organisations can benefit from a free option they can adapt to their own needs. Everything is designed to ensure the highest possible level of security.

I will continue to develop the project, so please join me in promoting open source! 

## 🚀 Features

- **Real-time Monitoring**: Live CPU, RAM, disk, and uptime metrics  
- **Bulk Management**: Manage and update multiple systems simultaneously  
- **Remote Terminal**: Web-based, SSH-like interactive shell access to each system  
- **Security Dashboard**: Monitor security events and system health  
- **Port Scanning**: Automatically scans and monitors open ports on all systems  
- **Package Security**: Scans all installed packages and warns about outdated packages requiring updates  
- **JWT Authentication**: Secure token-based login  
- **Quick Actions**: One-click system updates, reboots, and more  
- **Auto-Discovery**: Systems automatically register with the server  
- **Zero-Config Agent**: Self-contained single binary with no external dependencies  
- **Multiple languages**: German and English are currently supported
- **Modern interfacet**: with an intuitive user experience and modern design

And so much more to discover 🧭

## 📋 Architecture

### Server (Next.js)
- Modern Next.js 14 App Router  
- Tailwind CSS for a premium, consistent UI  
- PostgreSQL database (via Prisma)  
- WebSocket communication for real-time updates  
- Socket.io for bidirectional events  

### Agent (Go)
- Single self-contained binary  
- Runs on any Linux system  
- Collects system metrics  
- PTY support for interactive terminal sessions – with encrypted connection and fingerprint including audit logging
- Auto-reconnect on connection loss  

## ✅ Prerequisites

Before you start, make sure the following is available on your server:

- **Node.js** 18+ (installed automatically by the setup script)
- **PostgreSQL** 14+ (must be installed and running)
- A **PostgreSQL user and database** for the application

#### Quick PostgreSQL setup

Run the following as the `postgres` superuser (e.g. `sudo -u postgres psql`):

```sql
CREATE USER maintainer WITH PASSWORD 'your-strong-password';
CREATE DATABASE maintainer OWNER maintainer;
GRANT ALL PRIVILEGES ON DATABASE maintainer TO maintainer;
```

#### Environment configuration

Copy the example env file and fill in your values:

```bash
cp server/.env.example server/.env
```

Then open `server/.env` and set at minimum:

| Variable | Description | How to generate |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | See example in `.env.example` |
| `JWT_SECRET` | JWT signing secret | `openssl rand -base64 64` |
| `SESSION_TOKEN_SECRET` | Session HMAC key | `openssl rand -hex 32` |

---

## 🛠️ Installation

### Server Setup (Recommended)

The setup script handles everything automatically:

```bash
sudo ./setup-server.sh
```

The script performs:
- ✅ **Node.js installation** (if missing or outdated)  
- ✅ **Install npm dependencies** (with retry logic)  
- ✅ **Generate Prisma client**  
- ✅ **Run database migrations**  

**Supported Operating Systems:**  
- Debian/Ubuntu (via NodeSource)  
- macOS (via Homebrew) ![Not Tested](https://img.shields.io/badge/tested-no-lightgrey)  
- RHEL/CentOS/Fedora (via NodeSource) ![Not Tested](https://img.shields.io/badge/tested-no-lightgrey)  
- Alpine Linux (via apk) ![Not Tested](https://img.shields.io/badge/tested-no-lightgrey)  

After setup:
```bash
cd server && npm run dev
```

The server runs at `http://localhost:3000`.

### Production Server

```bash
cd server
npm run build
npm start
```

> **Note**: If you haven't set up the server yet, run `./setup-server.sh` first in the server folder.

### Agent Setup

After logging into the dashboard, you will find a **"+ Agent"** button in the top bar. It shows you the exact installation command you must run on every VM you want to monitor.

#### Automatic Installation

```bash
curl -sSL https://your-server/install-agent.sh | sudo bash
```

The command is generated automatically and includes all required parameters for your server configuration. Simply copy the displayed command and execute it on your client systems.

#### What happens during installation?

- ✅ **Agent binary** is automatically created on the client
- ✅ **Configuration** is created automatically  
- ✅ **Systemd service** is registered  
- ✅ **Automatic startup** on system boot
- ✅ **Secure communication** with your server for remote terminal connections 

After the installation, the VM will automatically appear in your dashboard.

## 📖 Usage

### Dashboard
- Open `http://your-server:3000`
- View all registered VMs
- Status indicator shows online/offline
- Live metrics for CPU, RAM, and disk
- Click on a System to view details

### VM Detail Page
- **System Info**: OS, kernel, hostname, IP  
- **Live Metrics**: Real-time graphs and values  
- **Terminal**: Open an interactive terminal session  
- **Quick Actions**:
  - System update (`apt update && apt upgrade -y`)
  - Reboot
  - Execute custom commands  
- **Command History**: View all executed commands

### Terminal
- Full-featured terminal in the web UI  
- Bash shell with PTY support  
- Supports copy & paste  
- Supports dynamic resizing  
- Colored output  


## 📸 Features in Action

### Secure Login
![Login Screen](docs/img/Login.png)
*Secure JWT-based authentication with modern interface*

### Live System Monitoring
![Live Telemetry Dashboard](docs/img/Live_Telemetry.png)
*Real-time monitoring of CPU, RAM, disk usage, and system uptime across all connected VMs*

### System Details & Management
![System Details](docs/img/System_Details.png)
*Comprehensive system information with interactive terminal access and quick actions*

### Security Overview
![Security Dashboard](docs/img/Security_Details.png)
*Monitor security events, package updates, and system health across your infrastructure*

## 🔒 Security

- Each VM has a unique secret key  
- WebSocket connections are authenticated  
- The agent connects outbound only (no firewall issues)  
- Root access is used only when necessary  

## 🧰 Development

### Server
```bash
cd server
npm run dev           # start dev server
npm run prisma:studio # open database GUI
npm run lint          # run code linting
```

> **First-time setup?** Use `./setup-server.sh` – the script configures everything automatically.

### Agent
```bash
cd agent
go run main.go -server ws://localhost:3000/ws/agent -key test-key
go build              # build binary
```

### Cross-Compile Agent

```bash
# Linux AMD64
GOOS=linux GOARCH=amd64 go build -o maintainer-agent-linux-amd64

# Linux ARM64 (Raspberry Pi, etc.)
GOOS=linux GOARCH=arm64 go build -o maintainer-agent-linux-arm64
```

## 📁 Project Structure

```
Maintainer/
├── server/              # Next.js server
│   ├── src/
│   │   ├── app/         # Next.js App Router
│   │   │   ├── page.tsx           # Dashboard
│   │   │   ├── machine/[id]/      # VM detail
│   │   │   └── api/               # API routes
│   │   ├── components/  # React components
│   │   │   └── Terminal.tsx
│   │   └── lib/         # Utils & core logic
│   │       ├── websocket.ts       # WebSocket server
│   │       ├── prisma.ts          # DB client
│   │       └── utils.ts
│   ├── prisma/          # Database schema
│   └── server.js        # Custom server (WebSocket)
│
└── agent/               # Go agent
    ├── main.go          # Main logic
    ├── go.mod           # Dependencies
    └── README.md
```

## 🎨 Design Philosophy

- **Resilient under stress**: clear hierarchy, no clutter  
- **Fast**: all critical information at a glance  
- **Modern**: gradient backgrounds, smooth animations  
- **Responsive**: works on desktop, tablet, and mobile  
- **Accessible**: strong contrast, keyboard navigation  

## 🔧 Configuration

### Server Environment Variables

Copy `server/.env.example` to `server/.env` and fill in your values:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://maintainer:your-password@localhost:5432/maintainer?schema=public&connection_limit=20"

# Generate with: openssl rand -base64 64
JWT_SECRET=

# Generate with: openssl rand -hex 32
SESSION_TOKEN_SECRET=

NODE_ENV=production
PORT=3000
```

### Agent Config

`/etc/maintainer-agent/config.json`:

```json
{
  "server_url": "ws://your-server:3000/ws/agent",
  "secret_key": "your-generated-secret-key"
}
```

## 🐛 Troubleshooting

### Agent does not connect

```bash
# Check logs
sudo journalctl -u maintainer-agent -f

# Check if service is running
sudo systemctl status maintainer-agent

# Test manual connection
/usr/local/bin/maintainer-agent -server ws://localhost:3000/ws/agent -key your-key
```

### Server does not start

```bash
# Run setup script again (fixes most issues)
./setup-server.sh

# Check if port is available
lsof -i :3000

# Check logs
cd server && npm run dev
```

## 📊 Database Schema

- **Machine**: VMs with status, hostname, IP, OS info  
- **Metric**: Time-series data for CPU, RAM, and disk  
- **Command**: History of all executed commands  

## 🚦 Status Logic

- **Online**: Agent is connected, heartbeat < 10 seconds old  
- **Offline**: No connection or heartbeat > 10 seconds old  
- **Error**: Error on last command  

## 📝 TODO / Future Features

- [ ] Multi-user support with roles  
- [ ] Alert system (email/Slack for high CPU, etc.)  
- [x] Historical charts (Chart.js)  
- [ ] File manager for VM files  
- [x] Log viewer for VM logs  
- [x] Batch operations (update all VMs)  
- [ ] Custom scripts library  

## 📄 License

ControlSphere is licensed under the **Apache License, Version 2.0** (SPDX: `Apache-2.0`).

**Copyright (c) 2025 Tim Klement**

You may obtain a copy of the License at:
```text
http://www.apache.org/licenses/LICENSE-2.0
```

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an **"AS IS"** basis, **WITHOUT WARRANTIES OR CONDITIONS** of any kind.

### Contributions

By contributing to this repository, you agree that your contributions will be licensed under the same **Apache-2.0** license.

## 👨‍💻 Author

Tim Klement
