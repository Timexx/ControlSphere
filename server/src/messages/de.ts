const messages = {
  login: {
    loading: {
      title: 'Initialisierung',
      subtitle: 'System-Handshake läuft...',
    },
    errors: {
      statusCheck: 'Systemstatus konnte nicht geprüft werden',
      passwordMismatch: 'Passwörter stimmen nicht überein',
      setupFailed: 'Setup fehlgeschlagen',
      loginFailed: 'Anmeldung fehlgeschlagen',
    },
    titles: {
      primary: {
        login: 'Anmelden',
        setup: 'Erstkonfiguration',
      },
      form: {
        login: 'Anmelden',
        setup: 'Benutzer erstellen',
      },
    },
    subtitles: {
      login: 'Gib deine Zugangsdaten ein.',
      setup: 'Erstelle einen Benutzer für das System.',
    },
    labels: {
      username: 'Benutzername',
      password: 'Passwort',
      confirmPassword: 'Passwort bestätigen',
    },
    placeholders: {
      username: 'Benutzername',
      password: '••••••••',
      confirmPassword: 'Passwort bestätigen',
    },
    buttons: {
      submitting: {
        login: 'Anmeldung...',
        setup: 'Zugang wird erstellt...',
      },
      submit: {
        login: 'Anmelden',
        setup: 'Zugang erstellen',
      },
    },
  },
  languageSetup: {
    eyebrow: 'Sprachwahl',
    title: 'Bevorzugte Sprache auswählen',
    subtitle: 'Wähle deine Sprache für ControlSphere. Diese Einstellung gilt für alle Geräte und Logins.',
    errors: {
      saveFailed: 'Sprache konnte nicht aktualisiert werden.',
    },
    languages: {
      de: {
        tagline: 'Deutsche Oberfläche',
        title: 'Deutsch',
        description: 'Klar strukturierte deutsche Oberfläche für Teams im DACH-Raum.',
        flag: '🇩🇪',
      },
      en: {
        tagline: 'Englische Oberfläche',
        title: 'English',
        description: 'Englische UI für globale Teams und gemeinsame Operationen.',
        flag: '🇺🇸',
      },
    },
    cta: {
      active: 'Aktive Sprache',
      switch: 'Sprache wechseln',
      select: 'Sprache verwenden',
    },
    saving: 'Einstellung wird gespeichert...',
    footnote: 'Du kannst dies später im Profil ändern.',
  },
  severity: {
    critical: 'Kritisch',
    high: 'Hoch',
    medium: 'Mittel',
    low: 'Niedrig'
  },
  appShell: {
    nav: {
      dashboard: 'System Übersicht',
      bulk: 'Bulk Management',
      security: 'Security',
      audit: 'Audit Logs',
    },
    actions: {
      toggleNav: 'Navigation umschalten',
      addAgent: 'Agent',
      language: {
        title: 'Sprache',
        label: 'Deutsch',
        loading: 'Sprache wird geändert...',
      },
      refresh: {
        title: 'Session verlängern',
        subtitle: 'Verlängert die Login-Session um 30 Minuten',
      },
      logout: {
        title: 'Abmelden',
        label: 'Abmelden',
        loading: 'Abmelden...',
      },
    },
    sessionExpiry: {
      title: 'Session läuft ab',
      description: 'Deine Session läuft in weniger als einer Minute ab. Du wirst automatisch abgemeldet.',
      cancel: 'Abbrechen',
      extend: 'Session verlängern',
      extending: 'Verlängern...',
    },
  },
  machine: {
    loading: {
      sync: 'Node-Status wird synchronisiert...'
    },
    header: {
      eyebrow: 'Node Control',
      securityLink: 'Zu Security Events',
      securityBadge: '{count, plural, one {# Event} other {# Events}}'
    },
    status: {
      title: 'Status',
      lastSeen: 'Zuletzt gesehen',
      added: 'Hinzugefügt',
      connection: 'Verbindung',
      connected: 'Verbunden',
      disconnected: 'Getrennt',
      online: 'Online',
      offline: 'Offline',
      live: 'Live verbunden'
    },
    system: {
      title: 'System Information',
      os: 'OS',
      kernel: 'Kernel',
      hostname: 'Hostname',
      ip: 'IP Adresse'
    },
    actions: {
      title: 'Schnellaktionen',
      openTerminal: 'Terminal öffnen',
      systemUpdate: 'System Update',
      agentUpdate: 'Agent Update',
      reboot: 'Neustart',
      refresh: 'Aktualisieren',
      executing: 'Ausführung: {command}',
      delete: {
        title: 'Machine löschen',
        label: 'Entfernen'
      }
    },
    metrics: {
      title: 'Live Metriken',
      cpu: 'CPU Nutzung',
      ram: 'RAM Nutzung',
      disk: 'Disk Nutzung',
      uptime: 'Betriebszeit'
    },
    analytics: {
      eyebrow: 'Historische Analysen',
      title: 'Forecasting & Trends (deterministisch)',
      subtitle: 'SMA-Glättung, lineare Regression und Rates-of-Change für CPU / RAM / Disk. Kein Blackbox-AI, nur nachvollziehbare Mathematik.',
      badge: 'y = m*x + b | SMA | dy/dt',
      refresh: 'Aktualisieren',
      loading: 'Lädt...',
      processing: 'Berechne Zeitreihen...',
      tooFew: 'Noch zu wenige Datenpunkte im gewählten Zeitraum.',
      series: {
        cpu: 'CPU',
        ram: 'RAM',
        disk: 'Disk'
      },
      smoothing: 'SMA-Glättung (gleitender Mittelwert, k={window})',
      smoothingHint: 'Glättet Ausreißer und zeigt den Mitteltrend (k = Fenstergröße).',
      tiles: {
        disk: {
          title: 'Disk Forecast',
          fullIn: 'Voll in {time}',
          noLimit: 'Kein absehbarer Grenzwert',
          eta: 'ETA {time}',
          trend: 'Trend: {trend}',
          fillTrend: 'Fülltrend aktiv',
          fullAt: 'Voll {time}',
          trendLabel: 'Trend: {trend}'
        },
        ramLeak: {
          title: 'RAM Leak Watch',
          noData: 'Zu wenige Daten'
        },
        cpu: {
          title: 'CPU Headroom',
          ninetyIn: '90% in {time}',
          headroom: 'Genügend Puffer',
          eta: 'ETA {time}',
          stable: 'Trend stabil'
        },
        dynamics: {
          title: 'Aktuelle Dynamik',
          value: 'CPU {cpu}%/h | RAM {ram}%/h',
          detail: 'Disk {disk}%/h'
        },
        provision: {
          cpu: 'CPU Provisioning',
          ram: 'RAM Provisioning',
          disk: 'Disk Outlook',
          leak: 'Leak-Tendenz'
        }
      },
      error: 'Analytics konnten nicht geladen werden',
      trend: {
        flat: 'flach'
      },
      statuses: {
        noData: 'Keine Daten',
        underprovisioned: 'Unterversorgt',
        overprovisioned: 'Überversorgt',
        balanced: 'Ausbalanciert'
      },
      load: {
        high: 'Spitzen ~{peak}% — Reserve ~{headroom}% (knapp)',
        low: 'Spitzen ~{peak}% — ungenutzt ~{unused}%',
        balanced: 'Spitzen ~{peak}% — Reserve ~{headroom}%'
      },
      time: {
        decadeOrMore: '>10 Jahre',
        years: '{value} Jahre',
        days: '{value} Tage',
        hours: '{value} Std',
        minutes: '{value} Min'
      },
      downsample: {
        compacted: 'Downsample x{bucket} ({raw} Rohpunkte)',
        raw: '{raw} Rohpunkte'
      }
    },
    notes: {
      saved: 'Gespeichert {time}'
    },
    errors: {
      agentUpdate: 'Fehler beim Agent-Update',
      deleteMachine: 'Fehler beim Löschen der Machine',
      saveNotes: 'Fehler beim Speichern der Notizen',
      addLink: 'Fehler beim Speichern des Links',
      linkValidation: 'Bitte Titel und URL angeben',
      deleteLink: 'Fehler beim Löschen des Links'
    },
    notesPanel: {
      title: 'Dokumentation & Notizen',
      summary: '{notes, plural, one {Notizen} other {Notizen}} • {links} Links',
      unsaved: 'Nicht gespeichert',
      notesTitle: 'Team-Notizen',
      placeholder: 'Dokumentiere Runbooks, Recovery-Prozeduren, Wartungsfenster, verantwortliche Teams...',
      save: 'Speichern',
      saving: 'Speichern...',
      links: {
        title: 'Quick Links',
        count: '{count, plural, one {# Link} other {# Links}}',
        titlePlaceholder: 'Titel',
        urlPlaceholder: 'https://...',
        descriptionPlaceholder: 'Beschreibung (optional)',
        add: 'Hinzufügen',
        saving: 'Speichern...',
        empty: 'Noch keine Links vorhanden',
        remove: 'Link entfernen'
      }
    },
    security: {
      title: 'Security Center',
      open: '{count, plural, one {# Event} other {# Events}} offen • {severity}',
      safe: 'Keine offenen Events • System sicher',
      vulnerabilitiesFound: 'Schwachstellen gefunden — Details ansehen',
      severity: {
        critical: 'Kritisch',
        high: 'Hoch',
        medium: 'Mittel',
        low: 'Niedrig',
        info: 'Info'
      }
    },
    deleteModal: {
      title: 'Machine löschen',
      description: 'Möchten Sie die Machine "{hostname}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
      cancel: 'Abbrechen',
      confirm: 'Löschen',
      deleting: 'Wird gelöscht...'
    },
    rebooting: {
      title: 'System wird neu gestartet',
      subtitle: 'Bitte warten, bis die Verbindung wiederhergestellt ist...'
    }
  },
  bulkManagement: {
    loading: 'Lade Bulk Management...',
    header: {
      eyebrow: 'Bulk Management',
      title: 'Jobs & Ausführungen',
      subtitle: 'Erstelle neue Bulk-Jobs, öffne Details und verfolge Ausgaben live.'
    },
    actions: {
      newJob: 'Neuer Bulk Job',
      refresh: 'Aktualisieren'
    },
    dialog: {
      header: {
        eyebrow: 'Bulk Operation',
        title: '{count, plural, one {# Maschine} other {# Maschinen}} ausgewählt',
        subtitle: 'Führe denselben Befehl auf mehreren Hosts aus – wahlweise parallel für maximale Geschwindigkeit oder in kontrollierten Wellen für mehr Sicherheit.',
        editingSubtitle: 'Job bearbeiten & neu starten',
        loadingJobData: 'Job-Daten werden geladen...',
        dryRun: 'Dry Run: {total} {total, plural, one {Ziel} other {Ziele}}{offline, plural, =0 {} other { (# offline)}}'
      },
      closeButton: 'Schließen'
    },
    form: {
      commandLabel: 'Befehl definieren',
      commandHint: 'Dieser Befehl wird auf allen ausgewählten Maschinen ausgeführt',
      commandPlaceholder: 'z.B. apt update && apt upgrade -y',
      strategyLabel: 'Ausführungs-Strategie',
      strategyParallel: '⚡ Parallel – Alle gleichzeitig',
      strategyRolling: '🌊 Rolling – In kontrollierten Wellen',
      strategyTipParallel: '💡 Schnellste Methode, aber höheres Risiko bei fehlerhaften Befehlen',
      strategyTipRolling: '💡 Sicherer Ansatz mit schrittweiser Ausführung und Fehlerüberwachung',
      configLabel: 'Konfigurations-Parameter',
      concurrencyLabel: 'Max. gleichzeitige Hosts',
      batchSizeLabel: 'Hosts pro Welle',
      batchSizeHint: 'Anzahl der Maschinen, die pro Durchlauf parallel bearbeitet werden',
      waitSecondsLabel: 'Pause (Sekunden)',
      failureToleranceLabel: 'Fehlertoleranz (%)',
      failureToleranceHint: 'Job wird abgebrochen, wenn dieser Prozentsatz fehlschlägt',
      targetSelectionLabel: 'Ziel-Hosts auswählen',
      targetSelectionPrefilledHint: 'Vorbelegte Auswahl basiert auf dem ursprünglichen Job – passe sie nach Bedarf an.',
      targetSelectionGroupHint: 'Zielauswahl wird aus der ursprünglichen Gruppe/Dynamik übernommen; Liste dient als Referenz.',
      noMachinesAvailable: 'Keine Maschinen verfügbar',
      selectAll: 'Alle',
      clearSelection: 'Leeren',
      online: 'Online',
      offline: 'Offline',
      dryRun: 'Dry Run',
      runJob: 'Job ausführen',
      running: 'Wird gestartet...',
      applyAndRun: 'Änderungen anwenden & starten',
      runJobTitle: 'Startet den Job sofort auf den ausgewählten Maschinen mit der gewählten Strategie',
      dryRunTitle: 'Simuliert den Job und zeigt, wie viele Ziele betroffen wären (ohne Ausführung)',
      selectionSummary: '{count} von {total} {total, plural, one {Maschine} other {Maschinen}} ausgewählt',
      cancel: 'Abbrechen'
    },
    jobsList: {
      title: 'Job-Verlauf',
      empty: 'Keine Jobs vorhanden',
      noJobs: 'Noch keine Bulk-Jobs erstellt. Erstelle oben deinen ersten Job.',
      unnamed: 'Unbenannter Job',
      columns: {
        name: 'Job-Name',
        command: 'Befehl',
        mode: 'Modus',
        targets: 'Ziele',
        status: 'Status',
        created: 'Erstellt',
        actions: 'Aktionen'
      },
      statuses: {
        pending: 'Ausstehend',
        running: 'Läuft',
        completed: 'Abgeschlossen',
        failed: 'Fehlgeschlagen',
        aborted: 'Abgebrochen'
      },
      actions: {
        viewDetails: 'Details anzeigen',
        rerun: 'Neu starten',
        abort: 'Abbrechen',
        delete: 'Löschen'
      }
    },
    jobDetail: {
      title: 'Job-Ausführung',
      editAndRun: 'Bearbeiten & starten',
      killSwitch: 'Kill Switch',
      deleteJob: 'Job löschen',
      close: 'Schließen',
      loading: 'Lade Job Details...',
      summary: 'Zusammenfassung',
      executions: 'Ausführungen',
      status: 'Status',
      totalTargets: 'Gesamt-Ziele',
      successful: 'Erfolgreich',
      failed: 'Fehlgeschlagen',
      pending: 'Ausstehend',
      created: 'Erstellt',
      started: 'Gestartet',
      completed: 'Abgeschlossen',
      noExecutions: 'Keine Ausführungen',
      noLogs: 'Noch keine Ausgabe',
      liveOutput: 'Live Output',
      executionStatus: {
        pending: 'Ausstehend',
        running: 'Läuft',
        success: 'Erfolg',
        failed: 'Fehlgeschlagen'
      }
    },
    errors: {
      jobDeleteConfirm: 'Möchten Sie diesen Job wirklich löschen?',
      jobLoadFailed: 'Job konnte nicht geladen werden',
      jobLoadFailedRetry: 'Job konnte nicht geladen werden. Bitte erneut versuchen.',
      deleteFailed: 'Fehler beim Löschen des Jobs'
    }
  },
  bulkAuth: {
    eyebrow: 'ControlSphere',
    title: 'Bulk Management Zugriff',
    heading: 'Authentifizierung erforderlich',
    warning: {
      title: 'Erhöhte Berechtigungen erforderlich',
      body: 'Bulk Operations ermöglichen die gleichzeitige Ausführung von Befehlen auf mehreren Maschinen. Sparen Sie Zeit durch parallele Ausführung und effiziente Infrastruktur-Verwaltung – mit voller Sicherheit.'
    },
    password: {
      label: 'Passwort',
      placeholder: '••••••••'
    },
    actions: {
      cancel: 'Abbrechen',
      submit: 'Zugriff gewähren',
      verifying: 'Wird verifiziert...'
    },
    errors: {
      required: 'Bitte geben Sie Ihr Passwort ein',
      wrong: 'Falsches Passwort',
      network: 'Verbindungsfehler. Bitte versuchen Sie es erneut.'
    }
  },
  security: {
    severity: {
      critical: 'Kritisch',
      high: 'Hoch',
      medium: 'Mittel',
      low: 'Niedrig'
    },
    header: {
      eyebrow: 'Security Center',
      title: 'VM Security Übersicht',
      subtitle: 'Status, Events und letzte Scans je Agent.'
    },
    badges: {
      systems: '{count, plural, one {# System} other {# Systeme}}',
      stable: '{count, plural, one {# stabil} other {# stabil}}',
      open: '{count, plural, one {# offen} other {# offen}}'
    },
    states: {
      loading: 'Lade Sicherheitsstatus...',
      empty: 'Keine Systeme gefunden.'
    },
    cveSync: {
      eyebrow: 'CVE Mirror',
      title: 'CVE Sync & Matching',
      subtitle: 'Nutzt OSV-Daten und erkannte Paket-Ökosysteme, um Schwachstellen aktuell zu halten.',
      automatic: 'Automatischer Trigger: alle 2 Stunden nach Serverstart (auf erkannte Paket-Ökosysteme begrenzt).',
      manual: 'Manueller Trigger: sofortiges Sync anstoßen, um CVE-Daten jetzt zu aktualisieren.',
      button: 'CVE-Sync jetzt starten',
      buttonLoading: 'Sync läuft...',
      state: 'Status: {status} • Letzter Sync: {lastSync}',
      stateUnknown: 'unbekannt',
      status: {
        started: 'Manueller CVE-Sync gestartet.',
        alreadyRunning: 'Ein CVE-Sync läuft bereits.',
        failed: 'CVE-Sync konnte nicht gestartet werden.'
      },
      viewMirror: 'CVE-Mirror ansehen',
      mode: 'Modus: {mode}',
      coverage: 'Ökosysteme: {count} • CVEs: {total}'
    },
    cveDialog: {
      title: 'CVE Mirror',
      subtitle: 'Neueste gespiegelte CVEs mit Quellen und Veröffentlichungsdatum.',
      loading: 'Lade CVEs...',
      empty: 'Noch keine CVEs gespiegelt.',
      published: 'Veröffentlicht: {date}',
      searchPlaceholder: 'Suche nach ID oder Beschreibung',
      filterSeverity: 'Schweregrad',
      filterAll: 'Alle',
      noResults: 'Keine CVEs passen zu deinen Filtern.'
    },
    cards: {
      status: {
        good: 'Sicher',
        warn: 'Achtung',
        critical: 'Kritisch'
      },
      agent: 'Agent:',
      events: 'Events: {count}',
      lastScan: 'Letzter Scan {distance}',
      noScan: 'Kein Scan empfangen'
    }
  },
  securityDetail: {
    header: {
      eyebrow: 'SECURITY DETAIL',
      title: 'Schwachstellen-Analyse',
      subtitle: 'Echtzeit-Sicherheitsereignisse und Systemzustand'
    },
    tabs: {
      events: 'Sicherheitsereignisse',
      logs: 'Audit Logs',
      packages: 'Pakete',
      ports: 'Ports'
    },
    sections: {
      securityEvents: 'Sicherheitsereignisse',
      auditLogs: 'Audit Logs',
      packages: 'Pakete',
      ports: 'Ports',
      handbook: 'So funktionieren Scans',
      scanReport: 'Scan-Report'
    },
    emptyStates: {
      events: {
        hint: 'Keine Sicherheitsereignisse',
        detail: 'Der Agent hat keine Sicherheitsprobleme auf diesem System erkannt.'
      },
      logs: {
        hint: 'Keine Audit Logs',
        detail: 'Dieses System hat noch keine Audit-Log-Einträge generiert.'
      },
      packages: {
        hint: 'Keine Pakete gefunden',
        detail: 'Es konnten keine Paketinformationen von diesem System abgerufen werden.'
      },
      ports: {
        hint: 'Keine Ports erkannt',
        detail: 'Es konnten keine offenen Ports auf diesem System erkannt werden.'
      }
    },
    liveScan: {
      running: 'Scan läuft...',
      eta: 'Verbleibend: {seconds}s'
    },
    scanButton: {
      disabled: 'Aktiver Scan läuft – bitte auf Abschluss warten.'
    },
    cveDialog: {
      title: 'CVE Mirror',
      subtitle: 'Neueste gespiegelte CVEs mit Quellen und Veröffentlichungsdatum.',
      loading: 'Lade CVEs...',
      empty: 'Noch keine CVEs gespiegelt.',
      published: 'Veröffentlicht: {date}',
      searchPlaceholder: 'Suche nach ID oder Beschreibung',
      filterSeverity: 'Schweregrad',
      filterAll: 'Alle',
      noResults: 'Keine CVEs passen zu deinen Filtern.'
    },
    buttons: {
      download: 'Herunterladen',
      cancel: 'Abbrechen',
      close: 'Schließen',
      handbook: 'So funktioniert es',
      refresh: 'Aktualisieren'
    },
    labels: {
      severity: 'Schweregrad',
      timestamp: 'Zeitstempel',
      service: 'Service',
      description: 'Beschreibung',
      port: 'Port',
      protocol: 'Protokoll',
      state: 'Status',
      process: 'Prozess',
      package: 'Paket',
      version: 'Version',
      manager: 'Paketmanager',
      status: 'Status',
      command: 'Befehl',
      pathsScanned: 'Verzeichnisse, die auf CVEs geprüft wurden',
      pathsScannedEmpty: 'Keine Scan-Pfade vom Agent gemeldet.'
    },
    severity: {
      critical: 'Kritisch',
      high: 'Hoch',
      medium: 'Mittel',
      low: 'Niedrig'
    },
    packageStatus: {
      securityUpdate: 'Sicherheitsupdate',
      updateAvailable: 'Update verfügbar',
      current: 'Aktuell'
    },
    handbook: {
      title: 'So funktionieren Scans',
      subtitle: 'Der Agent führt alle 30 Minuten folgende Sicherheitsprüfungen durch',
      sections: {
        fileIntegrity: {
          title: '1. File Integrity Monitoring',
          description: 'Überwacht kritische Systemdateien auf unerwartete Änderungen. Bei jeder Modifikation wird ein Event mit Severity "high" erzeugt.',
          files: 'Überwachte Dateien:',
          filesList: [
            '/etc/passwd',
            '/etc/shadow',
            '/etc/sudoers',
            '/etc/ssh/sshd_config',
            '/etc/hosts',
            '/etc/crontab',
            '/root/.ssh/authorized_keys',
            '/etc/pam.d/sshd',
            '/etc/security/access.conf'
          ]
        },
        configDrift: {
          title: '2. Config Drift Detection',
          description: 'Prüft sicherheitsrelevante Konfigurationen auf Abweichungen von Best Practices. Ein Drift wird als "medium" oder "critical" eingestuft.',
          sshConfig: 'SSH-Konfiguration (/etc/ssh/sshd_config):',
          expectations: [
            { key: 'PermitRootLogin', value: 'erwartet: no' },
            { key: 'PasswordAuthentication', value: 'erwartet: no' },
            { key: 'PermitEmptyPasswords', value: 'erwartet: no' }
          ]
        },
        authLogMonitoring: {
          title: '3. Auth Log Monitoring',
          description: 'Analysiert Authentifizierungs-Logs auf verdächtige Aktivitäten wie Brute-Force-Angriffe oder Root-Logins.',
          failedLogins: 'Fehlgeschlagene Logins:',
          failedAttempts: [
            { range: '3-9 Versuche', severity: 'medium' },
            { range: '10-49 Versuche', severity: 'high' },
            { range: '50+ Versuche', severity: 'critical' }
          ],
          rootLogins: 'Root-Logins:',
          rootLoginsDetail: 'Jeder erfolgreiche Root-Login wird als "medium" Event gemeldet.',
          monitoredFiles: 'Überwachte Log-Dateien:',
          logFiles: [
            '/var/log/auth.log (Debian/Ubuntu)',
            '/var/log/secure (RHEL/CentOS)'
          ]
        },
        scanInterval: {
          title: 'Scan-Intervall',
          description: 'Alle Security-Checks werden automatisch vom Agent durchgeführt. Der erste Scan startet kurz nach der Agent-Verbindung.',
          interval: 'alle 30 Minuten'
        },
        cveSync: {
          title: '4. CVE Sync & Matching',
          description: 'Der Server spiegelt CVE/OSV-Daten und gleicht sie mit installierten Paketen ab.',
          automatic: 'Automatischer Trigger: alle 2 Stunden nach Serverstart (OSV-Batch, begrenzt auf erkannte Ökosysteme).',
          manual: 'Manueller Trigger: Security → "CVE-Sync jetzt starten" stößt einen sofortigen Mirror an.',
          apiHint: 'API: POST /api/security/cve (Status: GET /api/security/cve)'
        },
        cveCoverage: {
          title: '5. CVE-Abdeckung sicherstellen',
          description: 'So stellen Agent und Server sicher, dass alle CVEs über Subsysteme geprüft werden.',
          bullets: {
            serverMirror: 'Server spiegelt OSV-CVEs täglich (Debian, Alpine, npm, PyPI, Maven, NuGet, Go, crates.io, Packagist, RubyGems, OSS-Fuzz).',
            agentPaths: 'Agent sendet installierte Pakete und optionale Scan-Pfade (Verzeichnisse, die auf verwundbare Binaries/Pakete geprüft wurden).',
            serverMatching: 'Server führt das CVE-Matching zentral mit dem gespiegelten Datensatz und ecosystem-bewusster Versionslogik aus.',
            operatorChecks: 'Operatoren sehen „Verzeichnisse, die auf CVEs geprüft wurden“ im Scan-Report und können CVE-Sync via POST /api/security/cve neu anstoßen.'
          }
        }
      }
    },
    packageActions: {
      updateCommand: 'Aktualisierungsbefehl',
      whySecurityUpdate: 'Warum "Security Update"?',
      securityUpdateExplanation: 'Dieses Paket hat laut Paketquelle eine als sicherheitsrelevant markierte Aktualisierung. Der Agent zeigt es, bis die neueste abgesicherte Version installiert ist.',
      afterUpdate: 'Nach dem Update sendet der Agent beim nächsten Sync den neuen Paketstatus.',
      updateManagers: {
        apt: 'Mit apt aktualisieren',
        yum: 'Mit yum aktualisieren',
        dnf: 'Mit dnf aktualisieren',
        pacman: 'Mit pacman aktualisieren'
      }
    },
    tooltips: {
      fileIntegrity: 'Überwacht kritische Systemdateien auf der Maschine',
      configDrift: 'Prüft, ob Sicherheitskonfigurationen erwartungsgemäß sind',
      authMonitoring: 'Verfolgt verdächtige Authentifizierungsversuche',
      scanInterval: 'Zeigt an, wie häufig Sicherheitsprüfungen durchgeführt werden'
    },
    modals: {
      handbook: {
        title: 'So funktionieren Scans',
        description: 'Der Agent führt automatisierte Sicherheits-Scans und Systemprüfungen durch'
      }
    },
    toasts: {
      scanStarted: 'Scan gestartet! Pakete werden gleich aktualisiert.',
      scanCompleted: 'Scan abgeschlossen. Security-Daten werden aktualisiert.',
      scanFailed: 'Scan konnte nicht gestartet werden.',
      connectionError: 'Verbindungsfehler. Bitte erneut versuchen.',
      scanTimeout: 'Scan dauert länger als erwartet. Prüfen Sie die Logs.',
      eventsResolved: 'Security-Events wurden aktualisiert.'
    }
  },
  shared: {
    noData: 'Keine Daten'
  },
  addAgentModal: {
    title: 'Agent hinzufügen',
    subtitle: 'Installiere den Agent auf einem neuen System',
    quickInstall: {
      title: 'Schnell-Installation (Empfohlen)',
      description: 'Kopiere diesen Befehl und führe ihn auf deinem Linux-System aus:',
      download: 'Install-Script herunterladen',
      copyScript: 'Script kopieren',
    },
    copied: 'Kopiert!',
    copyFailed: 'Kopieren fehlgeschlagen. Bitte manuell kopieren.',
    notes: {
      title: 'Wichtige Hinweise:',
      root: 'Der Agent muss als root ausgeführt werden (sudo)',
      secret: 'Speichere den generierten Secret Key sicher',
      dashboard: 'Der Agent erscheint automatisch im Dashboard nach der Installation',
      port: 'Port 3000 muss vom VM-System erreichbar sein',
    },
    close: 'Schließen',
  },
  dashboard: {
    loading: 'Systeme werden kalibriert...',
    hero: {
      eyebrow: 'SYSTEM ÜBERSICHT',
      title: 'Dashboard',
      subtitle: 'Alle Agents und Telemetrie auf einen Blick.',
    },
    stats: {
      online: '{count} online',
      total: '{count} gesamt',
      critical: '{count} Kritisch',
      high: '{count} Hoch',
      securityUpdates: '{count} Updates',
    },
    badges: {
      critical: '{count} Kritisch',
      high: '{count} Hoch',
      medium: '{count} Mittel',
      events: '{count, plural, one {# Event} other {# Events}}',
      updates: '{count, plural, one {# Update} other {# Updates}}',
      severityCritical: 'Kritisch',
      severityHigh: 'Hoch',
      noIssues: 'Keine Sicherheitsprobleme',
    },
    empty: {
      title: 'Noch keine Systeme',
      subtitle: 'Installiere den Agent oder füge einen Host hinzu, um Telemetrie zu empfangen.',
    },
    status: {
      online: 'Online',
      offline: 'Offline',
    },
    metrics: {
      cpu: 'CPU',
      ram: 'RAM',
      disk: 'Disk',
      uptime: 'Uptime',
    },
    lastSeen: 'Zuletzt gesehen:',
  },
  auditLogs: {
    header: {
      title: 'Audit Logs',
      subtitle: 'Systemweite Ereignisse und kritische Aktionen im Überblick'
    },
    buttons: {
      refresh: 'Aktualisieren',
      refreshing: 'Wird aktualisiert...',
      export: 'CSV Export'
    },
    stats: {
      total: 'Gesamt',
      info: 'Info',
      warnings: 'Warnungen',
      critical: 'Kritisch'
    },
    filterSection: {
      title: 'Filter & Suche',
      showMore: 'Mehr Filter',
      showLess: 'Weniger'
    },
    searchPlaceholder: 'Suche nach Action, Event Type, Benutzer, Machine, Details...',
    filterLabels: {
      severity: 'Schweregrad',
      action: 'Aktion',
      from: 'Von Datum',
      to: 'Bis Datum',
      all: 'Alle'
    },
    activeFilters: 'Aktive Filter:',
    filterTags: {
      severity: 'Schweregrad:',
      action: 'Aktion:',
      from: 'Von:',
      to: 'Bis:'
    },
    loading: 'Lade Audit Logs...',
    empty: {
      title: 'Keine Audit Logs gefunden',
      subtitle: 'Passe deine Filter an oder warte auf neue Ereignisse'
    },
    details: {
      title: 'Audit Log Details',
      code: 'Ausgeführter Code',
      id: 'ID',
      action: 'Aktion',
      eventType: 'Event Type',
      severity: 'Schweregrad',
      timestamp: 'Zeitstempel',
      user: 'Benutzer',
      machine: 'Machine',
      details: 'Details'
    },
    actions: {
      LOGIN: 'Anmeldung',
      COMMAND_EXEC: 'Befehlsausführung',
      COMMAND_START: 'Befehl gestartet',
      COMMAND_END: 'Befehl beendet',
      SHELL_OPEN: 'Shell geöffnet',
      SHELL_CLOSE: 'Shell geschlossen',
      AGENT_EVENT: 'Agent-Ereignis',
      SESSION_CREATED: 'Sitzung erstellt',
      SESSION_ENDED: 'Sitzung beendet',
      RATE_LIMIT_EXCEEDED: 'Rate Limit überschritten',
      REPLAY_DETECTED: 'Replay erkannt',
      HMAC_FAILED: 'HMAC-Validierung fehlgeschlagen',
      BULK_PAGE_ACCESS: 'Bulk-Seite aufgerufen',
      BULK_JOB_CREATED: 'Bulk-Job erstellt',
      SECURITY_SCAN_TRIGGERED: 'Security-Scan ausgelöst'
    },
    severity: {
      info: 'Info',
      warn: 'Warnung',
      critical: 'Kritisch'
    }
  },
}

export default messages
