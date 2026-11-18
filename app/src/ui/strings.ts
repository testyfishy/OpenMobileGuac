/**
 * Every user-facing string in the app chrome, in one table (SPEC I18N-1 groundwork).
 * Functions take the variable parts so translations can reorder them.
 */
export const strings = {
  appName: 'OpenMobileGuac',

  common: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    continue: 'Continue',
    delete: 'Delete',
    done: 'Done',
    edit: 'Edit',
    retry: 'Try again',
    save: 'Save',
    saving: 'Saving…',
    loading: 'Loading…',
    refresh: 'Refresh',
    settings: 'Settings',
    moveUp: (name: string) => `Move ${name} up`,
    moveDown: (name: string) => `Move ${name} down`,
  },

  servers: {
    title: 'Servers',
    add: 'Add server',
    reorder: 'Reorder',
    empty: 'Add your Guacamole server to get started, or try the Demo.',
    demoName: 'Demo',
    demoBadge: 'Demo',
    demoSubtitle: 'Built-in sample desktop. Works offline.',
    devName: 'Dev server',
    devBadge: 'Dev',
    devSubtitle: 'From .env.local, through the Vite dev proxy',
    insecureBadge: 'http',
    insecureBadgeLabel: 'Unencrypted connection',
    selectPrompt: 'Select a server to see its connections.',
    openServer: (name: string) => `Open ${name}`,
    editServer: (name: string) => `Edit ${name}`,
  },

  serverForm: {
    addTitle: 'Add server',
    editTitle: 'Edit server',
    name: 'Name',
    namePlaceholder: 'Home lab',
    nameHint: 'Shown in the server list.',
    url: 'Server address',
    urlPlaceholder: 'guac.example:8080',
    urlHint: 'With or without http(s):// and /guacamole. The app finds the right address.',
    username: 'Username',
    password: 'Password',
    passwordKeep: 'Leave blank to keep the saved password',
    remember: 'Remember password on this device',
    rememberHintSecure: 'Stored in the device keychain / keystore.',
    rememberHintDev:
      'Development build: the password is stored UNENCRYPTED in browser storage. Use a test account.',
    rememberHintMemory:
      'Password not saved on this device yet: secure storage is unavailable here, so it is kept only until the app closes.',
    checking: 'Checking server…',
    found: (url: string) => `Found Guacamole at ${url}`,
    insecureNote:
      'This server uses plain http. Your password and session will not be encrypted in transit. That is usually fine on a private network such as Tailscale or a VPN.',
    deleteServer: 'Delete server',
    deleteTitle: (name: string) => `Delete “${name}”?`,
    deleteBody:
      'The server, its favourites, recents, saved password and settings will be removed from this device.',
    errors: {
      nameRequired: 'Enter a name.',
      urlRequired: 'Enter the server address.',
      urlInvalid: 'That does not look like a web address.',
      urlScheme: 'Only http:// and https:// addresses are supported.',
    },
  },

  login: {
    title: (server: string) => `Sign in to ${server}`,
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    restoring: 'Connecting…',
    additionalTitle: 'Additional verification',
    additionalHint: 'The server needs more information to finish signing in.',
    totpLabel: 'Authentication code',
    totpHint: 'Enter the code from your authenticator app.',
    totpEnrollHint:
      'Two-factor authentication must be set up for this account. Add this key to your authenticator app, then enter the code it shows.',
    totpSecret: 'Setup key',
    useDifferentAccount: 'Start over',
    savedPasswordRejected: 'The saved password was not accepted. Enter it again.',
    sessionExpired: 'Your session expired. Sign in again.',
    logout: 'Sign out',
    signedInAs: (user: string) => `Signed in as ${user}`,
    anonymous: 'Signed in (anonymous)',
  },

  httpWarning: {
    title: 'Send password without encryption?',
    body: (host: string) =>
      `${host} uses plain http. Your username, password and session will cross the network unencrypted. On a private network (Tailscale, VPN, home LAN) this is usually acceptable; on public Wi-Fi it is not.`,
    dontShowAgain: "Don't show again for this server",
    proceed: 'Send anyway',
  },

  errors: {
    unreachable: {
      title: 'Cannot reach the server',
      detail:
        'Check the address, and that this device is on the same network or VPN (for example Tailscale) as the server.',
      detailBrowser:
        'Check the address and your network. In a desktop browser this also appears when a server blocks cross-origin requests.',
    },
    timeout: {
      title: 'The server did not answer in time',
      detail: 'It may be offline, or your network or VPN connection may be down.',
    },
    tls: {
      title: 'Secure connection failed',
      detail:
        'The server’s HTTPS certificate is not trusted by this device. Self-signed certificates are not supported yet.',
    },
    notGuacamole: {
      title: 'Not a Guacamole server',
      detail: 'Something answered at that address, but it is not the Apache Guacamole web app.',
      status: (status: number) => `The server answered with HTTP ${status}.`,
    },
    invalidUrl: {
      empty: 'Enter the server address.',
      invalid: 'That does not look like a web address.',
      'unsupported-scheme': 'Only http:// and https:// addresses are supported.',
    },
    invalidCredentials: {
      title: 'Incorrect username or password',
      detail: 'Check them and try again.',
    },
    additional: {
      title: 'More information needed',
      detail: 'The server asked for additional credentials.',
    },
    sessionExpired: {
      title: 'Session expired',
      detail: 'Sign in again to continue.',
    },
    invalidResponse: {
      title: 'Unexpected response',
      detail: 'The server answered in a way this app does not understand.',
    },
    wrongCode: {
      title: 'That code was not accepted',
      detail: 'Wait for a new code and try again.',
    },
    server: {
      title: 'The server reported an error',
    },
    unknown: {
      title: 'Something went wrong',
      detail: 'Please try again.',
    },
  },

  connections: {
    title: 'Connections',
    search: 'Search connections',
    searchPlaceholder: 'Search',
    clearSearch: 'Clear search',
    favourites: 'Favourites',
    recents: 'Recent',
    all: 'All connections',
    empty: 'No connections are available to this account.',
    noResults: (q: string) => `No connections match “${q}”.`,
    loadFailed: 'Could not load connections',
    inUse: (n: number) => (n === 1 ? 'In use by 1 user' : `In use by ${n} users`),
    inUseShort: 'In use',
    addFavourite: (name: string) => `Add ${name} to favourites`,
    removeFavourite: (name: string) => `Remove ${name} from favourites`,
    expandGroup: (name: string) => `Expand ${name}`,
    collapseGroup: (name: string) => `Collapse ${name}`,
    connect: (name: string) => `Connect to ${name}`,
    pullToRefresh: 'Pull to refresh',
    releaseToRefresh: 'Release to refresh',
    refreshing: 'Refreshing…',
    balancing: 'Balancing group',
    dataSource: (ds: string) => `Source: ${ds}`,
    demoNotice:
      'Demo mode: a simulated desktop that runs on this device. Nothing is sent over the network.',
  },

  protocols: {
    rdp: 'RDP',
    vnc: 'VNC',
    ssh: 'SSH',
    telnet: 'Telnet',
    kubernetes: 'Kubernetes',
    demo: 'Demo',
    other: 'Remote',
  } as Record<string, string>,

  session: {
    disconnectTitle: (name: string) => `Disconnect from ${name}?`,
    disconnect: 'Disconnect',
    loading: 'Preparing session…',
  },

  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    sessionDefaults: 'Session defaults',
    sessionDefaultsHint:
      'Used for connections you have not changed in-session. Each connection remembers its own choices.',
    fitMode: 'View mode',
    fitModes: {
      'fit-screen': 'Fit screen',
      'fit-width': 'Fit width',
      'fit-height': 'Fit height',
      'one-to-one': '1:1',
    } as Record<string, string>,
    pointerMode: 'Pointer mode',
    pointerModes: { direct: 'Direct touch', trackpad: 'Trackpad' } as Record<string, string>,
    matchDeviceSize: 'Match remote size to device',
    matchDeviceSizeHint: 'Ask the server to resize the remote desktop where supported.',
    pointerSpeed: 'Trackpad pointer speed',
    naturalScroll: 'Natural scrolling',
    haptics: 'Haptic feedback',
    clipboard: 'Clipboard',
    clipboardRemoteToDevice: 'Copy remote clipboard to this device',
    clipboardAutoSendOnFocus: 'Send device clipboard when a session opens',
    clipboardAutoSendHint: 'On iOS this may show a paste permission prompt.',
    keepAwake: 'Keep screen awake during sessions',
    resetDefaults: 'Reset session defaults',
    about: 'About',
    version: 'Version',
    licence: 'Licence',
    licenceValue: 'Apache License 2.0',
    source: 'Source code',
    disclaimer:
      'Unofficial — not affiliated with or endorsed by the Apache Software Foundation. Apache Guacamole is a trademark of the ASF.',
    privacyTitle: 'Privacy',
    privacy:
      'No analytics, no tracking, no ads, no account. No data leaves this device except to the Guacamole servers you add.',
    storageTitle: 'Saved passwords',
    storageSecure: 'Saved in the device keychain / keystore.',
    storageDev: 'Development build: saved UNENCRYPTED in browser storage.',
    storageMemory: 'Password not saved on this device yet: kept in memory until the app closes.',
  },
} as const;

export const SOURCE_URL = 'https://github.com/testyfishy/OpenMobileGuac';
