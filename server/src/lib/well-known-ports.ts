/**
 * Comprehensive well-known port lookup based on IANA assignments and
 * the Wikipedia "List of TCP and UDP port numbers" reference.
 *
 * Used to enrich port displays in the security UI when the agent
 * reports "Unknown" or an empty service name.
 *
 * Each entry may specify applicable protocols. When `proto` is omitted
 * the mapping applies to both TCP and UDP.
 */

export type PortInfo = {
  /** Short canonical service name, e.g. "SSH" */
  name: string
  /** Human-readable description */
  description: string
  /** Optional protocol restriction – if omitted, applies to tcp+udp */
  proto?: 'tcp' | 'udp'
  /** Security risk hint */
  risk?: 'info' | 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Confidence level returned when looking up a port:
 *  - "confirmed"  – agent already reported a known name
 *  - "identified" – matched a well-known / IANA-assigned port
 *  - "guess"      – matched a commonly-used registered port
 */
export type PortConfidence = 'confirmed' | 'identified' | 'guess'

export type PortLookupResult = PortInfo & { confidence: PortConfidence }

// ──────────────────────────────────────────────
//  Well-known ports 0–1023 (IANA system ports)
// ──────────────────────────────────────────────
const WELL_KNOWN_PORTS: Record<number, PortInfo | PortInfo[]> = {
  1:    { name: 'TCPMUX', description: 'TCP Port Service Multiplexer', risk: 'low' },
  5:    { name: 'RJE', description: 'Remote Job Entry', risk: 'low' },
  7:    { name: 'Echo', description: 'Echo Protocol', risk: 'low' },
  9:    { name: 'Discard', description: 'Discard Protocol / Wake-on-LAN (UDP)', risk: 'low' },
  11:   { name: 'Systat', description: 'Active Users (systat)', risk: 'low' },
  13:   { name: 'Daytime', description: 'Daytime Protocol (RFC 867)', risk: 'low' },
  17:   { name: 'QOTD', description: 'Quote of the Day', risk: 'low' },
  19:   { name: 'Chargen', description: 'Character Generator Protocol', risk: 'medium' },
  20:   { name: 'FTP Data', description: 'FTP – Datenkanal', proto: 'tcp', risk: 'medium' },
  21:   { name: 'FTP', description: 'FTP – Steuerkanal (Klartext-Login)', proto: 'tcp', risk: 'high' },
  22:   { name: 'SSH', description: 'Secure Shell – verschlüsselter Fernzugriff', proto: 'tcp', risk: 'medium' },
  23:   { name: 'Telnet', description: 'Telnet – unverschlüsselter Fernzugriff', proto: 'tcp', risk: 'critical' },
  25:   { name: 'SMTP', description: 'Simple Mail Transfer Protocol', proto: 'tcp', risk: 'medium' },
  37:   { name: 'Time', description: 'Time Protocol (RFC 868)', risk: 'low' },
  42:   { name: 'WINS', description: 'Windows Internet Name Service', risk: 'low' },
  43:   { name: 'WHOIS', description: 'WHOIS-Protokoll', proto: 'tcp', risk: 'low' },
  49:   { name: 'TACACS', description: 'Terminal Access Controller Access-Control System', risk: 'medium' },
  53:   { name: 'DNS', description: 'Domain Name System', risk: 'low' },
  67:   { name: 'DHCP Server', description: 'Dynamic Host Configuration Protocol – Server', proto: 'udp', risk: 'low' },
  68:   { name: 'DHCP Client', description: 'Dynamic Host Configuration Protocol – Client', proto: 'udp', risk: 'low' },
  69:   { name: 'TFTP', description: 'Trivial File Transfer Protocol (keine Auth.)', proto: 'udp', risk: 'high' },
  70:   { name: 'Gopher', description: 'Gopher-Protokoll', proto: 'tcp', risk: 'low' },
  79:   { name: 'Finger', description: 'Finger-Protokoll (Benutzerinfo)', proto: 'tcp', risk: 'medium' },
  80:   { name: 'HTTP', description: 'Hypertext Transfer Protocol', proto: 'tcp', risk: 'info' },
  88:   { name: 'Kerberos', description: 'Kerberos-Authentifizierung', risk: 'medium' },
  102:  { name: 'ISO-TSAP', description: 'ISO Transport Service Access Point', proto: 'tcp', risk: 'low' },
  104:  { name: 'DICOM', description: 'Digital Imaging (ACSE)', proto: 'tcp', risk: 'low' },
  110:  { name: 'POP3', description: 'Post Office Protocol v3 (Klartext)', proto: 'tcp', risk: 'high' },
  111:  { name: 'SunRPC', description: 'Sun Remote Procedure Call (portmap)', risk: 'high' },
  113:  { name: 'Ident', description: 'Identification Protocol (RFC 1413)', proto: 'tcp', risk: 'medium' },
  119:  { name: 'NNTP', description: 'Network News Transfer Protocol', proto: 'tcp', risk: 'low' },
  123:  { name: 'NTP', description: 'Network Time Protocol', proto: 'udp', risk: 'low' },
  135:  { name: 'MS-RPC', description: 'Microsoft RPC Endpoint Mapper', proto: 'tcp', risk: 'high' },
  137:  { name: 'NetBIOS-NS', description: 'NetBIOS Name Service', proto: 'udp', risk: 'high' },
  138:  { name: 'NetBIOS-DGM', description: 'NetBIOS Datagram Service', proto: 'udp', risk: 'high' },
  139:  { name: 'NetBIOS-SSN', description: 'NetBIOS Session Service', proto: 'tcp', risk: 'high' },
  143:  { name: 'IMAP', description: 'Internet Message Access Protocol', proto: 'tcp', risk: 'medium' },
  161:  { name: 'SNMP', description: 'Simple Network Management Protocol', proto: 'udp', risk: 'high' },
  162:  { name: 'SNMP Trap', description: 'SNMP Trap Notifications', proto: 'udp', risk: 'medium' },
  170:  { name: 'Print-srv', description: 'Network PostScript Print Server', proto: 'tcp', risk: 'low' },
  177:  { name: 'XDMCP', description: 'X Display Manager Control Protocol', proto: 'udp', risk: 'high' },
  179:  { name: 'BGP', description: 'Border Gateway Protocol', proto: 'tcp', risk: 'critical' },
  194:  { name: 'IRC', description: 'Internet Relay Chat', proto: 'tcp', risk: 'medium' },
  201:  { name: 'AppleTalk', description: 'AppleTalk Routing Maintenance', risk: 'low' },
  264:  { name: 'BGMP', description: 'Border Gateway Multicast Protocol', risk: 'low' },
  318:  { name: 'TSP', description: 'Time Stamp Protocol', risk: 'low' },
  381:  { name: 'HP Openview', description: 'HP Performance Data Alarm Manager', proto: 'tcp', risk: 'low' },
  383:  { name: 'HP Openview', description: 'HP Performance Data Collector', proto: 'tcp', risk: 'low' },
  389:  { name: 'LDAP', description: 'Lightweight Directory Access Protocol', proto: 'tcp', risk: 'high' },
  411:  { name: 'Direct Connect', description: 'Direct Connect Hub', proto: 'tcp', risk: 'medium' },
  412:  { name: 'Direct Connect', description: 'Direct Connect Client-to-Client', proto: 'tcp', risk: 'medium' },
  427:  { name: 'SLP', description: 'Service Location Protocol', risk: 'low' },
  443:  { name: 'HTTPS', description: 'HTTP über TLS/SSL', proto: 'tcp', risk: 'info' },
  445:  { name: 'SMB', description: 'Server Message Block (Dateifreigabe)', proto: 'tcp', risk: 'high' },
  464:  { name: 'Kerberos Change', description: 'Kerberos Change/Set Password', risk: 'medium' },
  465:  { name: 'SMTPS', description: 'SMTP über TLS (implicit)', proto: 'tcp', risk: 'low' },
  497:  { name: 'Retrospect', description: 'Retrospect Backup', risk: 'low' },
  500:  { name: 'IKE', description: 'Internet Key Exchange (IPsec/VPN)', proto: 'udp', risk: 'medium' },
  502:  { name: 'Modbus', description: 'Modbus Industrial Protocol', proto: 'tcp', risk: 'critical' },
  512:  [
    { name: 'rexec', description: 'Remote Process Execution', proto: 'tcp', risk: 'critical' },
    { name: 'comsat', description: 'Mail notification (bstrings)', proto: 'udp', risk: 'low' },
  ],
  513:  [
    { name: 'rlogin', description: 'Remote Login (unverschlüsselt)', proto: 'tcp', risk: 'critical' },
    { name: 'who', description: 'Who-Daemon', proto: 'udp', risk: 'low' },
  ],
  514:  [
    { name: 'rsh', description: 'Remote Shell (unverschlüsselt)', proto: 'tcp', risk: 'critical' },
    { name: 'Syslog', description: 'Syslog-Protokoll', proto: 'udp', risk: 'medium' },
  ],
  515:  { name: 'LPD', description: 'Line Printer Daemon', proto: 'tcp', risk: 'low' },
  520:  { name: 'RIP', description: 'Routing Information Protocol', proto: 'udp', risk: 'medium' },
  521:  { name: 'RIPng', description: 'RIP next generation (IPv6)', proto: 'udp', risk: 'medium' },
  530:  { name: 'RPC', description: 'Remote Procedure Call', proto: 'tcp', risk: 'medium' },
  543:  { name: 'klogin', description: 'Kerberos-Login', proto: 'tcp', risk: 'medium' },
  544:  { name: 'kshell', description: 'Kerberos Remote Shell', proto: 'tcp', risk: 'medium' },
  546:  { name: 'DHCPv6 Client', description: 'DHCPv6 Client', proto: 'udp', risk: 'low' },
  547:  { name: 'DHCPv6 Server', description: 'DHCPv6 Server', proto: 'udp', risk: 'low' },
  548:  { name: 'AFP', description: 'Apple Filing Protocol', proto: 'tcp', risk: 'medium' },
  554:  { name: 'RTSP', description: 'Real Time Streaming Protocol', risk: 'low' },
  563:  { name: 'NNTPS', description: 'NNTP über TLS/SSL', proto: 'tcp', risk: 'low' },
  587:  { name: 'SMTP Submission', description: 'E-Mail-Versand (Submission, STARTTLS)', proto: 'tcp', risk: 'low' },
  591:  { name: 'FileMaker', description: 'FileMaker Web Publishing', proto: 'tcp', risk: 'low' },
  593:  { name: 'MS-RPC over HTTP', description: 'Microsoft RPC over HTTP', proto: 'tcp', risk: 'high' },
  631:  { name: 'IPP', description: 'Internet Printing Protocol (CUPS)', risk: 'low' },
  636:  { name: 'LDAPS', description: 'LDAP über TLS/SSL', proto: 'tcp', risk: 'medium' },
  639:  { name: 'MSDP', description: 'Multicast Source Discovery Protocol', proto: 'tcp', risk: 'low' },
  646:  { name: 'LDP', description: 'Label Distribution Protocol (MPLS)', proto: 'tcp', risk: 'low' },
  691:  { name: 'MS Exchange', description: 'MS Exchange Routing', proto: 'tcp', risk: 'medium' },
  860:  { name: 'iSCSI', description: 'Internet SCSI', proto: 'tcp', risk: 'medium' },
  873:  { name: 'rsync', description: 'rsync Datei-Synchronisation', proto: 'tcp', risk: 'medium' },
  902:  { name: 'VMware Auth', description: 'VMware ESXi Authentication', proto: 'tcp', risk: 'medium' },
  953:  { name: 'RNDC', description: 'BIND DNS Remote Name Daemon Control', proto: 'tcp', risk: 'high' },
  989:  { name: 'FTPS Data', description: 'FTP Datenkanal über TLS', proto: 'tcp', risk: 'low' },
  990:  { name: 'FTPS', description: 'FTP Steuerkanal über TLS', proto: 'tcp', risk: 'low' },
  993:  { name: 'IMAPS', description: 'IMAP über TLS/SSL', proto: 'tcp', risk: 'low' },
  995:  { name: 'POP3S', description: 'POP3 über TLS/SSL', proto: 'tcp', risk: 'low' },
}

// ──────────────────────────────────────────────
//  Registered / commonly-used ports 1024–65535
//  These are returned with confidence "guess"
// ──────────────────────────────────────────────
const REGISTERED_PORTS: Record<number, PortInfo | PortInfo[]> = {
  1024: { name: 'Reserved', description: 'IANA reserviert', risk: 'low' },
  1025: { name: 'MS RPC', description: 'Microsoft RPC (dynamisch)', proto: 'tcp', risk: 'medium' },
  1080: { name: 'SOCKS', description: 'SOCKS Proxy', proto: 'tcp', risk: 'high' },
  1194: { name: 'OpenVPN', description: 'OpenVPN', risk: 'medium' },
  1433: { name: 'MSSQL', description: 'Microsoft SQL Server', proto: 'tcp', risk: 'high' },
  1434: { name: 'MSSQL Browser', description: 'MS SQL Server Browser / Monitor', proto: 'udp', risk: 'high' },
  1521: { name: 'Oracle DB', description: 'Oracle Database Listener', proto: 'tcp', risk: 'high' },
  1588: { name: 'ISQL', description: 'Cisco VQP / ISQL', risk: 'low' },
  1701: { name: 'L2TP', description: 'Layer 2 Tunneling Protocol', proto: 'udp', risk: 'medium' },
  1723: { name: 'PPTP', description: 'Point-to-Point Tunneling Protocol', proto: 'tcp', risk: 'high' },
  1812: { name: 'RADIUS Auth', description: 'RADIUS Authentication', proto: 'udp', risk: 'medium' },
  1813: { name: 'RADIUS Acct', description: 'RADIUS Accounting', proto: 'udp', risk: 'medium' },
  1883: { name: 'MQTT', description: 'Message Queuing Telemetry Transport', proto: 'tcp', risk: 'medium' },
  1900: { name: 'SSDP/UPnP', description: 'Simple Service Discovery Protocol (UPnP)', proto: 'udp', risk: 'high' },
  2049: { name: 'NFS', description: 'Network File System', risk: 'high' },
  2082: { name: 'cPanel', description: 'cPanel HTTP', proto: 'tcp', risk: 'medium' },
  2083: { name: 'cPanel SSL', description: 'cPanel HTTPS', proto: 'tcp', risk: 'low' },
  2086: { name: 'WHM', description: 'WebHost Manager HTTP', proto: 'tcp', risk: 'medium' },
  2087: { name: 'WHM SSL', description: 'WebHost Manager HTTPS', proto: 'tcp', risk: 'low' },
  2096: { name: 'cPanel Webmail', description: 'cPanel Webmail SSL', proto: 'tcp', risk: 'low' },
  2181: { name: 'ZooKeeper', description: 'Apache ZooKeeper', proto: 'tcp', risk: 'medium' },
  2222: { name: 'SSH Alt', description: 'SSH (alternativer Port)', proto: 'tcp', risk: 'medium' },
  2375: { name: 'Docker', description: 'Docker REST API (unverschlüsselt!)', proto: 'tcp', risk: 'critical' },
  2376: { name: 'Docker TLS', description: 'Docker REST API (TLS)', proto: 'tcp', risk: 'medium' },
  2377: { name: 'Docker Swarm', description: 'Docker Swarm Cluster Management', proto: 'tcp', risk: 'medium' },
  2379: { name: 'etcd Client', description: 'etcd Client Communication', proto: 'tcp', risk: 'high' },
  2380: { name: 'etcd Peer', description: 'etcd Peer Communication', proto: 'tcp', risk: 'high' },
  2483: { name: 'Oracle DB TLS', description: 'Oracle Database über TLS', proto: 'tcp', risk: 'medium' },
  2484: { name: 'Oracle DB SSL', description: 'Oracle Database über SSL', proto: 'tcp', risk: 'medium' },
  3000: { name: 'Dev Server', description: 'Node.js / Grafana / Dev Server', proto: 'tcp', risk: 'info' },
  3128: { name: 'Squid Proxy', description: 'Squid HTTP Proxy', proto: 'tcp', risk: 'medium' },
  3268: { name: 'LDAP GC', description: 'Active Directory Global Catalog', proto: 'tcp', risk: 'medium' },
  3269: { name: 'LDAP GC SSL', description: 'AD Global Catalog über SSL', proto: 'tcp', risk: 'medium' },
  3306: { name: 'MySQL', description: 'MySQL / MariaDB Datenbank', proto: 'tcp', risk: 'high' },
  3389: { name: 'RDP', description: 'Remote Desktop Protocol', proto: 'tcp', risk: 'high' },
  3478: { name: 'STUN/TURN', description: 'Session Traversal Utilities for NAT', risk: 'low' },
  4000: { name: 'Thin/Dev', description: 'Thin Server / Remote Anything', proto: 'tcp', risk: 'info' },
  4243: { name: 'Docker', description: 'Docker (älterer Standard-Port)', proto: 'tcp', risk: 'high' },
  4369: { name: 'EPMD', description: 'Erlang Port Mapper Daemon', proto: 'tcp', risk: 'medium' },
  4443: { name: 'HTTPS Alt', description: 'HTTPS (alternativer Port)', proto: 'tcp', risk: 'info' },
  4505: { name: 'SaltStack Pub', description: 'SaltStack Publisher', proto: 'tcp', risk: 'high' },
  4506: { name: 'SaltStack Ret', description: 'SaltStack Return', proto: 'tcp', risk: 'high' },
  4567: { name: 'Sinatra', description: 'Sinatra / Dev Server', proto: 'tcp', risk: 'info' },
  4646: { name: 'Nomad', description: 'HashiCorp Nomad', proto: 'tcp', risk: 'medium' },
  4789: { name: 'VXLAN', description: 'Virtual Extensible LAN', proto: 'udp', risk: 'low' },
  4848: { name: 'GlassFish', description: 'GlassFish Admin Console', proto: 'tcp', risk: 'medium' },
  5000: { name: 'UPnP/Dev', description: 'UPnP / Flask / Docker Registry', proto: 'tcp', risk: 'medium' },
  5001: { name: 'Synology', description: 'Synology DSM HTTPS / iperf3', proto: 'tcp', risk: 'medium' },
  5002: { name: 'Synology', description: 'Synology WebDAV / verschiedene', proto: 'tcp', risk: 'info' },
  5004: { name: 'RTP', description: 'Real-time Transport Protocol', risk: 'low' },
  5005: { name: 'RTP', description: 'RTP (alternativer Port)', risk: 'low' },
  5006: { name: 'Synology', description: 'Synology WebDAV HTTPS', proto: 'tcp', risk: 'low' },
  5044: { name: 'Logstash Beats', description: 'Elastic Beats / Logstash', proto: 'tcp', risk: 'low' },
  5050: { name: 'Multimedia', description: 'Yahoo! Messenger / verschiedene', proto: 'tcp', risk: 'info' },
  5060: { name: 'SIP', description: 'Session Initiation Protocol', risk: 'medium' },
  5061: { name: 'SIP TLS', description: 'SIP über TLS', proto: 'tcp', risk: 'low' },
  5222: { name: 'XMPP Client', description: 'XMPP / Jabber Client', proto: 'tcp', risk: 'low' },
  5269: { name: 'XMPP Server', description: 'XMPP Server-to-Server', proto: 'tcp', risk: 'low' },
  5353: { name: 'mDNS', description: 'Multicast DNS (Bonjour/Avahi)', proto: 'udp', risk: 'low' },
  5355: { name: 'LLMNR', description: 'Link-Local Multicast Name Resolution', proto: 'udp', risk: 'medium' },
  5432: { name: 'PostgreSQL', description: 'PostgreSQL Datenbank', proto: 'tcp', risk: 'high' },
  5500: { name: 'VNC Server', description: 'VNC Server (HTTP)', proto: 'tcp', risk: 'high' },
  5601: { name: 'Kibana', description: 'Kibana Web UI', proto: 'tcp', risk: 'medium' },
  5672: { name: 'AMQP', description: 'Advanced Message Queuing Protocol (RabbitMQ)', proto: 'tcp', risk: 'medium' },
  5800: { name: 'VNC HTTP', description: 'VNC über HTTP', proto: 'tcp', risk: 'high' },
  5900: { name: 'VNC', description: 'Virtual Network Computing', proto: 'tcp', risk: 'high' },
  5901: { name: 'VNC :1', description: 'VNC Display :1', proto: 'tcp', risk: 'high' },
  5938: { name: 'TeamViewer', description: 'TeamViewer Remote Access', proto: 'tcp', risk: 'medium' },
  5984: { name: 'CouchDB', description: 'Apache CouchDB', proto: 'tcp', risk: 'medium' },
  5985: { name: 'WinRM HTTP', description: 'Windows Remote Management (HTTP)', proto: 'tcp', risk: 'high' },
  5986: { name: 'WinRM HTTPS', description: 'Windows Remote Management (HTTPS)', proto: 'tcp', risk: 'medium' },
  6000: { name: 'X11', description: 'X Window System', proto: 'tcp', risk: 'high' },
  6379: { name: 'Redis', description: 'Redis In-Memory-Datenbank', proto: 'tcp', risk: 'high' },
  6443: { name: 'Kubernetes API', description: 'Kubernetes API Server', proto: 'tcp', risk: 'high' },
  6660: { name: 'IRC Alt', description: 'IRC (alternativer Port)', proto: 'tcp', risk: 'medium' },
  6667: { name: 'IRC', description: 'Internet Relay Chat', proto: 'tcp', risk: 'medium' },
  6697: { name: 'IRC TLS', description: 'IRC über TLS', proto: 'tcp', risk: 'low' },
  6881: { name: 'BitTorrent', description: 'BitTorrent', risk: 'medium' },
  7000: { name: 'Cassandra Inter', description: 'Cassandra Inter-Node / verschiedene', proto: 'tcp', risk: 'medium' },
  7001: { name: 'WebLogic', description: 'Oracle WebLogic / Cassandra', proto: 'tcp', risk: 'medium' },
  7070: { name: 'RealServer', description: 'RealServer / RTSP Alt', proto: 'tcp', risk: 'low' },
  7199: { name: 'Cassandra JMX', description: 'Cassandra JMX Monitoring', proto: 'tcp', risk: 'medium' },
  7443: { name: 'HTTPS Alt', description: 'HTTPS (alternativer Port)', proto: 'tcp', risk: 'info' },
  7474: { name: 'Neo4j HTTP', description: 'Neo4j Graph DB (HTTP)', proto: 'tcp', risk: 'medium' },
  7687: { name: 'Neo4j Bolt', description: 'Neo4j Bolt Protocol', proto: 'tcp', risk: 'medium' },
  8000: { name: 'HTTP Alt', description: 'HTTP (alternativer Port / Django)', proto: 'tcp', risk: 'info' },
  8006: { name: 'Proxmox', description: 'Proxmox VE Web UI', proto: 'tcp', risk: 'medium' },
  8008: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8009: { name: 'AJP', description: 'Apache JServ Protocol (Tomcat)', proto: 'tcp', risk: 'high' },
  8042: { name: 'YARN NM', description: 'Hadoop YARN NodeManager', proto: 'tcp', risk: 'low' },
  8080: { name: 'HTTP Alt', description: 'HTTP Proxy / alternativer Web-Port', proto: 'tcp', risk: 'info' },
  8081: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8082: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8083: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8085: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8086: { name: 'InfluxDB', description: 'InfluxDB HTTP API', proto: 'tcp', risk: 'medium' },
  8088: { name: 'HTTP Alt', description: 'HTTP (alternativer Port) / Radan', proto: 'tcp', risk: 'info' },
  8090: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  8096: { name: 'Jellyfin', description: 'Jellyfin Media Server', proto: 'tcp', risk: 'low' },
  8112: { name: 'Deluge', description: 'Deluge BitTorrent WebUI', proto: 'tcp', risk: 'low' },
  8123: { name: 'Home Assistant', description: 'Home Assistant / Polipo Proxy', proto: 'tcp', risk: 'medium' },
  8161: { name: 'ActiveMQ', description: 'Apache ActiveMQ Web Console', proto: 'tcp', risk: 'medium' },
  8200: { name: 'Vault', description: 'HashiCorp Vault', proto: 'tcp', risk: 'high' },
  8333: { name: 'Bitcoin', description: 'Bitcoin Mainnet P2P', proto: 'tcp', risk: 'medium' },
  8443: { name: 'HTTPS Alt', description: 'HTTPS (alternativer Port)', proto: 'tcp', risk: 'info' },
  8500: { name: 'Consul', description: 'HashiCorp Consul HTTP', proto: 'tcp', risk: 'medium' },
  8530: { name: 'WSUS HTTP', description: 'Windows Server Update Services', proto: 'tcp', risk: 'low' },
  8531: { name: 'WSUS HTTPS', description: 'WSUS über HTTPS', proto: 'tcp', risk: 'low' },
  8834: { name: 'Nessus', description: 'Nessus Vulnerability Scanner', proto: 'tcp', risk: 'medium' },
  8880: { name: 'HTTP Alt', description: 'HTTP Alt / cddbp', proto: 'tcp', risk: 'info' },
  8883: { name: 'MQTT TLS', description: 'MQTT über TLS', proto: 'tcp', risk: 'low' },
  8888: { name: 'HTTP Alt', description: 'HTTP Alt / Jupyter Notebook', proto: 'tcp', risk: 'info' },
  9000: { name: 'PHP-FPM/Sonar', description: 'PHP-FPM / SonarQube / verschiedene', proto: 'tcp', risk: 'medium' },
  9001: { name: 'Supervisor', description: 'Supervisord / verschiedene', proto: 'tcp', risk: 'medium' },
  9042: { name: 'Cassandra CQL', description: 'Cassandra CQL Native', proto: 'tcp', risk: 'medium' },
  9043: { name: 'WebSphere', description: 'IBM WebSphere Admin HTTPS', proto: 'tcp', risk: 'medium' },
  9060: { name: 'WebSphere', description: 'IBM WebSphere Admin Console', proto: 'tcp', risk: 'medium' },
  9090: { name: 'Prometheus', description: 'Prometheus / Cockpit / WebSphere', proto: 'tcp', risk: 'medium' },
  9091: { name: 'Transmission', description: 'Transmission BitTorrent WebUI', proto: 'tcp', risk: 'low' },
  9092: { name: 'Kafka', description: 'Apache Kafka Broker', proto: 'tcp', risk: 'medium' },
  9100: { name: 'JetDirect', description: 'HP JetDirect / Node Exporter', proto: 'tcp', risk: 'medium' },
  9200: { name: 'Elasticsearch', description: 'Elasticsearch HTTP', proto: 'tcp', risk: 'high' },
  9201: { name: 'Elasticsearch', description: 'Elasticsearch (compat.)', proto: 'tcp', risk: 'high' },
  9300: { name: 'Elasticsearch', description: 'Elasticsearch Transport', proto: 'tcp', risk: 'high' },
  9418: { name: 'Git', description: 'Git-Protokoll (git://)', proto: 'tcp', risk: 'medium' },
  9443: { name: 'HTTPS Alt', description: 'HTTPS (alternativer Port) / VMware', proto: 'tcp', risk: 'info' },
  9600: { name: 'Logstash', description: 'Logstash Monitoring API', proto: 'tcp', risk: 'low' },
  9999: { name: 'Urchin / Admin', description: 'Verschiedene Admin-Interfaces', proto: 'tcp', risk: 'medium' },
  10000: { name: 'Webmin', description: 'Webmin Admin Panel', proto: 'tcp', risk: 'high' },
  10050: { name: 'Zabbix Agent', description: 'Zabbix Monitoring Agent', proto: 'tcp', risk: 'medium' },
  10051: { name: 'Zabbix Server', description: 'Zabbix Monitoring Server', proto: 'tcp', risk: 'medium' },
  10250: { name: 'Kubelet', description: 'Kubernetes Kubelet API', proto: 'tcp', risk: 'high' },
  10255: { name: 'Kubelet RO', description: 'Kubelet Read-Only API', proto: 'tcp', risk: 'high' },
  11211: { name: 'Memcached', description: 'Memcached Cache', risk: 'high' },
  11235: { name: 'Ray', description: 'Ray Cluster (Distributed ML)', proto: 'tcp', risk: 'medium' },
  15672: { name: 'RabbitMQ Mgmt', description: 'RabbitMQ Management UI', proto: 'tcp', risk: 'medium' },
  16992: { name: 'Intel AMT HTTP', description: 'Intel Active Management Technology', proto: 'tcp', risk: 'critical' },
  16993: { name: 'Intel AMT TLS', description: 'Intel AMT über TLS', proto: 'tcp', risk: 'high' },
  17000: { name: 'Terraform', description: 'HashiCorp Terraform Enterprise', proto: 'tcp', risk: 'medium' },
  18080: { name: 'HTTP Alt', description: 'HTTP (alternativer Port)', proto: 'tcp', risk: 'info' },
  19132: { name: 'Minecraft BE', description: 'Minecraft Bedrock Edition', proto: 'udp', risk: 'info' },
  25565: { name: 'Minecraft', description: 'Minecraft Java Edition', proto: 'tcp', risk: 'info' },
  25575: { name: 'Minecraft RCON', description: 'Minecraft RCON', proto: 'tcp', risk: 'medium' },
  27017: { name: 'MongoDB', description: 'MongoDB NoSQL-Datenbank', proto: 'tcp', risk: 'high' },
  27018: { name: 'MongoDB Shard', description: 'MongoDB Shard Server', proto: 'tcp', risk: 'high' },
  27019: { name: 'MongoDB Config', description: 'MongoDB Config Server', proto: 'tcp', risk: 'high' },
  28015: { name: 'RethinkDB', description: 'RethinkDB Client', proto: 'tcp', risk: 'medium' },
  28017: { name: 'MongoDB Web', description: 'MongoDB HTTP Status (legacy)', proto: 'tcp', risk: 'high' },
  29418: { name: 'Gerrit SSH', description: 'Gerrit Code Review SSH', proto: 'tcp', risk: 'medium' },
  32400: { name: 'Plex', description: 'Plex Media Server', proto: 'tcp', risk: 'low' },
  33848: { name: 'Jenkins', description: 'Jenkins Agent (JNLP)', proto: 'tcp', risk: 'medium' },
  43594: { name: 'RuneScape', description: 'RuneScape Game', proto: 'tcp', risk: 'info' },
  47984: { name: 'Sunshine', description: 'Sunshine / NVIDIA GameStream', proto: 'tcp', risk: 'low' },
  50000: { name: 'SAP/Jenkins', description: 'SAP Router / Jenkins Build Agent', proto: 'tcp', risk: 'medium' },
  51820: { name: 'WireGuard', description: 'WireGuard VPN', proto: 'udp', risk: 'low' },
  54321: { name: 'Bo2k / Dev', description: 'Back Orifice 2000 / Dev Server', proto: 'tcp', risk: 'high' },
  55555: { name: 'Various Dev', description: 'Verschiedene Entwicklungs-Tools', proto: 'tcp', risk: 'info' },
  61616: { name: 'ActiveMQ', description: 'Apache ActiveMQ OpenWire', proto: 'tcp', risk: 'medium' },
  63342: { name: 'JetBrains', description: 'JetBrains IDE Built-in Server', proto: 'tcp', risk: 'low' },
}

// ──────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────

function matchEntry(
  entries: PortInfo | PortInfo[],
  proto: string,
): PortInfo | undefined {
  if (Array.isArray(entries)) {
    // Try protocol-specific match first, then any match
    return (
      entries.find((e) => e.proto === proto) ??
      entries.find((e) => !e.proto) ??
      entries[0]
    )
  }
  if (entries.proto && entries.proto !== proto) {
    // Protocol mismatch – still return as best guess
    return entries
  }
  return entries
}

/**
 * Look up a port number and return enriched info.
 *
 * If `agentService` is a meaningful name (not "Unknown" / empty), the
 * result has confidence "confirmed" and keeps the agent-reported name.
 *
 * Otherwise the function checks well-known ports (→ "identified") and
 * then registered ports (→ "guess").
 */
export function lookupPort(
  portNumber: number,
  proto: string,
  agentService?: string,
): PortLookupResult | null {
  const normalizedProto = proto.toLowerCase()

  // If the agent already reported a meaningful service name, trust it
  if (agentService && agentService !== 'Unknown' && agentService !== '' && agentService !== '-') {
    // Still enrich with description from our database if available
    const wk = WELL_KNOWN_PORTS[portNumber]
    const rp = REGISTERED_PORTS[portNumber]
    const matched = wk
      ? matchEntry(wk, normalizedProto)
      : rp
        ? matchEntry(rp, normalizedProto)
        : undefined

    return {
      name: agentService,
      description: matched?.description ?? agentService,
      risk: matched?.risk ?? 'info',
      confidence: 'confirmed',
    }
  }

  // Check well-known system ports (high confidence)
  const wellKnown = WELL_KNOWN_PORTS[portNumber]
  if (wellKnown) {
    const entry = matchEntry(wellKnown, normalizedProto)
    if (entry) {
      return { ...entry, confidence: 'identified' }
    }
  }

  // Check registered / common ports (guess)
  const registered = REGISTERED_PORTS[portNumber]
  if (registered) {
    const entry = matchEntry(registered, normalizedProto)
    if (entry) {
      return { ...entry, confidence: 'guess' }
    }
  }

  return null
}

/**
 * Returns an appropriate CSS risk colour class for the risk level.
 */
export function riskColor(risk: PortInfo['risk']): string {
  switch (risk) {
    case 'critical':
      return 'text-red-400'
    case 'high':
      return 'text-orange-400'
    case 'medium':
      return 'text-yellow-400'
    case 'low':
      return 'text-blue-400'
    case 'info':
    default:
      return 'text-slate-400'
  }
}

/**
 * Returns badge colours (background, text, border) for the risk level.
 */
export function riskBadgeColors(risk: PortInfo['risk']): string {
  switch (risk) {
    case 'critical':
      return 'bg-red-500/10 text-red-300 border-red-400/30'
    case 'high':
      return 'bg-orange-500/10 text-orange-300 border-orange-400/30'
    case 'medium':
      return 'bg-yellow-500/10 text-yellow-300 border-yellow-400/30'
    case 'low':
      return 'bg-blue-500/10 text-blue-300 border-blue-400/30'
    case 'info':
    default:
      return 'bg-slate-500/10 text-slate-300 border-slate-400/30'
  }
}
