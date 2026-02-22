const messages = {
  login: {
    loading: {
      title: 'Initializing',
      subtitle: 'System handshake in progress...',
    },
    errors: {
      statusCheck: 'Failed to check system status',
      passwordMismatch: 'Passwords do not match',
      setupFailed: 'Setup failed',
      loginFailed: 'Login failed',
    },
    titles: {
      primary: {
        login: 'Sign in',
        setup: 'Initial setup',
      },
      form: {
        login: 'Sign in',
        setup: 'Create user',
      },
    },
    subtitles: {
      login: 'Enter your credentials.',
      setup: 'Create an account for this system.',
    },
    labels: {
      username: 'Username',
      password: 'Password',
      confirmPassword: 'Confirm password',
    },
    placeholders: {
      username: 'Username',
      password: '••••••••',
      confirmPassword: 'Confirm password',
    },
    buttons: {
      submitting: {
        login: 'Signing in...',
        setup: 'Creating account...',
      },
      submit: {
        login: 'Sign in',
        setup: 'Create account',
      },
    },
  },
  languageSetup: {
    eyebrow: 'Language setup',
    title: 'Choose your language',
    subtitle: 'Pick the language you want to use across ControlSphere. This preference is saved for every login and device.',
    errors: {
      saveFailed: 'Could not update your language preference.',
    },
    languages: {
      de: {
        tagline: 'German interface',
        title: 'Deutsch',
        description: 'Clear, concise German copy for operating your fleet from Europe.',
        flag: '🇩🇪',
      },
      en: {
        tagline: 'English interface',
        title: 'English',
        description: 'English UI for global teams and shared operations.',
        flag: '🇺🇸',
      },
    },
    cta: {
      active: 'Active language',
      switch: 'Switch language',
      select: 'Use this language',
    },
    saving: 'Saving preference...',
    footnote: 'You can change this later from your profile.',
  },
  severity: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  },
  appShell: {
    nav: {
      dashboard: 'System overview',
      bulk: 'Bulk management',
      security: 'Security',
      secure: 'Secure',
      audit: 'Audit logs',
      settings: 'Settings',
      users: 'User management',
    },
    actions: {
      toggleNav: 'Toggle navigation',
      addAgent: 'Agent',
      language: {
        title: 'Language',
        label: 'English',
        loading: 'Changing language...',
      },
      refresh: {
        title: 'Extend session',
        subtitle: 'Extends your login session by 30 minutes',
      },
      logout: {
        title: 'Log out',
        label: 'Log out',
        loading: 'Logging out...',
      },
    },
    sessionExpiry: {
      title: 'Session expiring',
      description: 'Your session expires in less than a minute. You will be logged out automatically.',
      cancel: 'Cancel',
      extend: 'Extend session',
      extending: 'Extending...',
    },
  },
  machine: {
    loading: {
      sync: 'Syncing node status...'
    },
    header: {
      eyebrow: 'Node Control',
      securityLink: 'View security events',
      securityBadge: '{count, plural, one {# event} other {# events}}'
    },
    status: {
      title: 'Status',
      lastSeen: 'Last seen',
      added: 'Added',
      connection: 'Connection',
      connected: 'Connected',
      disconnected: 'Disconnected',
      online: 'Online',
      offline: 'Offline',
      live: 'Live connected'
    },
    system: {
      title: 'System information',
      os: 'OS',
      kernel: 'Kernel',
      hostname: 'Hostname',
      ip: 'IP address'
    },
    actions: {
      title: 'Quick actions',
      openTerminal: 'Open terminal',
      systemUpdate: 'System update',
      agentUpdate: 'Agent update',
      reboot: 'Reboot',
      refresh: 'Refresh',
      executing: 'Executing: {command}',
      delete: {
        title: 'Delete machine',
        label: 'Remove'
      }
    },
    metrics: {
      title: 'Live metrics',
      cpu: 'CPU usage',
      ram: 'RAM usage',
      disk: 'Disk usage',
      uptime: 'Uptime'
    },
    analytics: {
      eyebrow: 'Historical analytics',
      title: 'Forecasting & trends (deterministic)',
      subtitle: 'SMA smoothing, linear regression and rates of change for CPU / RAM / Disk. No black-box AI, only transparent math.',
      badge: 'Weighted regression | adaptive SMA | Bollinger | R²',
      refresh: 'Refresh',
      loading: 'Loading...',
      processing: 'Computing time series...',
      tooFew: 'Not enough data points for the selected range.',
      series: {
        cpu: 'CPU',
        ram: 'RAM',
        disk: 'Disk'
      },
      smoothing: 'SMA smoothing (moving average, k={window})',
      smoothingHint: 'Smooths outliers and shows the mean trend (k = window size).',
      tiles: {
        disk: {
          title: 'Disk forecast',
          fullIn: 'Full in {time}',
          noLimit: 'No foreseeable limit',
          eta: 'ETA {time}',
          trend: 'Trend: {trend}',
          fillTrend: 'Fill trend active',
          fullAt: 'Full {time}',
          trendLabel: 'Trend: {trend}'
        },
        ramLeak: {
          title: 'RAM leak watch',
          noData: 'Not enough data'
        },
        cpu: {
          title: 'CPU headroom',
          ninetyIn: '90% in {time}',
          headroom: 'Sufficient headroom',
          eta: 'ETA {time}',
          stable: 'Trend stable'
        },
        dynamics: {
          title: 'System overview',
          cpuLine: 'CPU: {arrow} avg {avg}%',
          ramLine: 'RAM: {arrow} avg {avg}%',
          diskLine: 'Disk: {arrow} avg {avg}%',
        },
        trend: {
          rising: '↑ rising',
          falling: '↓ falling',
          stable: '→ stable'
        },
        insufficientData: 'Limited data — forecast uncertain',
        provision: {
          cpu: 'CPU provisioning',
          ram: 'RAM provisioning',
          disk: 'Disk outlook',
          leak: 'Leak tendency'
        }
      },
      error: 'Failed to load analytics',
      trend: {
        flat: 'flat'
      },
      statuses: {
        noData: 'No data',
        underprovisioned: 'Underprovisioned',
        overprovisioned: 'Overprovisioned',
        balanced: 'Balanced'
      },
      load: {
        high: 'Peak ~{peak}% — Headroom ~{headroom}% (tight)',
        low: 'Peak ~{peak}% — Unused ~{unused}%',
        balanced: 'Peak ~{peak}% — Headroom ~{headroom}%'
      },
      time: {
        decadeOrMore: '>10 years',
        years: '{value} years',
        days: '{value} days',
        hours: '{value} hrs',
        minutes: '{value} min'
      },
      downsample: {
        compacted: 'Downsample x{bucket} ({raw} raw points)',
        raw: '{raw} raw points'
      },
      confidence: {
        label: 'Confidence',
        high: 'High (R²≥0.7)',
        medium: 'Medium (R²≥0.35)',
        low: 'Low (R²<0.35)'
      },
      healthScore: {
        label: 'System health',
        badge: 'Score {score}%',
        ok: 'Stable',
        warn: 'Under load',
        critical: 'Critical'
      },
      bollinger: 'Bollinger band (±2σ)',
      trendLine: 'Trend line'
    },
    notes: {
      saved: 'Saved {time}'
    },
    errors: {
      agentUpdate: 'Failed to update agent',
      deleteMachine: 'Failed to delete machine',
      saveNotes: 'Failed to save notes',
      addLink: 'Failed to add link',
      linkValidation: 'Please provide a title and URL',
      deleteLink: 'Failed to delete link'
    },
    notesPanel: {
      title: 'Documentation & Notes',
      summary: '{notes, plural, one {Notes} other {Notes}} • {links} Links',
      unsaved: 'Unsaved changes',
      notesTitle: 'Team Notes',
      placeholder: 'Document runbooks, recovery procedures, maintenance windows, responsible teams...',
      save: 'Save',
      saving: 'Saving...',
      links: {
        title: 'Quick Links',
        count: '{count, plural, one {# Link} other {# Links}}',
        titlePlaceholder: 'Title',
        urlPlaceholder: 'https://...',
        descriptionPlaceholder: 'Description (optional)',
        add: 'Add',
        saving: 'Saving...',
        empty: 'No links yet',
        remove: 'Remove link'
      }
    },
    security: {
      title: 'Security Center',
      open: '{count, plural, one {# event} other {# events}} open • {severity}',
      safe: 'No open events • System secure',
      vulnerabilitiesFound: 'Vulnerabilities found — view details',
      severity: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
        info: 'Info'
      }
    },
    deleteModal: {
      title: 'Delete machine',
      description: 'Are you sure you want to delete the machine "{hostname}"? This action cannot be undone.',
      cancel: 'Cancel',
      confirm: 'Delete',
      deleting: 'Deleting...'
    },
    rebooting: {
      title: 'System restarting',
      subtitle: 'Please wait while the connection is restored...'
    }
  },
  bulkManagement: {
    loading: 'Loading bulk management...',
    header: {
      eyebrow: 'Bulk Management',
      title: 'Jobs & Executions',
      subtitle: 'Create new bulk jobs, open details, and track outputs live.'
    },
    actions: {
      newJob: 'New Bulk Job',
      refresh: 'Refresh'
    },
    dialog: {
      header: {
        eyebrow: 'Bulk Operation',
        title: '{count, plural, one {# machine} other {# machines}} selected',
        subtitle: 'Execute the same command across multiple hosts – either in parallel for speed, or in controlled waves for safety.',
        editingSubtitle: 'Edit job & rerun',
        loadingJobData: 'Job data is loading...',
        dryRun: 'Dry run: {total} {total, plural, one {target} other {targets}}{offline, plural, =0 {} other { (# offline)}}'
      },
      closeButton: 'Close'
    },
    form: {
      commandLabel: 'Define command',
      commandHint: 'This command will be executed on all selected machines',
      commandPlaceholder: 'e.g. apt update && apt upgrade -y',
      strategyLabel: 'Execution strategy',
      strategyParallel: '⚡ Parallel – All at once',
      strategyRolling: '🌊 Rolling – In controlled waves',
      strategyTipParallel: '💡 Fastest method, but higher risk if command fails',
      strategyTipRolling: '💡 Safer approach with step-by-step execution and error monitoring',
      configLabel: 'Configuration parameters',
      concurrencyLabel: 'Max concurrent hosts',
      batchSizeLabel: 'Hosts per wave',
      batchSizeHint: 'Number of machines processed in parallel per round',
      waitSecondsLabel: 'Pause (seconds)',
      failureToleranceLabel: 'Fault tolerance (%)',
      failureToleranceHint: 'Job will abort if this percentage fails',
      targetSelectionLabel: 'Select target hosts',
      targetSelectionPrefilledHint: 'Prefilled selection based on original job – adjust as needed.',
      targetSelectionGroupHint: 'Target selection from original group/dynamic; list is for reference.',
      noMachinesAvailable: 'No machines available',
      selectAll: 'All',
      clearSelection: 'Clear',
      online: 'Online',
      offline: 'Offline',
      dryRun: 'Dry Run',
      runJob: 'Run Job',
      running: 'Starting...',
      applyAndRun: 'Apply changes & run',
      runJobTitle: 'Start the job immediately on the selected machines with the chosen strategy',
      dryRunTitle: 'Simulate the job to see how many targets would be affected (no execution)',
      selectionSummary: '{count} of {total} {total, plural, one {machine} other {machines}} selected',
      cancel: 'Cancel'
    },
    jobsList: {
      title: 'Job history',
      empty: 'No jobs yet',
      noJobs: 'No bulk jobs created yet. Create your first job above.',
      unnamed: 'Unnamed Job',
      columns: {
        name: 'Job name',
        command: 'Command',
        mode: 'Mode',
        targets: 'Targets',
        status: 'Status',
        created: 'Created',
        actions: 'Actions'
      },
      statuses: {
        pending: 'Pending',
        running: 'Running',
        completed: 'Completed',
        failed: 'Failed',
        aborted: 'Aborted'
      },
      actions: {
        viewDetails: 'View details',
        rerun: 'Rerun',
        abort: 'Abort',
        delete: 'Delete'
      }
    },
    jobDetail: {
      title: 'Job execution',
      editAndRun: 'Edit & run',
      killSwitch: 'Kill switch',
      deleteJob: 'Delete job',
      close: 'Close',
      loading: 'Loading job details...',
      summary: 'Summary',
      executions: 'Executions',
      status: 'Status',
      totalTargets: 'Total targets',
      successful: 'Successful',
      failed: 'Failed',
      pending: 'Pending',
      created: 'Created',
      started: 'Started',
      completed: 'Completed',
      noExecutions: 'No executions',
      noLogs: 'No output yet',
      liveOutput: 'Live output',
      executionStatus: {
        pending: 'Pending',
        running: 'Running',
        success: 'Success',
        failed: 'Failed'
      }
    },
    errors: {
      jobDeleteConfirm: 'Are you sure you want to delete this job?',
      jobLoadFailed: 'Job could not be loaded',
      jobLoadFailedRetry: 'Job could not be loaded. Please try again.',
      deleteFailed: 'Error deleting job'
    }
  },
  bulkAuth: {
    eyebrow: 'ControlSphere',
    title: 'Bulk Management Access',
    heading: 'Authentication required',
    warning: {
      title: 'Elevated privileges required',
      body: 'Bulk operations allow running commands across multiple machines simultaneously. Save time with parallel execution and efficient infrastructure management—with full security.'
    },
    password: {
      label: 'Password',
      placeholder: '••••••••'
    },
    actions: {
      cancel: 'Cancel',
      submit: 'Grant access',
      verifying: 'Verifying...'
    },
    errors: {
      required: 'Please enter your password',
      wrong: 'Incorrect password',
      network: 'Connection error. Please try again.'
    }
  },
  security: {
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low'
    },
    header: {
      eyebrow: 'Security Center',
      title: 'Security Overview',
      subtitle: 'Status, events, and last scans per agent.'
    },
    badges: {
      systems: '{count, plural, one {# system} other {# systems}}',
      stable: '{count, plural, one {# stable} other {# stable}}',
      open: '{count, plural, one {# open} other {# open}}'
    },
    states: {
      loading: 'Loading security status...',
      empty: 'No systems found.'
    },
    cveSync: {
      eyebrow: 'CVE mirror',
      title: 'CVE Sync & Matching',
      subtitle: 'Uses OSV data and installed ecosystems to keep vulnerability definitions current.',
      automatic: 'Automatic trigger: every 2 hours after the server starts (scoped to detected package ecosystems).',
      manual: 'Manual trigger: run an immediate sync to refresh CVE data now.',
      button: 'Run CVE sync now',
      buttonLoading: 'Syncing...',
      state: 'Status: {status} • Last sync: {lastSync}',
      stateUnknown: 'unknown',
      status: {
        started: 'Manual CVE sync started.',
        alreadyRunning: 'A CVE sync is already running.',
        failed: 'CVE sync failed to start.'
      },
      viewMirror: 'View CVE mirror',
      mode: 'Mode: {mode}',
      coverage: 'Ecosystems: {count} • CVEs: {total}'
    },
    cveDialog: {
      title: 'CVE Mirror',
      subtitle: 'Latest mirrored CVEs with source links and publish dates.',
      loading: 'Loading CVEs...',
      empty: 'No CVEs mirrored yet.',
      published: 'Published: {date}',
      searchPlaceholder: 'Search by ID or description',
      filterSeverity: 'Severity',
      filterAll: 'All',
      noResults: 'No CVEs match your filters.'
    },
    cards: {
      status: {
        good: 'Secure',
        warn: 'Attention',
        critical: 'Critical'
      },
      agent: 'Agent:',
      events: 'Events: {count}',
      lastScan: 'Last scan {distance}',
      noScan: 'No scan received'
    }
  },
  securityDetail: {
    header: {
      eyebrow: 'SECURITY DETAIL',
      title: 'Vulnerability Analysis',
      subtitle: 'Real-time security events and system health metrics'
    },
    tabs: {
      events: 'Security Events',
      logs: 'Audit Logs',
      packages: 'Packages',
      ports: 'Ports'
    },
    sections: {
      securityEvents: 'Security Events',
      auditLogs: 'Audit Logs',
      packages: 'Packages',
      ports: 'Ports',
      handbook: 'How Scans Work',
      scanReport: 'Scan Report'
    },
    emptyStates: {
      events: {
        hint: 'No security events',
        detail: 'The agent has not detected any security issues on this system.'
      },
      logs: {
        hint: 'No audit logs',
        detail: 'This system has not generated any audit log entries yet.'
      },
      packages: {
        hint: 'No packages found',
        detail: 'Unable to query package information from this system.'
      },
      ports: {
        hint: 'No ports detected',
        detail: 'No listening ports could be detected on this system.'
      }
    },
    filters: {
      all: 'All events',
      important: 'Important (High + Medium)',
      highOnly: 'Critical only (High)',
      hiddenLow: 'low-priority hidden',
      noMatch: 'No events match the current filter.'
    },
    liveScan: {
      running: 'Scan running...',
      eta: 'ETA {seconds}s'
    },
    scanButton: {
      disabled: 'Active scan running — please wait for completion.'
    },
    cveDialog: {
      title: 'CVE Mirror',
      subtitle: 'Latest mirrored CVEs with source links and publish dates.',
      loading: 'Loading CVEs...',
      empty: 'No CVEs mirrored yet.',
      published: 'Published: {date}',
      searchPlaceholder: 'Search by ID or description',
      filterSeverity: 'Severity',
      filterAll: 'All',
      noResults: 'No CVEs match your filters.'
    },
    buttons: {
      download: 'Download',
      cancel: 'Cancel',
      close: 'Close',
      handbook: 'How it works',
      refresh: 'Refresh'
    },
    labels: {
      severity: 'Severity',
      timestamp: 'Timestamp',
      service: 'Service',
      description: 'Description',
      port: 'Port',
      protocol: 'Protocol',
      state: 'State',
      process: 'Process',
      package: 'Package',
      version: 'Version',
      manager: 'Manager',
      status: 'Status',
      command: 'Command',
      pathsScanned: 'Directories scanned for CVEs',
      pathsScannedEmpty: 'No scan paths were reported by the agent.'
    },
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low'
    },
    packageStatus: {
      securityUpdate: 'Security Update',
      updateAvailable: 'Update available',
      current: 'Current'
    },
    handbook: {
      title: 'How Scans Work',
      subtitle: 'The agent performs the following security checks every 30 minutes',
      sections: {
        fileIntegrity: {
          title: '1. File Integrity Monitoring',
          description: 'Monitors the entire filesystem for unexpected changes. Severity is automatically classified by path: system-critical files (e.g. /etc/) are rated HIGH, application files MEDIUM, and log/temp/Docker files LOW.',
          files: 'Monitored files:',
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
          description: 'Checks security-relevant configurations against best practices. Drift is classified as "medium" or "critical".',
          sshConfig: 'SSH Configuration (/etc/ssh/sshd_config):',
          expectations: [
            { key: 'PermitRootLogin', value: 'expected: no' },
            { key: 'PasswordAuthentication', value: 'expected: no' },
            { key: 'PermitEmptyPasswords', value: 'expected: no' }
          ]
        },
        authLogMonitoring: {
          title: '3. Auth Log Monitoring',
          description: 'Analyzes authentication logs for suspicious activities such as brute-force attacks or root logins.',
          failedLogins: 'Failed logins:',
          failedAttempts: [
            { range: '3-9 attempts', severity: 'medium' },
            { range: '10-49 attempts', severity: 'high' },
            { range: '50+ attempts', severity: 'critical' }
          ],
          rootLogins: 'Root logins:',
          rootLoginsDetail: 'Each successful root login is reported as a "medium" event.',
          monitoredFiles: 'Monitored log files:',
          logFiles: [
            '/var/log/auth.log (Debian/Ubuntu)',
            '/var/log/secure (RHEL/CentOS)'
          ]
        },
        scanInterval: {
          title: 'Scan Interval',
          description: 'All security checks are automatically performed by the agent every 30 minutes. The first scan starts shortly after the agent connects.',
          interval: 'every 30 minutes'
        },
        cveSync: {
          title: '4. CVE Sync & Matching',
          description: 'The server mirrors CVE/OSV data and matches it against installed packages.',
          automatic: 'Automatic trigger: every 2 hours after server start (OSV batch query, limited to detected ecosystems).',
          manual: 'Manual trigger: Security → "Run CVE sync now" starts an immediate mirror.',
          apiHint: 'API: POST /api/security/cve (status: GET /api/security/cve)'
        },
        cveCoverage: {
          title: '5. CVE Coverage Assurance',
          description: 'How the agent and server ensure all CVEs are checked across subsystems.',
          bullets: {
            serverMirror: 'Server mirrors OSV CVEs daily (Debian, Alpine, npm, PyPI, Maven, NuGet, Go, crates.io, Packagist, RubyGems, OSS-Fuzz).',
            agentPaths: 'Agent sends installed packages and optional scan paths (directories checked for vulnerable binaries/packages).',
            serverMatching: 'Server performs CVE matching centrally using mirrored data and ecosystem-aware version logic.',
            operatorChecks: 'Operators can view “Directories scanned for CVEs” in the scan report and rerun CVE sync via POST /api/security/cve.'
          }
        },
        severityClassification: {
          title: '6. Severity Classification',
          description: 'File integrity events are automatically classified by path to reduce noise and prioritize critical changes.',
          high: 'HIGH — System-critical paths',
          highPaths: '/etc/, /root/.ssh/, /usr/bin/, /usr/sbin/, /sbin/, /bin/, /boot/, /lib/',
          medium: 'MEDIUM — Application paths',
          mediumPaths: '/opt/, /srv/, /var/www/, /home/*/bin/, and other application directories',
          low: 'LOW — Logs & temporary files',
          lowPaths: '*.log, /var/log/, /tmp/, /var/cache/, Docker overlay layers, PM2 logs, letsencrypt logs',
          ignored: 'IGNORED — Completely filtered',
          ignoredPaths: '/var/lib/docker/containers/, /var/lib/apt/, /var/lib/dpkg/, /var/cache/apt/',
          filterNote: 'The default view hides LOW events. Use the filter buttons to show all events if needed.'
        }
      }
    },
    packageActions: {
      updateCommand: 'Update command',
      whySecurityUpdate: 'Why "Security Update"?',
      securityUpdateExplanation: 'This package has a security-relevant update according to the package source. The agent displays it until the latest secured version is installed.',
      afterUpdate: 'After the update, the agent will send the new package status on the next sync.',
      updateManagers: {
        apt: 'Update with apt',
        yum: 'Update with yum',
        dnf: 'Update with dnf',
        pacman: 'Update with pacman'
      }
    },
    tooltips: {
      fileIntegrity: 'Monitors critical system files on the machine',
      configDrift: 'Verifies security configurations are as expected',
      authMonitoring: 'Tracks suspicious authentication attempts',
      scanInterval: 'Shows how frequently security checks run'
    },
    modals: {
      handbook: {
        title: 'How Scans Work',
        description: 'The agent performs automated security scans and system checks'
      }
    },
    toasts: {
      scanStarted: 'Scan started! Packages will be updated shortly.',
      scanCompleted: 'Scan completed. Security data is being updated.',
      scanFailed: 'Scan could not be started.',
      connectionError: 'Connection error. Please try again.',
      scanTimeout: 'Scan is taking longer than expected. Check the logs.',
      eventsResolved: 'Security events have been updated.'
    }
  },
  auditLogs: {
    header: {
      title: 'Audit Logs',
      subtitle: 'System-wide events and critical actions at a glance'
    },
    buttons: {
      refresh: 'Refresh',
      refreshing: 'Refreshing...',
      export: 'CSV Export'
    },
    stats: {
      total: 'Total',
      info: 'Info',
      warnings: 'Warnings',
      critical: 'Critical'
    },
    filterSection: {
      title: 'Filter & Search',
      showMore: 'More Filters',
      showLess: 'Less'
    },
    searchPlaceholder: 'Search by action, event type, user, machine, details...',
    filterLabels: {
      severity: 'Severity',
      action: 'Action',
      from: 'From Date',
      to: 'To Date',
      all: 'All'
    },
    activeFilters: 'Active filters:',
    filterTags: {
      severity: 'Severity:',
      action: 'Action:',
      from: 'From:',
      to: 'To:'
    },
    loading: 'Loading audit logs...',
    empty: {
      title: 'No audit logs found',
      subtitle: 'Adjust your filters or wait for new events'
    },
    details: {
      title: 'Audit Log Details',
      code: 'Executed Code',
      id: 'ID',
      action: 'Action',
      eventType: 'Event Type',
      severity: 'Severity',
      timestamp: 'Timestamp',
      user: 'User',
      machine: 'Machine',
      details: 'Details'
    },
    actions: {
      LOGIN: 'Login',
      COMMAND_EXEC: 'Command Execution',
      COMMAND_START: 'Command Started',
      COMMAND_END: 'Command Ended',
      SHELL_OPEN: 'Shell Opened',
      SHELL_CLOSE: 'Shell Closed',
      AGENT_EVENT: 'Agent Event',
      SESSION_CREATED: 'Session Created',
      SESSION_ENDED: 'Session Ended',
      RATE_LIMIT_EXCEEDED: 'Rate Limit Exceeded',
      REPLAY_DETECTED: 'Replay Detected',
      HMAC_FAILED: 'HMAC Validation Failed',
      BULK_PAGE_ACCESS: 'Bulk Page Access',
      BULK_JOB_CREATED: 'Bulk Job Created',
      SECURITY_SCAN_TRIGGERED: 'Security Scan Triggered',
      USER_CREATED: 'User Created',
      USER_UPDATED: 'User Updated',
      USER_DELETED: 'User Deleted',
      USER_DEACTIVATED: 'User Deactivated',
      USER_ACTIVATED: 'User Activated',
      USER_ROLE_CHANGED: 'User Role Changed',
      USER_PASSWORD_RESET: 'Password Reset',
      USER_MACHINE_ACCESS_UPDATED: 'Machine Access Updated',
      USER_LOGIN_BLOCKED: 'Login Blocked',
      MACHINE_ACCESS_DENIED: 'Machine Access Denied',
    },
    severity: {
      info: 'Info',
      warn: 'Warning',
      critical: 'Critical'
    }
  },
  shared: {
    noData: 'No data'
  },
  addAgentModal: {
    title: 'Add Agent',
    subtitle: 'Install the agent on a new system',
    quickInstall: {
      title: 'Quick install (recommended)',
      description: 'Copy this command and run it on your Linux system:',
      download: 'Download install script',
      copyScript: 'Copy script',
    },
    copied: 'Copied!',
    copyFailed: 'Copy failed. Please copy manually.',
    notes: {
      title: 'Important notes:',
      root: 'The agent must run as root (sudo)',
      secret: 'Store the generated secret key securely',
      dashboard: 'The agent appears automatically in the dashboard after installation',
      port: 'Port 3000 must be reachable from the VM system',
    },
    close: 'Close',
  },
  dashboard: {
    loading: 'Calibrating systems...',
    hero: {
      eyebrow: 'SYSTEM OVERVIEW',
      title: 'Dashboard',
      subtitle: 'All agents and telemetry at a glance.',
    },
    stats: {
      online: '{count} online',
      total: '{count} total',
      critical: '{count} Critical',
      high: '{count} High',
      securityUpdates: '{count} Updates',
    },
    badges: {
      critical: '{count} Critical',
      high: '{count} High',
      medium: '{count} Medium',
      events: '{count, plural, one {# Event} other {# Events}}',
      updates: '{count, plural, one {# Update} other {# Updates}}',
      severityCritical: 'Critical',
      severityHigh: 'High',
      noIssues: 'No security issues',
    },
    empty: {
      title: 'No systems yet',
      subtitle: 'Install the agent or add a host to start receiving telemetry.',
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
    lastSeen: 'Last seen:',
  },
  serverSetup: {
    eyebrow: 'Server setup',
    title: 'Set your server URL',
    subtitle: 'Enter the URL that agents and browsers use to reach this server. Use your LAN IP — not the Docker container IP.',
    label: 'Server URL',
    placeholder: 'http://192.168.10.10:3000',
    hint: 'Examples: http://192.168.10.10:3000  ·  https://controlsphere.example.com  ·  http://truenas.local:3000',
    detectedHint: 'Auto-detected',
    save: 'Save and continue',
    saving: 'Saving...',
    savedFeedback: 'Saved — redirecting…',
    footnote: 'You can change this later in the settings.',
    errors: {
      saveFailed: 'Could not save the server URL.',
    },
  },
  settings: {
    eyebrow: 'Administration',
    title: 'Settings',
    subtitle: 'System-wide configuration for this ControlSphere instance.',
    serverUrl: {
      eyebrow: 'Network',
      title: 'Server URL',
      description: 'The public URL under which this server is reachable. Used by agent install scripts, WebSocket connections, and QR codes. Update this after any network reconfiguration.',
      inputLabel: 'New server URL',
      copy: 'Copy to clipboard',
      detected: 'Auto-detected from network interface',
      useDetected: 'Use this',
      save: 'Save',
      saving: 'Saving…',
      saveSuccess: 'URL saved successfully.',
      errorGeneric: 'Could not save. Expected format: http(s)://host:port',
      impactTitle: 'Affected by this setting',
      impactAgent: 'Agent install script (curl … | bash)',
      impactWs: 'WebSocket connections from running agents',
      impactInstall: 'Download URL for agent binary',
    },
  },
  userManagement: {
    eyebrow: 'Administration',
    title: 'User Management',
    subtitle: 'Manage users, roles, and machine access permissions.',
    breadcrumb: {
      settings: 'Settings',
      users: 'Users',
    },
    roles: {
      admin: 'Admin',
      user: 'User',
      viewer: 'Viewer',
    },
    roleDescriptions: {
      admin: 'Full access – user management, all machines',
      user: 'Own machines + assigned machines, terminal access',
      viewer: 'Read-only – no terminal, no commands',
    },
    table: {
      username: 'Username',
      role: 'Role',
      status: 'Status',
      machines: 'Machines',
      lastLogin: 'Last login',
      created: 'Created',
      actions: 'Actions',
      active: 'Active',
      inactive: 'Inactive',
      never: 'Never',
      noUsers: 'No users found.',
      allMachines: 'All (admin)',
    },
    create: {
      button: 'Create user',
      title: 'Create new user',
      subtitle: 'A secure password will be automatically generated.',
      username: 'Username',
      usernamePlaceholder: 'e.g. john.doe',
      role: 'Role',
      submit: 'Create user',
      creating: 'Creating...',
    },
    created: {
      title: 'User created successfully',
      subtitle: 'Save this password now — it will only be shown once.',
      warning: 'This password cannot be recovered. If lost, you must reset it.',
      password: 'Generated password',
      copied: 'Copied!',
      copy: 'Copy password',
      done: 'Done',
    },
    edit: {
      title: 'Edit user',
      role: 'Role',
      save: 'Save changes',
      saving: 'Saving...',
    },
    machines: {
      title: 'Machine access',
      subtitle: 'Assign machines this user can access.',
      available: 'Available machines',
      assigned: 'Assigned machines',
      search: 'Search machines...',
      noMachines: 'No machines available.',
      noAssigned: 'No machines assigned.',
      save: 'Save assignments',
      saving: 'Saving...',
      saved: 'Assignments saved.',
    },
    resetPassword: {
      button: 'Reset password',
      title: 'Reset password',
      confirm: 'This will generate a new password and invalidate the old one. Continue?',
      submit: 'Reset password',
      resetting: 'Resetting...',
      success: 'Password has been reset.',
      warning: 'Save this password now — it will only be shown once.',
    },
    deleteUser: {
      button: 'Delete',
      title: 'Delete user',
      confirm: 'Are you sure you want to delete user "{username}"? This action cannot be undone.',
      confirmLabel: 'Type the username to confirm',
      submit: 'Delete user',
      deleting: 'Deleting...',
    },
    toggleActive: {
      activate: 'Activate',
      deactivate: 'Deactivate',
    },
    errors: {
      loadFailed: 'Failed to load users.',
      createFailed: 'Failed to create user.',
      updateFailed: 'Failed to update user.',
      deleteFailed: 'Failed to delete user.',
      resetFailed: 'Failed to reset password.',
      machinesFailed: 'Failed to update machine assignments.',
      usernameExists: 'Username already exists.',
      usernameTooShort: 'Username must be at least 2 characters.',
    },
  },
}

export default messages
