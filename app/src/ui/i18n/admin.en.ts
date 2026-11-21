/**
 * English strings for connection management (`ui/admin/`). Same rules as `en.ts`: Spanish
 * (`admin.es.ts`) has the same shape, and functions take only primitive arguments.
 */

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const adminEn = {
  add: 'Add',
  addTitle: 'Add to this server',
  newConnection: 'New connection',
  newFolder: 'New folder',
  newConnectionHere: 'New connection in this folder',
  newFolderHere: 'New folder in this folder',
  folderActions: (name: string) => `Manage folder ${name}`,
  manageTitle: 'Manage on server',
  edit: 'Edit',
  editFolder: 'Edit folder',
  clone: 'Clone',
  move: 'Move to folder',
  delete: 'Delete',
  activity: 'Sessions and history',
  topLevel: 'Top level',
  serverDefault: 'Default',
  loading: 'Loading…',
  saved: (name: string) => `Saved “${name}”.`,
  created: (name: string) => `Created “${name}”.`,
  deleted: (name: string) => `Deleted “${name}”.`,
  moved: (name: string) => `Moved “${name}”.`,
  noPasswordStorage:
    'Values are sent straight to the server. Nothing you type here is stored on this device.',

  denied: {
    title: 'This account cannot change that',
    detail:
      'The server refused the change. Management options for this server are hidden until you refresh. Ask an administrator for the permission if you need it.',
    banner:
      'The server refused a change because this account lacks permission. Management options are hidden; pull to refresh to check again.',
  },
  notFound: {
    title: 'Not found on the server',
    detail: 'It may have been deleted or moved by someone else. Refresh the list.',
  },

  editor: {
    titleNew: 'New connection',
    titleEdit: (name: string) => `Edit ${name}`,
    titleClone: 'Clone connection',
    create: 'Create',
    save: 'Save',
    saving: 'Saving…',
    basics: 'Connection',
    name: 'Name',
    namePlaceholder: 'Office PC',
    location: 'Folder',
    chooseLocation: 'Choose folder',
    protocol: 'Protocol',
    protocolPick: 'Choose a protocol',
    dataSource: 'Data source',
    parameters: 'Parameters',
    attributes: 'Server-side limits and proxy',
    search: 'Search settings',
    searchPlaceholder: 'Search, e.g. wallpaper',
    noMatches: (q: string) => `No settings match “${q}”.`,
    setBadge: 'Set',
    setCount: (n: number) => plural(n, '1 set', `${n} set`),
    reset: (label: string) => `Reset ${label} to default`,
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    expand: (label: string) => `Show ${label}`,
    collapse: (label: string) => `Hide ${label}`,
    required: 'Required.',
    notNumber: 'Enter a whole number.',
    hostnameRequired: 'Enter the host name or IP address of the computer.',
    fixErrors: 'Check the highlighted fields.',
    loadFailed: 'Could not load this connection',
    cloneNotice:
      'This is an unsaved copy. Creating it adds a new connection; the original is not changed.',
    clonePasswords: (fields: string) =>
      `Copied stored secrets: ${fields}. If the original used any other password, enter it again.`,
    cloneNoPasswords:
      'The server sent no stored passwords for the original. If it uses one, enter it again here.',
    copyOf: (name: string) => `Copy of ${name}`,
    deleteConnection: 'Delete connection',
    pickProtocolFirst: 'Choose a protocol to see its settings.',
    unknownProtocol: (p: string) =>
      `The server does not describe the protocol “${p}”. Its parameters are listed under Advanced.`,
  },

  advanced: {
    title: 'Advanced parameters',
    hint: 'Set any parameter by its exact name, for parameters this server’s form does not list. Names are not checked.',
    name: 'Parameter name',
    value: 'Value',
    add: 'Add parameter',
    remove: (name: string) => `Remove ${name}`,
    invalidName: 'Use letters, digits, dots, dashes or underscores.',
    duplicate: 'That parameter has its own field above.',
    none: 'No extra parameters.',
  },

  unsaved: {
    title: 'Discard changes?',
    body: 'Your changes have not been saved to the server.',
    discard: 'Discard',
    keep: 'Keep editing',
  },

  perf: {
    title: 'Performance & quality',
    hint: 'Presets only change the ordinary parameters listed below. The change applies the next time someone connects.',
    presets: {
      best: 'Best quality',
      balanced: 'Balanced',
      low: 'Low bandwidth',
    },
    presetHints: {
      best: 'Full colour and every visual effect. Needs a fast connection.',
      balanced: 'Good picture, no wallpaper or animations.',
      low: 'Fewer colours, no effects or sound. For mobile data.',
    },
    current: (name: string) => `Current settings match “${name}”.`,
    custom: 'Current settings do not match a preset.',
    previewTitle: (name: string) => `Apply “${name}”?`,
    previewIntro: 'These parameters will change in this form:',
    previewOutro: 'Nothing is sent until you save.',
    noChanges: 'The connection already uses these settings.',
    apply: 'Apply',
    applied: (name: string) => `Applied “${name}”. Save to keep it.`,
    unset: 'default',
    on: 'on',
    off: 'off',
    labels: {
      'color-depth': 'Colours',
      'force-lossless': 'Lossless images only',
      'disable-gfx': 'Turn off graphics pipeline (GFX)',
      'resize-method': 'Follow the phone’s screen size',
      'enable-wallpaper': 'Show desktop wallpaper',
      'enable-theming': 'Window themes',
      'enable-font-smoothing': 'Smooth fonts',
      'enable-full-window-drag': 'Show window contents while dragging',
      'enable-desktop-composition': 'Transparency and shadows',
      'enable-menu-animations': 'Menu animations',
      'disable-bitmap-caching': 'Turn off bitmap cache',
      'disable-offscreen-caching': 'Turn off off-screen cache',
      'disable-glyph-caching': 'Turn off text cache',
      'disable-audio': 'Turn off sound',
      'quality-level': 'Picture quality',
      'compress-level': 'Compression',
      cursor: 'Mouse pointer',
      'enable-audio': 'Play sound',
    } as Record<string, string>,
    hints: {
      'force-lossless': 'Sharpest picture, but much more data.',
      'disable-gfx':
        'guacd uses 32-bit colour while GFX is on, so lower colour settings need this.',
      'disable-bitmap-caching': 'Caches save data; turn off only if the picture is corrupted.',
      'quality-level': '0 is smallest, 9 is sharpest. Used by Tight encoding.',
      'compress-level': '0 is none, 9 is most. More compression uses more server CPU.',
      'enable-audio': 'Needs PulseAudio on the remote computer.',
    } as Record<string, string>,
    options: {
      'color-depth=8': '256 colours',
      'color-depth=16': 'High colour (16-bit)',
      'color-depth=24': 'True colour (24-bit)',
      'color-depth=32': 'True colour (32-bit)',
      'resize-method=reconnect': 'Reconnect at the new size',
      'resize-method=display-update': 'Resize live (RDP 8.1 or later)',
      'cursor=local': 'Drawn on this device (faster)',
      'cursor=remote': 'Drawn by the server',
    } as Record<string, string>,
  },

  folder: {
    titleNew: 'New folder',
    titleEdit: (name: string) => `Edit folder ${name}`,
    namePlaceholder: 'Servers',
    type: 'Type',
    organizational: 'Folder',
    balancing: 'Balancing group',
    balancingHint:
      'Connecting to a balancing group picks one of its connections (the least busy one).',
    deleteFolder: 'Delete folder',
  },

  picker: {
    title: 'Choose folder',
    current: 'Current folder',
    noPermission: 'You cannot add to this folder',
    self: 'This folder',
    inside: 'Inside the folder being moved',
    moveHere: 'Move here',
    moveTitle: (name: string) => `Move ${name}`,
    moving: 'Moving…',
  },

  remove: {
    titleConnection: (name: string) => `Delete ${name}?`,
    titleFolder: (name: string) => `Delete folder ${name}?`,
    bodyConnection:
      'This permanently deletes the connection on the server, for every user, with its history and sharing profiles. It cannot be undone.',
    bodyFolder: (connections: number, folders: number) =>
      `This permanently deletes the folder on the server for every user, together with everything in it (at least ${plural(connections, '1 connection', `${connections} connections`)} and ${plural(folders, '1 folder', `${folders} folders`)}). It cannot be undone.`,
    confirm: 'Delete permanently',
    deleting: 'Deleting…',
  },

  sessions: {
    title: (name: string) => `Activity: ${name}`,
    active: 'Active sessions',
    noActive: 'Nobody is connected right now.',
    disconnect: 'Disconnect',
    disconnectTitle: (user: string) => `Disconnect ${user}?`,
    disconnectBody:
      'Their session ends immediately and anything unsaved on the remote computer may be lost.',
    disconnected: 'Session disconnected.',
    anonymous: 'Anonymous user',
    since: (time: string) => `Since ${time}`,
    from: (host: string) => `From ${host}`,
    history: 'Recent history',
    noHistory: 'No recorded use.',
    ongoing: 'Still connected',
    duration: (minutes: number) => plural(minutes, '1 minute', `${minutes} minutes`),
    unavailable: 'The server did not share this information with this account.',
    // All active sessions on the server (Settings › Active Sessions in the web client)
    allTitle: 'Active sessions',
    allButton: 'Active sessions on this server',
    allIntro:
      'Everyone connected right now, on every connection this account can see. Join opens their session next to yours; Disconnect ends it.',
    unknownConnection: 'Unknown connection',
    join: 'Join',
    joinTitle: (user: string, connection: string) => `Join ${user}’s session on ${connection}?`,
    joinBody:
      'You see their screen and your input reaches it, unless the connection is read-only. Guacamole tells the owner that someone joined. Joining does not change any of your settings.',
    joinedName: (connection: string, user: string) => `${connection} (${user})`,
    refresh: 'Refresh',
  },
};

export type AdminStrings = typeof adminEn;
