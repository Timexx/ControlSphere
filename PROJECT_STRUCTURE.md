# MaintainerWeb System - Projekt Struktur

```
Maintainer/
│
├── README.md                    # Vollständige Dokumentation
├── QUICKSTART.md                # 5-Minuten Quick-Start Guide
├── .gitignore                   # Git Ignore Rules
│
├── setup-server.sh              # Server Setup Script
├── build-agent.sh               # Agent Build Script
├── install-agent.sh             # Agent Installation Script (für VMs)
│
├── server/                      # 🌐 Next.js Web Server
│   ├── package.json             # Node.js Dependencies
│   ├── tsconfig.json            # TypeScript Config
│   ├── next.config.js           # Next.js Config
│   ├── tailwind.config.ts       # Tailwind CSS Config
│   ├── postcss.config.js        # PostCSS Config
│   ├── server.js                # Custom Server (WebSocket)
│   │
│   ├── prisma/
│   │   └── schema.prisma        # Database Schema (SQLite)
│   │
│   └── src/
│       ├── app/
│       │   ├── layout.tsx       # Root Layout
│       │   ├── globals.css      # Global Styles
│       │   ├── page.tsx         # 📊 Dashboard (VM Grid)
│       │   │
│       │   ├── machine/
│       │   │   └── [id]/
│       │   │       └── page.tsx # 🖥️ VM Detail Page
│       │   │
│       │   └── api/
│       │       ├── machines/
│       │       │   ├── route.ts           # GET /api/machines
│       │       │   └── [id]/route.ts      # GET /api/machines/:id
│       │       └── register/route.ts       # POST /api/register
│       │
│       ├── components/
│       │   └── Terminal.tsx     # 💻 Terminal Component (xterm.js)
│       │
│       └── lib/
│           ├── prisma.ts        # Prisma Client Instance
│           ├── websocket.ts     # 🔌 WebSocket Server Logic
│           └── utils.ts         # Utility Functions
│
└── agent/                       # 🤖 Go Agent
    ├── go.mod                   # Go Dependencies
    ├── main.go                  # Main Agent Logic
    ├── README.md                # Agent Dokumentation
    └── .gitignore
```

## 📁 Wichtige Dateien Erklärt

### Server

#### Core Files
- **`server.js`**: Custom HTTP Server mit Socket.io Integration
- **`src/lib/websocket.ts`**: WebSocket Event Handling für Agents und Web Clients
- **`src/lib/prisma.ts`**: Database Connection Singleton

#### UI Pages
- **`src/app/page.tsx`**: Dashboard mit VM Grid, Live Updates
- **`src/app/machine/[id]/page.tsx`**: Detail-Ansicht einer VM
- **`src/components/Terminal.tsx`**: xterm.js Terminal Component

#### API Routes
- **`/api/machines`**: Liste aller VMs
- **`/api/machines/[id]`**: Detail-Daten einer VM
- **`/api/register`**: Neue VM registrieren

#### Database
- **`prisma/schema.prisma`**: 
  - `Machine` Model: VMs mit Status, IP, OS Info
  - `Metric` Model: Zeitreihen-Daten (CPU, RAM, Disk)
  - `Command` Model: Command History

### Agent

- **`main.go`**: 
  - WebSocket Client
  - System Metrics Collection (gopsutil)
  - PTY Terminal Support (creack/pty)
  - Command Execution
  - Heartbeat Logic

## 🔌 Kommunikations-Flow

```
┌─────────────┐          WebSocket          ┌─────────────┐
│             │◄────────────────────────────►│             │
│  Web Client │   /web namespace            │   Server    │
│  (Browser)  │                              │  (Next.js)  │
│             │                              │             │
└─────────────┘                              └──────┬──────┘
                                                    │
                                                    │ WebSocket
                                                    │ /agent namespace
                                                    │
                                             ┌──────▼──────┐
                                             │             │
                                             │   Agent     │
                                             │   (Go)      │
                                             │             │
                                             └─────────────┘
```

### Events

#### Agent → Server
- `register`: Initial registration mit OS Info
- `heartbeat`: Metrics alle 5 Sekunden
- `command_response`: Output von executed command
- `terminal_data`: Terminal output

#### Server → Agent
- `execute_command`: Command ausführen
- `spawn_shell`: PTY Shell starten
- `terminal_stdin`: Input für Terminal
- `terminal_resize`: Terminal Größe ändern

