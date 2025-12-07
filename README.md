# ControlSphere ![Beta](https://img.shields.io/badge/status-beta-orange)

A modern, web-based platform for managing and monitoring multiple Linux systems.

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
- SQLite database (via Prisma)  
- WebSocket communication for real-time updates  
- Socket.io for bidirectional events  

### Agent (Go)
- Single self-contained binary  
- Runs on any Linux system  
- Collects system metrics  
- PTY support for interactive terminal sessions – with encrypted connection and fingerprint including audit logging
- Auto-reconnect on connection loss  

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

Create a `.env` file in `server/`:

```env
DATABASE_URL="file:./dev.db"
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

## 📄 License & Terms of Use

### ❤️ Open Source Spirit with a Future
ControlSphere is developed with ❤️ and is currently **free** for everyone. I believe in open source and want you to be able to use the system freely – today and, hopefully, in the future as well.

### Current Usage (Free)
- **Professional use**: Ideal for admins and DevOps teams  
- **Personal projects**: Use it for your own systems  
- **Learning & experimentation**: Perfect for trying things out and learning  
- **All features**: Full functionality is available  

### Future Development
To ensure the long-term development of ControlSphere, I reserve the right to offer commercial options in the future. These could include premium features, dedicated support, or enterprise editions.

### Fair Rules
- **Redistribution**: Feel free to share with friends and colleagues!  
- **No resale**: Neither the original code nor modified versions may be sold  
- **Feedback**: I appreciate issues, feature requests, and contributions  
- **Respect**: Please respect copyrights and intellectual property  

### Contact & Support
Got questions or ideas? [Email Tim Klement](mailto:46tonal_verstand@icloud.com)

**Thank you for your interest in ControlSphere!** 🚀

## 👨‍💻 Author

Tim Klement

---

### 📄 License (NCRL 1.2)

ControlSphere is provided under the **Non-Commercial Redistribution License (NCRL)**.

**Copyright (c) 2025 Tim Klement. All rights reserved.**

#### 1. Permitted Use
Organizations and individuals may use, run, and modify this Software free of charge for internal purposes, including internal commercial use.  
Internal hosting, including cloud deployment for an organization’s own operations, is permitted.

#### 2. Restrictions
(a) Selling, licensing, renting, or otherwise commercially redistributing this Software or any derivative work is strictly prohibited.  
(b) The Software may not be used to provide Software-as-a-Service (SaaS), hosted services, cloud services, API-as-a-Service offerings, multi-tenant platforms, or any other service to third parties, whether paid or unpaid. **Internal hosting for the organization’s own operations is permitted.**  
(c) Public distribution of modified or unmodified versions is permitted only if distributed free of charge and under this same License.  
(d) Removal or alteration of copyright notices is prohibited.

#### 3. No Warranty
This Software is provided “as is,” without warranty of any kind, express or implied. Use at your own risk.

#### 4. Termination
Any violation of this License terminates all granted rights immediately.
