# Audit Logs Seite

## Übersicht
Die Audit Logs Seite bietet Administratoren eine umfassende Übersicht über alle sicherheitsrelevanten Ereignisse im System.

## Features

### 🔒 Sicherheit
- **Cookie-basierte Authentifizierung**: Nur eingeloggte Benutzer können auf die Audit Logs zugreifen
- **Session-Validierung**: Die API prüft die Session über `getSession()` aus `@/lib/auth`

### 🔍 Filter & Suche
- **Volltext-Suche**: Durchsucht Action, Event Type, User ID, Machine ID und Details
- **Severity-Filter**: Info, Warning, Critical
- **Action-Filter**: Dropdown mit allen verfügbaren Actions
- **Zeitraum-Filter**: Von/Bis Datum mit DateTime-Picker
- **Aktive Filter-Anzeige**: Übersichtliche Darstellung der aktiven Filter mit Quick-Remove

### 📊 Statistiken
- Gesamtanzahl der Logs
- Anzahl pro Severity (Info, Warning, Critical)
- Real-time Updates bei Filter-Änderungen

### 💾 Export
- **CSV-Export**: Download aller gefilterten Logs als CSV-Datei
- Enthält alle Felder: Timestamp, Severity, Action, Event Type, User ID, Machine ID, Details

### 🎨 UX-Features
- **Details-Modal**: Klick auf einen Log-Eintrag öffnet ein Modal mit allen Details
- **Machine-Info**: Zeigt Hostname und IP statt nur der Machine-ID
- **Relative Zeitangaben**: "vor 2 Minuten", "vor 1 Stunde" (mit date-fns)
- **Responsive Design**: Optimiert für Desktop und Mobile
- **Skeleton Loading**: Professionelle Loading-States
- **Empty States**: Freundliche Hinweise bei leeren Ergebnissen

## API-Endpunkt

### `GET /api/audit-logs`

**Authentifizierung**: Erforderlich (Session Cookie)

**Query-Parameter**:
- `userId` (optional): Filter nach User ID
- `machineId` (optional): Filter nach Machine ID
- `action` (optional): Filter nach Action (z.B. "LOGIN", "COMMAND_EXEC")
- `eventType` (optional): Filter nach Event Type
- `severity` (optional): Filter nach Severity ("info", "warn", "critical")
- `from` (optional): Filter nach Start-Datum (ISO 8601)
- `to` (optional): Filter nach End-Datum (ISO 8601)
- `limit` (optional): Max. Anzahl der Ergebnisse (default: 50, max: 100)
- `offset` (optional): Offset für Pagination (default: 0)

**Response**:
```json
{
  "logs": [
    {
      "id": "clx...",
      "machineId": "clw...",
      "userId": "user123",
      "action": "COMMAND_EXEC",
      "eventType": "SESSION_CREATED",
      "details": "{\"command\": \"ls -la\"}",
      "severity": "info",
      "createdAt": "2025-12-06T10:30:00.000Z",
      "machine": {
        "hostname": "web-server-01",
        "ip": "192.168.1.10"
      }
    }
  ],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

## Datenmodell

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  machineId String?
  userId    String?
  action    String   // LOGIN, COMMAND_EXEC, SHELL_OPEN, SHELL_CLOSE, etc.
  eventType String?  // SESSION_CREATED, SESSION_ENDED, RATE_LIMIT_EXCEEDED, etc.
  details   String?  // JSON string with additional event data
  severity  String   @default("info") // info, warn, critical
  createdAt DateTime @default(now())

  machine Machine? @relation(fields: [machineId], references: [id], onDelete: Cascade)

  @@index([machineId, createdAt])
  @@index([action])
  @@index([eventType])
}
```

## Navigation

Die Seite ist über die Side Navigation erreichbar:
- Icon: `TerminalSquare` (Lucide Icons)
- Label: "Audit Logs"
- Route: `/audit-logs`

## Technischer Stack

- **Framework**: Next.js 14 (App Router)
- **UI**: React mit TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Datum**: date-fns mit deutschem Locale
- **Database**: Prisma ORM
- **Auth**: Cookie-basierte Session

## Zukünftige Erweiterungen

- [ ] Pagination (Infinite Scroll oder Paginierungs-Buttons)
- [ ] Real-time Updates (WebSocket)
- [ ] Erweiterte Filter (z.B. nach User-Namen statt nur ID)
- [ ] Export in weitere Formate (JSON, PDF)
- [ ] Grafische Darstellung (Charts für Trends)
- [ ] Favoriten-Filter speichern