#### Server → Web Client
- `machine_status_changed`: Status Update (online/offline)
- `machine_metrics`: Neue Metrics verfügbar
- `command_completed`: Command fertig
- `terminal_output`: Terminal output

## 🎨 Design System

### Colors
- **Primary**: Blue (#0ea5e9) - Haupt-Actions
- **Success**: Green (#10b981) - Online, Success
- **Warning**: Orange/Yellow (#f59e0b) - Warnings
- **Danger**: Red (#ef4444) - Errors, Offline
- **Gray**: Backgrounds, Text

### Components
- Cards mit `rounded-xl` und `shadow-md`
- Hover Effects: `hover:shadow-xl`, `hover:scale-[1.02]`
- Transitions: `transition-all duration-200`
- Status Indicators: `animate-pulse` für Online
- Gradients: `bg-gradient-to-br from-gray-50 to-gray-100`

## 🔐 Security Notes

- **Secret Keys**: 64-char hex (256-bit)
- **Authentication**: Per Secret Key bei WebSocket connect
- **Connection Direction**: Agent connects OUT (keine Firewall Issues)
- **Root Access**: Agent läuft als root für System-Management

## 📦 Dependencies

### Server (Node.js)
- `next` 14.2.15 - React Framework
- `react` 18.3.1 - UI Library
- `@prisma/client` - Database ORM
- `socket.io` - WebSocket Server
- `socket.io-client` - WebSocket Client (für Web UI)
- `xterm` - Terminal Emulator
- `tailwindcss` - CSS Framework
- `lucide-react` - Icons
- `date-fns` - Date Formatting

### Agent (Go)
- `gorilla/websocket` - WebSocket Client
- `creack/pty` - PTY Support
- `shirou/gopsutil` - System Metrics

## 🚀 Deployment Checklist

### Server
- [ ] Set `NODE_ENV=production`
- [ ] Configure `DATABASE_URL` (SQLite path)
- [ ] Set up reverse proxy (nginx/Apache)
- [ ] Enable HTTPS
- [ ] Configure firewall (Port 3000 oder 80/443)

### Agent
- [ ] Build for target platform (Linux AMD64/ARM64)
- [ ] Generate unique Secret Key per machine
- [ ] Install systemd service
- [ ] Configure auto-start
- [ ] Test connection

## 📊 Database Schema Visual

```
┌─────────────────┐
│    Machine      │
├─────────────────┤
│ id              │◄──────┐
│ hostname        │       │
│ ip              │       │
│ osInfo (JSON)   │       │
│ status          │       │
│ secretKey       │       │
│ lastSeen        │       │
└─────────────────┘       │
                          │
                 ┌────────┴────────┐
                 │                 │
        ┌────────▼───────┐  ┌──────▼──────┐
        │    Metric      │  │   Command   │
        ├────────────────┤  ├─────────────┤
        │ id             │  │ id          │
        │ machineId (FK) │  │ machineId   │
        │ cpuUsage       │  │ command     │
        │ ramUsage       │  │ output      │
        │ diskUsage      │  │ exitCode    │
        │ uptime         │  │ status      │
        │ timestamp      │  │ createdAt   │
        └────────────────┘  └─────────────┘
```

## 🔄 Typical Workflows

### New VM Registration
1. Admin installiert Agent auf VM
2. Agent startet, sendet `register` event
3. Server erstellt `Machine` entry in DB
4. Server sendet `registered` confirmation
5. Agent startet Heartbeat (alle 5s)
6. Web Dashboard zeigt neue VM

### Remote Command Execution
1. Admin klickt "System Update" in Web UI
2. Web Client sendet `execute_command` via WebSocket
3. Server empfängt, erstellt `Command` entry
4. Server forwarded an Agent
5. Agent führt aus, sendet `command_response`
6. Server updated `Command` entry
7. Web Client zeigt Result

### Interactive Terminal
1. Admin klickt "Terminal öffnen"
2. Web Client sendet `spawn_terminal`
3. Server forwarded an Agent
4. Agent startet PTY Shell
5. Bidirectional data flow:
   - User input → Server → Agent → Shell
   - Shell output → Agent → Server → User
6. Terminal zeigt interaktive Shell

---

**Projekt Status**: ✅ Production Ready

Alle Core Features implementiert und getestet!
