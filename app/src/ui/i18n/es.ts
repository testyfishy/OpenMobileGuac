import type { Strings } from './en.ts';

/**
 * Spanish (neutral, "tú"). Same shape as `en.ts`; see docs/TRANSLATING.md.
 * Product and protocol names (Guacamole, RDP, VNC, SSH, Tailscale, Face ID) stay in English.
 */

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const es: Strings = {
  appName: 'OpenMobileGuac',

  common: {
    back: 'Atrás',
    cancel: 'Cancelar',
    close: 'Cerrar',
    continue: 'Continuar',
    delete: 'Eliminar',
    done: 'Listo',
    edit: 'Editar',
    retry: 'Reintentar',
    save: 'Guardar',
    saving: 'Guardando…',
    loading: 'Cargando…',
    refresh: 'Actualizar',
    settings: 'Ajustes',
    copy: 'Copiar',
    copied: 'Copiado',
    share: 'Compartir',
    remove: 'Quitar',
    connect: 'Conectar',
    details: 'Detalles',
    next: 'Siguiente',
    skip: 'Omitir',
    never: 'Nunca',
    immediately: 'Al instante',
    seconds: (n: number) => `${n} s`,
    minutes: (n: number) => `${n} min`,
    moveUp: (name: string) => `Subir ${name}`,
    moveDown: (name: string) => `Bajar ${name}`,
  },

  servers: {
    title: 'Servidores',
    add: 'Añadir servidor',
    reorder: 'Reordenar',
    empty: 'Añade tu servidor Guacamole para empezar, o prueba la demo.',
    demoName: 'Demo',
    demoBadge: 'Demo',
    demoSubtitle: 'Escritorio de ejemplo integrado. Funciona sin conexión.',
    devName: 'Servidor de desarrollo',
    devBadge: 'Dev',
    devSubtitle: 'Desde .env.local, a través del proxy de desarrollo de Vite',
    insecureBadge: 'http',
    insecureBadgeLabel: 'Conexión sin cifrar',
    selectPrompt: 'Elige un servidor para ver sus conexiones.',
    openServer: (name: string) => `Abrir ${name}`,
    editServer: (name: string) => `Editar ${name}`,
    recentTitle: 'Continuar donde lo dejaste',
    recentConnect: (name: string, server: string) => `Conectar a ${name} en ${server}`,
    openShareLink: 'Abrir un enlace compartido',
    more: 'Más',
  },

  serverForm: {
    addTitle: 'Añadir servidor',
    editTitle: 'Editar servidor',
    name: 'Nombre',
    namePlaceholder: 'Laboratorio de casa',
    nameHint: 'Se muestra en la lista de servidores.',
    url: 'Dirección del servidor',
    urlPlaceholder: 'guac.example:8080',
    urlHint: 'Con o sin http(s):// y /guacamole. La app encuentra la dirección correcta.',
    username: 'Usuario',
    password: 'Contraseña',
    passwordKeep: 'Déjala en blanco para conservar la contraseña guardada',
    remember: 'Recordar la contraseña en este dispositivo',
    rememberHintSecure: 'Se guarda en el llavero / almacén de claves del dispositivo.',
    rememberHintDev:
      'Versión de desarrollo: la contraseña se guarda SIN CIFRAR en el almacenamiento del navegador. Usa una cuenta de prueba.',
    rememberHintMemory:
      'La contraseña aún no se guarda en este dispositivo: el almacenamiento seguro no está disponible aquí, así que solo se conserva hasta cerrar la app.',
    checking: 'Comprobando el servidor…',
    found: (url: string) => `Guacamole encontrado en ${url}`,
    insecureNote:
      'Este servidor usa http sin cifrar. Tu contraseña y tu sesión viajarán sin cifrar. Suele ser aceptable en una red privada como Tailscale o una VPN.',
    deleteServer: 'Eliminar servidor',
    deleteTitle: (name: string) => `¿Eliminar «${name}»?`,
    deleteBody:
      'Se quitarán de este dispositivo el servidor, sus favoritos, recientes, miniaturas, la contraseña guardada, la clave de doble factor y los ajustes.',
    duplicate: 'Duplicar servidor',
    duplicateName: (name: string) => `${name} (copia)`,
    clearCredentials: 'Borrar credenciales guardadas',
    clearCredentialsTitle: '¿Borrar las credenciales guardadas?',
    clearCredentialsBody:
      'Se eliminan de este dispositivo la contraseña guardada, el token de sesión y cualquier clave de doble factor de este servidor. La próxima vez tendrás que iniciar sesión.',
    credentialsCleared: 'Credenciales guardadas borradas.',
    test: 'Probar conexión',
    testing: 'Probando…',
    optionsTitle: 'Opciones de este servidor',
    optionsHint:
      'Sustituye los valores predeterminados de sesión de la app para todas las conexiones de este servidor. Lo que elijas dentro de cada conexión sigue teniendo prioridad.',
    inherit: 'Valor de la app',
    clipboardPolicy: 'Portapapeles',
    clipboardBoth: 'En ambos sentidos',
    clipboardToDevice: 'Remoto → dispositivo',
    clipboardOff: 'Solo manual',
    httpWarning: 'Avisar antes de enviar la contraseña por http',
    httpWarningHint: 'Desactívalo solo en una red privada de confianza.',
    hintsTitle: 'Lo que informa este servidor',
    hintsDataSources: 'Fuentes de autenticación',
    hintsNotSignedIn: 'Inicia sesión para ver lo que informa el servidor.',
    hintsTotp: 'Al iniciar sesión se pidió autenticación de doble factor (TOTP).',
    hintsSso: 'Al iniciar sesión se pidió inicio de sesión único.',
    sso: {
      title: 'Inicio de sesión único (experimental)',
      mode: 'Cómo completar el inicio de sesión único',
      webview: 'Navegador integrado',
      callback: 'Retorno a la app (OpenID)',
      hint: 'Solo se usa cuando el servidor pide iniciar sesión con un proveedor de identidad (OpenID, SAML o CAS). «Retorno a la app» requiere que tu proveedor de identidad acepte openmobileguac://sso-callback como dirección de redirección. Consulta docs/sso.md.',
    },
    totp: {
      title: 'Clave de doble factor guardada',
      warning:
        'Guardar la clave de doble factor en el mismo dispositivo que la contraseña significa que basta con robar un teléfono desbloqueado para iniciar sesión. Debilita la protección de doble factor. Úsala solo si lo aceptas.',
      enable: 'Rellenar los códigos de doble factor automáticamente',
      input: 'Clave de configuración o enlace otpauth://',
      inputHint:
        'La clave Base32 o el enlace otpauth:// que te muestra tu administrador o tu app de autenticación.',
      save: 'Guardar clave',
      remove: 'Quitar la clave guardada',
      saved: 'Clave guardada en este dispositivo.',
      removed: 'Clave guardada eliminada.',
      present: 'Hay una clave guardada para este servidor.',
      showCode: 'Mostrar el código actual',
      needsLock:
        'Activa antes «Pedir Face ID / huella / código del dispositivo» en Ajustes. La clave solo se usa después de desbloquear.',
      noSecureStorage:
        'El almacenamiento seguro no está disponible aquí, así que no se puede guardar una clave de doble factor en este dispositivo.',
      preview: (code: string, seconds: number) => `Código actual ${code} · quedan ${seconds} s`,
      errors: {
        empty: 'Escribe la clave.',
        base32: 'No es una clave Base32 válida.',
        uri: 'No es un enlace otpauth://totp válido.',
        algorithm: 'Ese algoritmo de hash no es compatible.',
        digits: 'Los códigos deben tener de 6 a 8 dígitos.',
        period: 'Ese periodo de código no es compatible.',
        short: 'La clave es demasiado corta.',
      } as Record<string, string>,
    },
    errors: {
      nameRequired: 'Escribe un nombre.',
      urlRequired: 'Escribe la dirección del servidor.',
      urlInvalid: 'No parece una dirección web.',
      urlScheme: 'Solo se admiten direcciones http:// y https://.',
    },
  },

  connectionTest: {
    title: 'Prueba de conexión',
    candidate: 'Dirección probada',
    ok: 'Correcto',
    failed: 'Error',
    skipped: 'No probado',
    api: 'API de Guacamole',
    websocket: 'Túnel WebSocket',
    latency: 'Ida y vuelta',
    ms: (ms: number) => `${ms} ms`,
    invalid: 'Escribe primero una dirección de servidor válida.',
    failures: {
      unreachable: 'sin respuesta',
      timeout: 'tiempo agotado',
      tls: 'certificado no fiable',
      'not-guacamole': 'no es Guacamole',
    } as Record<string, string>,
    websocketDetail: {
      error: 'la WebView no pudo abrirlo',
      timeout: 'sin respuesta',
      closed: 'cerrado por el servidor o por un proxy',
    } as Record<string, string>,
    wsHintTls:
      'La API funciona pero el túnel no. Con HTTPS suele significar que la WebView no confía en el certificado (consulta Ajustes › Diagnóstico y docs/tls.md); detrás de un proxy inverso, comprueba que reenvía las conexiones WebSocket.',
    allGood: 'Todo lo necesario para una sesión ha respondido.',
  },

  login: {
    title: (server: string) => `Iniciar sesión en ${server}`,
    signIn: 'Iniciar sesión',
    signingIn: 'Iniciando sesión…',
    restoring: 'Conectando…',
    additionalTitle: 'Verificación adicional',
    additionalHint: 'El servidor necesita más información para terminar de iniciar sesión.',
    totpLabel: 'Código de autenticación',
    totpHint: 'Escribe el código de tu app de autenticación.',
    totpEnrollHint:
      'Esta cuenta debe configurar la autenticación de doble factor. Añade esta clave a tu app de autenticación y escribe el código que muestre.',
    totpSecret: 'Clave de configuración',
    totpAutofilled: (seconds: number) => `Rellenado con la clave guardada · quedan ${seconds} s`,
    totpWaiting: (seconds: number) =>
      `Ese código se acaba de usar. Esperando ${seconds} s a uno nuevo…`,
    useDifferentAccount: 'Empezar de nuevo',
    savedPasswordRejected: 'No se aceptó la contraseña guardada. Escríbela de nuevo.',
    sessionExpired: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    logout: 'Cerrar sesión',
    signedInAs: (user: string) => `Sesión iniciada como ${user}`,
    anonymous: 'Sesión iniciada (anónima)',
    unlockForCredentials: 'Desbloquea para usar la contraseña guardada',
    lockedOut: 'No se usaron las credenciales guardadas porque se canceló el desbloqueo.',
    sso: {
      title: 'Inicio de sesión único',
      body: (provider: string) =>
        `Este servidor inicia tu sesión a través de ${provider}. La página de inicio de sesión se abre dentro de la app.`,
      providers: {
        openid: 'tu proveedor OpenID Connect',
        saml: 'tu proveedor de identidad SAML',
        cas: 'CAS',
        unknown: 'un proveedor de identidad',
      } as Record<string, string>,
      button: 'Ir a la página de inicio de sesión',
      experimental:
        'Experimental: comprobado con el código de Guacamole, no con un proveedor de identidad real.',
      waiting: 'Termina de iniciar sesión en la página que se ha abierto…',
      unavailable:
        'El inicio de sesión único necesita la app móvil. En un navegador de escritorio no se puede completar aquí.',
      cancelled: 'Se canceló el inicio de sesión.',
      failed: 'El servidor no aceptó el resultado del inicio de sesión.',
      race: 'La propia página web del servidor usó el resultado de un solo uso antes que la app. Vuelve a intentarlo; si sigue pasando, pregunta a tu administrador por el retorno a la app (docs/sso.md).',
    },
  },

  httpWarning: {
    title: '¿Enviar la contraseña sin cifrar?',
    body: (host: string) =>
      `${host} usa http sin cifrar. Tu usuario, tu contraseña y tu sesión cruzarán la red sin cifrar. En una red privada (Tailscale, VPN, red de casa) suele ser aceptable; en una wifi pública, no.`,
    dontShowAgain: 'No volver a mostrar para este servidor',
    proceed: 'Enviar igualmente',
  },

  errors: {
    unreachable: {
      title: 'No se puede conectar con el servidor',
      detail:
        'Comprueba la dirección y que este dispositivo está en la misma red o VPN (por ejemplo Tailscale) que el servidor.',
      detailBrowser:
        'Comprueba la dirección y tu red. En un navegador de escritorio también aparece cuando el servidor bloquea las peticiones de otro origen.',
    },
    timeout: {
      title: 'El servidor no respondió a tiempo',
      detail: 'Puede estar apagado, o tu red o tu VPN pueden haberse caído.',
    },
    tls: {
      title: 'El certificado del servidor no es de confianza',
      detail:
        'Este dispositivo no confía en el certificado HTTPS (autofirmado o de una CA privada). La app nunca se salta la comprobación de certificados. Opciones: instala tu certificado de CA en el dispositivo como raíz de confianza; usa un certificado de confianza pública (por ejemplo los certificados HTTPS de Tailscale para nombres *.ts.net); o, en una red privada de confianza, usa la dirección http:// del servidor.',
    },
    notGuacamole: {
      title: 'No es un servidor Guacamole',
      detail: 'Algo respondió en esa dirección, pero no es la aplicación web Apache Guacamole.',
      status: (status: number) => `El servidor respondió con HTTP ${status}.`,
    },
    invalidUrl: {
      empty: 'Escribe la dirección del servidor.',
      invalid: 'No parece una dirección web.',
      'unsupported-scheme': 'Solo se admiten direcciones http:// y https://.',
    },
    invalidCredentials: {
      title: 'Usuario o contraseña incorrectos',
      detail: 'Revísalos y vuelve a intentarlo.',
    },
    additional: {
      title: 'Se necesita más información',
      detail: 'El servidor pidió credenciales adicionales.',
    },
    sessionExpired: {
      title: 'Sesión caducada',
      detail: 'Vuelve a iniciar sesión para continuar.',
    },
    invalidResponse: {
      title: 'Respuesta inesperada',
      detail: 'El servidor respondió de una forma que esta app no entiende.',
    },
    wrongCode: {
      title: 'No se aceptó ese código',
      detail: 'Espera a un código nuevo y vuelve a intentarlo.',
    },
    server: {
      title: 'El servidor informó de un error',
    },
    unknown: {
      title: 'Algo ha fallado',
      detail: 'Vuelve a intentarlo.',
    },
  },

  connections: {
    title: 'Conexiones',
    search: 'Buscar conexiones',
    searchPlaceholder: 'Buscar',
    clearSearch: 'Borrar búsqueda',
    favourites: 'Favoritos',
    recents: 'Recientes',
    all: 'Todas las conexiones',
    empty: 'Esta cuenta no tiene conexiones disponibles.',
    noResults: (q: string) => `Ninguna conexión coincide con «${q}».`,
    loadFailed: 'No se pudieron cargar las conexiones',
    inUse: (n: number) => (n === 1 ? 'En uso por 1 usuario' : `En uso por ${n} usuarios`),
    inUseShort: 'En uso',
    addFavourite: (name: string) => `Añadir ${name} a favoritos`,
    removeFavourite: (name: string) => `Quitar ${name} de favoritos`,
    expandGroup: (name: string) => `Desplegar ${name}`,
    collapseGroup: (name: string) => `Contraer ${name}`,
    connect: (name: string) => `Conectar a ${name}`,
    connectGroup: (name: string) => `Conectar a ${name} (grupo de balanceo)`,
    pullToRefresh: 'Desliza para actualizar',
    releaseToRefresh: 'Suelta para actualizar',
    refreshing: 'Actualizando…',
    balancing: 'Grupo de balanceo',
    dataSource: (ds: string) => `Origen: ${ds}`,
    demoNotice:
      'Modo demo: un escritorio simulado que se ejecuta en este dispositivo. No se envía nada por la red.',
    sort: 'Ordenar',
    sortModes: {
      server: 'Orden del servidor',
      name: 'Nombre',
      protocol: 'Protocolo',
      recent: 'Usadas recientemente',
    } as Record<string, string>,
    details: (name: string) => `Detalles de ${name}`,
    protocol: 'Protocolo',
    group: 'Grupo',
    rootGroup: 'Nivel superior',
    activeUsers: 'Usuarios activos',
    identifier: 'Identificador',
    source: 'Origen de datos',
    lastUsed: 'Último uso',
    sharingProfiles: 'Perfiles para compartir',
    sharingHint:
      'Los enlaces compartidos se crean desde una sesión abierta en la aplicación web de Guacamole. Abre un enlace que hayas recibido con «Abrir un enlace compartido» en la lista de servidores.',
    copyLink: 'Copiar enlace de la app',
    linkCopied:
      'Enlace copiado. Añádelo como acceso directo en la pantalla de inicio con tu launcher o con la app Atajos.',
    openSessionBadge: 'Abierta',
    swipeHint: 'Desliza para ver acciones',
    linkServerMissing: 'Ese enlace apunta a un servidor que no está guardado en este dispositivo.',
    linkConnectionMissing: 'Esa conexión ya no está disponible en este servidor.',
  },

  shareLink: {
    title: 'Abrir un enlace compartido',
    label: 'Enlace compartido',
    hint: 'Un enlace que alguien compartió desde una sesión de Guacamole, terminado en ?key=…',
    invalid: 'No es un enlace compartido de Guacamole.',
    open: 'Abrir',
    signingIn: 'Abriendo…',
    separate:
      'Se abre como una sesión aparte y temporal: no se guarda nada y tu propio inicio de sesión en este servidor no cambia.',
    serverName: (name: string) => `${name} (enlace compartido)`,
    badge: 'Compartido',
    subtitle: (host: string) => `Sesión temporal de enlace compartido · ${host}`,
    ended:
      'Esta sesión de enlace compartido ha terminado. Vuelve a abrir el enlace para continuar.',
    end: (name: string) => `Cerrar ${name}`,
    failed: 'El servidor no aceptó ese enlace compartido. Puede haber caducado.',
  },

  protocols: {
    rdp: 'RDP',
    vnc: 'VNC',
    ssh: 'SSH',
    telnet: 'Telnet',
    kubernetes: 'Kubernetes',
    demo: 'Demo',
    other: 'Remoto',
  } as Record<string, string>,

  session: {
    disconnectTitle: (name: string) => `¿Salir de ${name}?`,
    disconnectBody: 'Mantén la sesión abierta para volver a ella, o desconéctala ahora.',
    disconnect: 'Desconectar',
    keepOpen: 'Mantener abierta',
    loading: 'Preparando la sesión…',
    switcherTitle: 'Sesiones abiertas',
    indicator: (n: number) => `${n} ${plural(n, 'sesión abierta', 'sesiones abiertas')}`,
    show: 'Mostrar',
    switchTo: (name: string) => `Cambiar a ${name}`,
    closeSession: (name: string) => `Desconectar ${name}`,
    backToList: 'Volver a las conexiones',
    current: 'En pantalla',
    limitTitle: 'Demasiadas sesiones abiertas',
    limitBody: (n: number) =>
      `Puede haber hasta ${n} ${plural(n, 'sesión abierta', 'sesiones abiertas')} a la vez (Ajustes › Sesiones). Desconecta una para abrir otra.`,
    closeOldest: (name: string) => `Desconectar ${name} y continuar`,
    suspendedTitle: 'Desconectada para ahorrar batería',
    suspendedBody:
      'La app estuvo en segundo plano más tiempo del indicado en Ajustes, así que esta sesión se cerró de forma ordenada.',
    reconnect: 'Volver a conectar',
    reconnecting: 'Volviendo a conectar…',
    signInAgain: 'Volver a iniciar sesión',
    reloginFailed: 'La sesión caducó y la app no pudo volver a iniciarla por sí sola.',
  },

  lock: {
    title: 'Bloqueada',
    body: 'Desbloquea con Face ID, tu huella o el código del dispositivo para continuar.',
    unlock: 'Desbloquear',
    failed: 'No se desbloqueó. Vuelve a intentarlo.',
    reason: 'Desbloquear OpenMobileGuac',
    credentialReason: 'Usar las credenciales guardadas',
    cancel: 'Cancelar',
  },

  settings: {
    title: 'Ajustes',
    appearance: 'Apariencia',
    theme: 'Tema',
    themeSystem: 'Sistema',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    language: 'Idioma',
    languageSystem: 'Idioma del dispositivo',
    sessionDefaults: 'Valores predeterminados de sesión',
    sessionDefaultsHint:
      'Se usan en las conexiones que no hayas cambiado durante la sesión. Cada conexión recuerda lo que elijas en ella.',
    fitMode: 'Modo de vista',
    fitModes: {
      'fit-screen': 'Ajustar a pantalla',
      'fit-width': 'Ajustar al ancho',
      'fit-height': 'Ajustar al alto',
      'one-to-one': '1:1',
    } as Record<string, string>,
    pointerMode: 'Modo de puntero',
    pointerModes: {
      direct: 'Toque directo',
      trackpad: 'Trackpad',
      touch: 'Toque nativo',
    } as Record<string, string>,
    matchDeviceSize: 'Ajustar el tamaño remoto al dispositivo',
    matchDeviceSizeHint:
      'Pide al servidor que cambie el tamaño del escritorio remoto cuando sea posible.',
    pointerSpeed: 'Velocidad del puntero (trackpad)',
    naturalScroll: 'Desplazamiento natural',
    haptics: 'Respuesta háptica',
    clipboard: 'Portapapeles',
    clipboardRemoteToDevice: 'Copiar el portapapeles remoto a este dispositivo',
    clipboardAutoSendOnFocus: 'Enviar el portapapeles del dispositivo al abrir una sesión',
    clipboardAutoSendHint: 'En iOS puede aparecer un aviso de permiso para pegar.',
    keepAwake: 'Mantener la pantalla encendida durante las sesiones',
    resetDefaults: 'Restablecer valores de sesión',
    security: 'Seguridad',
    lockEnable: 'Pedir Face ID / huella / código del dispositivo',
    lockHint:
      'Se pide al volver de segundo plano y antes de usar las credenciales guardadas. Mientras esté activado, el contenido de la app se oculta en el selector de apps.',
    lockUnavailableWeb: 'Solo disponible en la app móvil.',
    lockUnavailableDevice: 'Configura antes un código, Face ID o huella en el dispositivo.',
    lockAfter: 'Bloquear cuando la app lleve en segundo plano',
    lockOffWithSeeds:
      'Las claves de doble factor guardadas solo se usan tras desbloquear. Si desactivas el bloqueo, se eliminarán de este dispositivo.',
    lockOffConfirm: 'Desactivar y eliminar claves',
    sessions: 'Sesiones',
    maxSessions: 'Sesiones abiertas a la vez',
    maxSessionsHint:
      'Cada sesión abierta consume memoria y datos. En dispositivos antiguos puede ser mejor 1 o 2.',
    backgroundDisconnect: 'Desconectar las sesiones cuando la app lleve en segundo plano',
    backgroundDisconnectHint: 'Ahorra batería y datos. Puedes volver a conectar con un toque.',
    thumbnails: 'Guardar una miniatura de cada sesión',
    thumbnailsHint:
      'Una imagen pequeña de la última pantalla, que se muestra en recientes. Solo se guarda en este dispositivo.',
    clearThumbnails: 'Eliminar las miniaturas guardadas',
    thumbnailsCleared: 'Miniaturas eliminadas.',
    data: 'Datos y ayuda',
    backup: 'Copia de seguridad y restauración',
    diagnostics: 'Diagnóstico',
    introduction: 'Ver de nuevo la introducción',
    about: 'Acerca de',
    version: 'Versión',
    licence: 'Licencia',
    licenceValue: 'Apache License 2.0',
    source: 'Código fuente',
    disclaimer:
      'No oficial: sin relación con la Apache Software Foundation ni respaldada por ella. Apache Guacamole es una marca de la ASF.',
    privacyTitle: 'Privacidad',
    privacy:
      'Sin analíticas, sin seguimiento, sin anuncios, sin cuenta. Ningún dato sale de este dispositivo salvo hacia los servidores Guacamole que añadas.',
    storageTitle: 'Contraseñas guardadas',
    storageSecure: 'Guardadas en el llavero / almacén de claves del dispositivo.',
    storageDev: 'Versión de desarrollo: se guardan SIN CIFRAR en el almacenamiento del navegador.',
    storageMemory:
      'La contraseña aún no se guarda en este dispositivo: se conserva en memoria hasta cerrar la app.',
  },

  backup: {
    title: 'Copia de seguridad y restauración',
    intro:
      'Una copia de seguridad es un archivo JSON con tus servidores, favoritos, recientes y los ajustes de cada conexión y de la app. Las contraseñas, los tokens de sesión y las claves de doble factor quedan fuera salvo que elijas lo contrario.',
    exportTitle: 'Exportar',
    exportButton: 'Exportar copia',
    exporting: 'Exportando…',
    exported: (file: string) => `Se guardó ${file}.`,
    includeSecrets: 'Incluir contraseñas guardadas y claves de doble factor',
    includeSecretsHint:
      'Se cifran con una frase de contraseña que tú eliges. Quien tenga el archivo y la frase podrá iniciar sesión como tú. Los tokens de sesión nunca se incluyen.',
    passphrase: 'Frase de contraseña',
    passphraseConfirm: 'Repite la frase de contraseña',
    passphraseShort: 'Usa al menos 8 caracteres.',
    passphraseMismatch: 'Las frases de contraseña no coinciden.',
    importTitle: 'Restaurar',
    chooseFile: 'Elegir archivo de copia',
    fileSummary: (servers: number, date: string) =>
      `${servers} ${plural(servers, 'servidor', 'servidores')}${date ? `, exportada el ${date}` : ''}.`,
    skipped: (n: number) =>
      `Se ${plural(n, 'omitió 1 entrada no válida', `omitieron ${n} entradas no válidas`)}.`,
    mode: 'Cómo restaurar',
    merge: 'Combinar',
    replace: 'Sustituir',
    mergeHint: 'Añade los servidores nuevos y actualiza los que coincidan. No se elimina nada.',
    replaceHint:
      'Elimina todos los servidores guardados en este dispositivo, con sus contraseñas y claves de doble factor, y después restaura el archivo.',
    restoreSettings: 'Restaurar también los ajustes de la app',
    secretsInFile: 'Este archivo contiene contraseñas o claves de doble factor cifradas.',
    secretsPassphrase: 'Frase de contraseña de la parte cifrada (déjala en blanco para omitirla)',
    badPassphrase:
      'Frase de contraseña incorrecta. Déjala en blanco para restaurar sin contraseñas.',
    restore: 'Restaurar',
    restoring: 'Restaurando…',
    restored: (added: number, updated: number, removed: number) =>
      `Restaurado: ${added} ${plural(added, 'añadido', 'añadidos')}, ${updated} ${plural(updated, 'actualizado', 'actualizados')}${removed ? `, ${removed} ${plural(removed, 'eliminado', 'eliminados')}` : ''}.`,
    replaceConfirmTitle: '¿Sustituir todos los servidores?',
    replaceConfirm: 'Sustituir',
    errors: {
      json: 'Ese archivo no es JSON válido.',
      format: 'No es una copia de seguridad de OpenMobileGuac.',
      version:
        'Esta copia la creó una versión más reciente de la app. Actualiza la app y vuelve a intentarlo.',
      shape: 'El archivo de copia está dañado.',
      read: 'No se pudo leer el archivo.',
      save: 'No se pudo guardar la copia.',
    } as Record<string, string>,
  },

  diagnostics: {
    title: 'Diagnóstico',
    privacy:
      'Este registro se queda en este dispositivo. No se envía a ningún sitio salvo que tú lo copies o lo compartas. Las contraseñas y los tokens siempre se eliminan.',
    logTitle: 'Registro',
    level: 'Mostrar',
    levels: { debug: 'Todo', info: 'Info', warn: 'Avisos', error: 'Errores' } as Record<
      string,
      string
    >,
    hideHosts: 'Ocultar nombres y direcciones de servidores',
    hideHostsHint: 'Recomendado antes de compartirlo en un informe de error público.',
    copy: 'Copiar registro',
    share: 'Compartir registro',
    clear: 'Borrar registro',
    empty: 'Todavía no hay nada registrado.',
    copied: 'Registro copiado.',
    deviceTitle: 'Acerca de este dispositivo',
    appVersion: 'Versión de la app',
    platform: 'Plataforma',
    webView: 'Motor web',
    screen: 'Pantalla',
    locale: 'Idioma',
    userAgent: 'User agent',
    sessionsTitle: 'Sesiones',
    sessionsOpen: (n: number) => `${n} ${plural(n, 'abierta', 'abiertas')}`,
    sessionStatsUnavailable:
      'Las estadísticas en directo (fotogramas por segundo, bytes, ida y vuelta) aún no están disponibles desde la pantalla de sesión.',
  },

  onboarding: {
    label: 'Introducción',
    step: (i: number, n: number) => `Paso ${i} de ${n}`,
    cards: [
      {
        title: 'Tu Guacamole, en el bolsillo',
        body: 'Conéctate al servidor Apache Guacamole que ya tienes, en casa o en el trabajo. Sin intermediarios y sin cuenta.',
      },
      {
        title: 'Pensada para pantallas táctiles',
        body: 'Puntero de toque directo o trackpad, una barra de teclas con Ctrl, Alt y teclas de función, y portapapeles en ambos sentidos.',
      },
      {
        title: 'Pruébala primero',
        body: 'La demo es un escritorio simulado que se ejecuta en este dispositivo, para que aprendas los gestos antes de añadir un servidor.',
      },
    ],
    tryDemo: 'Probar la demo',
    addServer: 'Añadir un servidor',
  },
};
