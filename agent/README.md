# Maintainer Agent

A lightweight agent that connects to the Maintainer server for remote system monitoring and management.

## Installation

### Quick Install

```bash
# Download and build
cd /tmp
git clone <your-repo>
cd agent
go build -o maintainer-agent

# Create config directory
sudo mkdir -p /etc/maintainer-agent

# Generate a secret key and save config
cat > /tmp/config.json <<EOF
{
  "server_url": "ws://YOUR_SERVER_IP:3000/ws/agent",
  "secret_key": "$(openssl rand -hex 32)"
}
EOF

sudo mv /tmp/config.json /etc/maintainer-agent/config.json

# Install binary
sudo mv maintainer-agent /usr/local/bin/

# Print the secret key (save this!)
cat /etc/maintainer-agent/config.json
```

### Systemd Service

Create `/etc/systemd/system/maintainer-agent.service`:

```ini
[Unit]
Description=Maintainer Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/maintainer-agent -config /etc/maintainer-agent/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable maintainer-agent
sudo systemctl start maintainer-agent
sudo systemctl status maintainer-agent
```

## Usage

### Manual Run

```bash
maintainer-agent -server ws://server:3000/ws/agent -key YOUR_SECRET_KEY
```

### Configuration File

Create `/etc/maintainer-agent/config.json`:

```json
{
  "server_url": "ws://server:3000/ws/agent",
  "secret_key": "your-secret-key-here"
}
```

Then run:

```bash
maintainer-agent -config /etc/maintainer-agent/config.json
```

## Features

- ✅ Real-time system metrics (CPU, RAM, Disk, Uptime)
- ✅ Remote command execution
- ✅ Interactive terminal (SSH-like)
- ✅ Auto-reconnect on connection loss
- ✅ Secure authentication with secret keys
- ✅ Zero dependencies (single binary)

## Building

```bash
go build -o maintainer-agent
```

Cross-compile for Linux:

```bash
GOOS=linux GOARCH=amd64 go build -o maintainer-agent-linux-amd64
```
