import type { Strings } from './en.ts';

/**
 * Spanish (neutral, "tú"). Same shape as `en.ts`; see docs/TRANSLATING.md.
 * Product and protocol names (Guacamole, RDP, VNC, SSH, Tailscale, Face ID) stay in English.
 */

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const es: Strings = {
  appName: 'Open Mobile Guac',

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
    lightMode: 'Cambiar a modo claro',
    darkMode: 'Cambiar a modo oscuro',
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
    hours: (n: number) => `${n} h`,
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
    confirmLinks: 'Preguntar antes de conectar con enlaces de la app',
    confirmLinksHint:
      'Un enlace openmobileguac:// (por ejemplo de otra app o un código QR) pregunta primero «¿Abrir … en este servidor?».',
    httpFallback: 'Usar http — sin cifrar',
    httpFallbackHint:
      'La dirección segura (https) no funcionó, así que no se envió nada. Cualquiera en la red puede leer http sin cifrar; úsalo solo en una red de confianza.',
    passwordNewAddress:
      'Una dirección nueva necesita la contraseña otra vez: la guardada se borra al guardar.',
    moveTitle: '¿Cambiar la dirección del servidor?',
    moveBody:
      'La contraseña, la sesión y la clave TOTP guardadas eran para la dirección anterior. Se borrarán y volverás a iniciar sesión en la nueva. No se envía nada guardado a la nueva dirección.',
    moveConfirm: 'Cambiar dirección',
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
      'Se quitarán de este dispositivo el servidor, sus favoritos, recientes, miniaturas, la contraseña guardada, la clave de doble factor, las contraseñas de conexión recordadas y los ajustes.',
    duplicate: 'Duplicar servidor',
    duplicateName: (name: string) => `${name} (copia)`,
    clearCredentials: 'Borrar credenciales guardadas',
    clearCredentialsTitle: '¿Borrar las credenciales guardadas?',
    clearCredentialsBody:
      'Se eliminan de este dispositivo la contraseña guardada, el token de sesión, cualquier clave de doble factor y las contraseñas de conexión recordadas de este servidor. La próxima vez tendrás que iniciar sesión.',
    credentialsCleared: 'Credenciales guardadas borradas.',
    changePassword: {
      title: 'Contraseña de la cuenta',
      open: 'Cambiar contraseña',
      hint: 'Cambia la contraseña de esta cuenta en el servidor.',
      signInFirst: 'Inicia sesión en este servidor para cambiar la contraseña de la cuenta.',
      notAllowed: 'Este servidor no permite que esta cuenta cambie aquí su propia contraseña.',
      oldPassword: 'Contraseña actual',
      newPassword: 'Nueva contraseña',
      confirmPassword: 'Confirma la nueva contraseña',
      submit: 'Cambiar contraseña',
      busy: 'Cambiando…',
      blank: 'Escribe una contraseña nueva.',
      mismatch: 'Las dos contraseñas nuevas no coinciden.',
      wrongOld: 'La contraseña actual no es correcta.',
      rejectedTitle: 'No se aceptó la nueva contraseña',
      done: 'Contraseña cambiada.',
      doneSaved: 'Contraseña cambiada. Se actualizó la contraseña guardada en este dispositivo.',
    },
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
      redirected: 'redirigido a otra dirección',
    } as Record<string, string>,
    websocketDetail: {
      error: 'la WebView no pudo abrirlo',
      timeout: 'sin respuesta',
      closed: 'cerrado por el servidor o por un proxy',
    } as Record<string, string>,
    wsHintTls:
      'La API funciona pero el túnel no. Con HTTPS suele significar que la WebView no confía en el certificado (consulta Ajustes › General e información › Diagnóstico y docs/tls.md); detrás de un proxy inverso, comprueba que reenvía las conexiones WebSocket.',
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
    totpQrAlt: 'Código QR con la clave del autenticador de esta cuenta',
    totpParams: (p: { digits: number; period: number; algorithm: string }) =>
      `${p.digits} dígitos, un código nuevo cada ${p.period} s, ${p.algorithm}.`,
    totpSecret: 'Clave de configuración',
    totpAutofilled: (seconds: number) => `Rellenado con la clave guardada · quedan ${seconds} s`,
    totpWaiting: (seconds: number) =>
      `Ese código se acaba de usar. Esperando ${seconds} s a uno nuevo…`,
    useDifferentAccount: 'Empezar de nuevo',
    savedPasswordRejected: 'No se aceptó la contraseña guardada. Escríbela de nuevo.',
    sessionExpired: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
    signedOutInBackground:
      'Se cerró la sesión porque la app estuvo en segundo plano (Ajustes › Cerrar sesión en los servidores tras). Escribe tu contraseña para continuar.',
    newCertificatePassword:
      'Has confiado en un certificado nuevo para este servidor. Escribe la contraseña una vez, para que una contraseña guardada nunca se envíe a un certificado con el que no has iniciado sesión.',
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
        'Experimental: la parte del servidor se comprobó con Keycloak (OpenID Connect) en un servidor de pruebas, pero no la página de inicio de sesión dentro de la app en un teléfono. SAML y CAS solo con el código de Guacamole.',
      choose: 'Iniciar sesión con',
      waiting: 'Termina de iniciar sesión en la página que se ha abierto…',
      unavailable:
        'El inicio de sesión único necesita la app móvil. En un navegador de escritorio no se puede completar aquí.',
      cancelled: 'Se canceló el inicio de sesión.',
      failed: 'El servidor no aceptó el resultado del inicio de sesión.',
      race: 'La propia página web del servidor usó el resultado de un solo uso antes que la app. Vuelve a intentarlo; si sigue pasando, pregunta a tu administrador por el retorno a la app (docs/sso.md).',
    },
    duo: {
      title: 'Verificación con Duo',
      body: 'Este servidor te pide confirmar el inicio de sesión con Duo. La página de Duo se abre dentro de la app; la app continúa cuando termines.',
      button: 'Ir a Duo',
      waiting: 'Termina la comprobación de Duo en la página que se ha abierto…',
      unavailable:
        'La verificación con Duo necesita la app móvil. En un navegador de escritorio no se puede completar aquí.',
      cancelled: 'Se canceló la comprobación de Duo.',
      failedTitle: 'Duo no confirmó el inicio de sesión',
      failed:
        'La verificación con Duo no se completó, o la propia página del servidor usó el resultado antes. Vuelve a intentarlo.',
      experimental:
        'Experimental: hecho a partir del código de Guacamole 1.6.0, sin probar con una cuenta real de Duo.',
    },
    newPasswordRejected: 'No se aceptó la nueva contraseña',
    passwordMismatch: 'Las dos contraseñas nuevas no coinciden.',
    fieldLabels: {
      'new-password': 'Nueva contraseña',
      'confirm-new-password': 'Confirma la nueva contraseña',
    } as Record<string, string>,
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
    redirected: {
      title: 'El servidor redirigió la solicitud',
      detail:
        'El servidor redirigió la solicitud a otra dirección. Si delante de Guacamole hay una pasarela de inicio de sesión, usa el inicio de sesión único o abre la dirección del servidor a la que redirige.',
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
    partialLoad: (sources: string) =>
      `No se pudieron cargar algunas conexiones (${sources}). Desliza hacia abajo o pulsa Reintentar.`,
    inUse: (n: number) =>
      n === 1 ? '1 sesión activa en el servidor' : `${n} sesiones activas en el servidor`,
    inUseShort: 'En uso',
    inUseBadge: (n: number) => (n > 1 ? `En uso · ${n}` : 'En uso'),
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
    activeUsers: 'Sesiones activas',
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
    openSessionLabel: 'Sesión abierta en la app',
    swipeHint: 'Desliza para ver acciones',
    linkConfirmTitle: (connection: string, server: string) =>
      `¿Abrir «${connection}» en ${server}?`,
    linkConfirmBody:
      'Un enlace pidió conectar. Conectar puede quitar la sesión a otra persona o despertar el equipo.',
    linkConfirmOpen: 'Abrir',
    linkDontAsk: 'No volver a preguntar para enlaces de este servidor',
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
    shareTitle: (name: string) => `Únete a mi sesión: ${name}`,
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
    alreadyOpenTitle: (name: string) => `${name} ya está abierta`,
    alreadyOpenBody: '¿Volver a la sesión abierta o abrir otra junto a ella?',
    alreadyOpenGoTo: 'Ir a la sesión abierta',
    alreadyOpenAnother: 'Abrir otra',
    alreadyOpenDontAsk:
      'No volver a preguntar (se cambia en Ajustes › Sesiones › Si una conexión ya está abierta)',
    inUseTitle: (name: string) => `${name} ya está en uso`,
    inUseBody: (n: number) =>
      n === 1
        ? 'El servidor indica 1 sesión activa en esta conexión.'
        : `El servidor indica ${n} sesiones activas en esta conexión.`,
    inUseYou: (since: string) => (since ? `Tú, desde ${since}` : 'Tú'),
    inUseUser: (name: string, since: string) => (since ? `${name}, desde ${since}` : name),
    inUseSomeone: (since: string) => (since ? `Otro usuario, desde ${since}` : 'Otro usuario'),
    inUseOpenExisting: 'Abrir la existente',
    inUseEnd: (n: number) =>
      n > 1 ? `Cerrar las ${n} y empezar de nuevo` : 'Cerrarla y empezar de nuevo',
    inUseAnother: 'Abrir otra',
    inUseCannotJoin:
      'Esta cuenta no puede unirse a sesiones en curso; una cuenta de administrador sí puede.',
    inUseEndFailed: 'El servidor no cerró la sesión. No se ha cambiado nada.',
    inUseDontAsk:
      'No volver a preguntar (se cambia en Ajustes › Sesiones › Preguntar antes de conectar)',
    connectTitle: (name: string) => `¿Conectar a ${name}?`,
    connectBody: 'El servidor no indica ninguna sesión activa en esta conexión.',
    connectConfirm: 'Conectar',
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
    reason: 'Desbloquear Open Mobile Guac',
    unavailable:
      'Face ID, la huella y el código del dispositivo no están disponibles ahora. Comprueba que hay un código configurado en los ajustes del dispositivo y vuelve a intentarlo.',
    retry: 'Reintentar',
    reset: 'Borrar los inicios de sesión guardados y desactivar el bloqueo',
    resetTitle: '¿Desactivar el bloqueo de la app?',
    resetBody:
      'Primero se borran todas las contraseñas, sesiones y claves TOTP guardadas en este dispositivo. Los servidores, favoritos y ajustes se conservan. Tendrás que volver a iniciar sesión.',
    resetConfirm: 'Borrar y desactivar',
    offReason: 'Desactivar el bloqueo de la app',
    credentialReason: 'Usar las credenciales guardadas',
    connectionReason: (name: string) => `Desbloquear la contraseña guardada de ${name}`,
    connectionUnlockOffReason:
      'Dejar de pedirlo antes de rellenar las contraseñas de conexión guardadas',
    cancel: 'Cancelar',
  },

  settings: {
    pages: {
      search: 'Buscar ajustes',
      noMatch: 'Ningún ajuste coincide con la búsqueda.',
      resultCount: (n: number) => `${n} ${plural(n, 'ajuste encontrado', 'ajustes encontrados')}`,
      advanced: 'Avanzado',
      more: 'Más',
      danger: 'Restablecer y eliminar',
      resetPage: 'Restablecer esta página a los valores predeterminados',
      resetPageHint:
        'Solo los valores predeterminados de sesión de esta página. Las conexiones conservan sus propias elecciones.',
      reset: 'Restablecer',
      resetAllSession: 'Restablecer todos los valores de sesión',
      resetAllSessionHint:
        'Pantalla, barra de herramientas, puntero, gestos, teclado, portapapeles, archivos y sonido. Las conexiones conservan sus propias elecciones.',
      categories: {
        general: 'General e información',
        display: 'Pantalla',
        toolbar: 'Barra de herramientas y diseño',
        pointer: 'Puntero y táctil',
        gestures: 'Gestos',
        keyboard: 'Teclado y teclas',
        sessions: 'Sesiones',
        security: 'Seguridad y privacidad',
        backup: 'Copia de seguridad',
        connections: 'Conexiones',
      },
      groups: {
        serverList: 'Lista de servidores',
        help: 'Ayuda',
        picture: 'Imagen',
        remoteSize: 'Tamaño del escritorio remoto',
        screen: 'Esta pantalla',
        layout: 'Horizontal y plegables',
        mode: 'Modo del puntero',
        trackpad: 'Puntero del trackpad',
        feedback: 'Respuesta',
        keyBar: 'Barra de teclas',
        typing: 'Escritura',
        openSessions: 'Sesiones abiertas',
        background: 'En segundo plano',
        thumbnails: 'Miniaturas',
        appLock: 'Bloqueo de la app',
        serverSignIn: 'Inicio de sesión en servidores',
        connectionPasswords: 'Contraseñas de conexión',
      },
      summaries: {
        gestures: (on: number, total: number) => `${on} de ${total} activados`,
        lockOn: 'Bloqueo de la app activado',
        lockOff: 'Bloqueo de la app desactivado',
        sessions: (n: number) => `Hasta ${n} a la vez`,
        autoBackupOn: (frequency: string) => `Automática: ${frequency}`,
        autoBackupOff: 'Copias automáticas desactivadas',
        pointer: (mode: string, speed: string) => `${mode} · velocidad ${speed}`,
        keyboard: (set: string, combos: number) =>
          `Conjunto: ${set} · ${combos} ${plural(combos, 'combinación guardada', 'combinaciones guardadas')}`,
        remember: (policy: string) => `Contraseñas: ${policy}`,
      },
    },
    keysTitle: 'Teclas y combinaciones',
    keysHint:
      'Conjuntos para la barra de teclas extra y tus combinaciones de teclas guardadas, para todas las sesiones. Cada conexión recuerda el último conjunto que usó.',
    keySetsButton: 'Conjuntos de teclas',
    keySetsSummary: (n: number) => `${n} propios, 6 integrados`,
    combosButton: 'Combinaciones guardadas',
    combosSummary: (n: number) => `${n} guardadas`,
    signOutAll: 'Cerrar sesión en todos los servidores',
    signOutAllHint:
      'Elimina de este dispositivo los datos de inicio de sesión guardados de todos los servidores.',
    signOutTitle: '¿Cerrar sesión en todos los servidores?',
    signOutBody: 'Para cada servidor guardado, se elimina de este dispositivo:',
    signOutItems: [
      'Las contraseñas guardadas',
      'Los tokens de sesión (también se pide a cada servidor que cierre la sesión, si está accesible)',
      'Las claves de doble factor (TOTP) guardadas',
      'Las contraseñas de conexión recordadas',
    ],
    signOutKeeps:
      'Se conservan los servidores, favoritos, recientes y todos los ajustes. Se conserva la frase de contraseña de las copias.',
    signOutSessions: (n: number) =>
      `Se cerrarán ${n} ${plural(n, 'sesión abierta', 'sesiones abiertas')}.`,
    removeServers: 'Eliminar también los servidores',
    removeServersHint:
      'También elimina cada servidor con sus favoritos, recientes, ajustes por conexión y miniaturas.',
    signOutConfirm: 'Cerrar sesión',
    signOutConfirmRemove: 'Cerrar sesión y eliminar servidores',
    signingOut: 'Cerrando sesión…',
    signedOut: (n: number) => `Sesión cerrada en ${n} ${plural(n, 'servidor', 'servidores')}.`,
    signedOutRemoved: (n: number) =>
      `Sesión cerrada y ${n} ${plural(n, 'servidor eliminado', 'servidores eliminados')}.`,
    keepAlive: 'Mantener las sesiones conectadas en segundo plano',
    keepAliveHintAndroid:
      'Mientras haya al menos una sesión abierta, Android muestra una notificación (con Desconectar todas) y mantiene la conexión al cambiar de app o apagarse la pantalla. Usa más batería y datos. Desactivado: las sesiones se desconectan tras el tiempo de arriba.',
    keepAliveHintIos:
      'No disponible en iOS: iOS suspende las apps en segundo plano, así que las sesiones se desconectan tras el tiempo de arriba. Al volver a la app se reconectan enseguida.',
    keepAliveHintWeb: 'Disponible solo en la app de Android.',
    keepAliveExplainTitle: '¿Permitir la notificación?',
    keepAliveExplain:
      'Para mantener una sesión conectada en segundo plano, Android exige una notificación mientras funciona. Permite las notificaciones en la siguiente pantalla para verla (con su botón Desconectar todas).',
    keepAliveContinue: 'Continuar',
    keepAliveDenied:
      'Las notificaciones de esta app están desactivadas: las sesiones siguen conectadas, pero la notificación no se ve. Puedes permitirlas en los ajustes de Android.',
    keepAliveBattery:
      'Algunos teléfonos detienen igualmente las apps en segundo plano para ahorrar batería. Si las sesiones se cortan, pon el uso de batería de la app en Sin restricciones en Ajustes de Android › Aplicaciones.',
    keepAliveOnSince: 'Activo: las sesiones siguen conectadas en segundo plano.',
    notifTitle: (n: number) =>
      `${n} ${plural(n, 'sesión remota conectada', 'sesiones remotas conectadas')}`,
    notifBody: 'Toca para volver a la app.',
    notifDisconnectAll: 'Desconectar todas',
    channelName: 'Sesiones conectadas',
    channelDescription:
      'Se muestra mientras las sesiones remotas siguen conectadas en segundo plano',
    perConnection: {
      title: 'Ajustes por conexión',
      summaryNone: 'Todas las conexiones usan los valores predeterminados',
      summaryCount: (n: number) =>
        `${n} ${plural(n, 'conexión tiene', 'conexiones tienen')} ajustes propios`,
      intro:
        'Cada conexión recuerda lo que cambias en su sesión (modo del puntero, vista, barra de herramientas y más). Toca una para ver o cambiar sus ajustes. Aquí no hace falta iniciar sesión.',
      filtered: (page: string) => `Con ajustes propios en ${page}`,
      showAll: 'Mostrar todas las conexiones',
      empty: 'Aún no hay conexiones. Abre una conexión una vez y aparecerá aquí.',
      emptyFiltered: 'Ninguna conexión tiene ajustes propios en esta página.',
      usesDefaults: 'Usa los valores predeterminados',
      sameAsDefaults: (n: number) =>
        `${n} ${plural(n, 'valor propio', 'valores propios')}, iguales a los predeterminados`,
      changes: (n: number) => `${n} ${plural(n, 'cambio', 'cambios')}`,
      unnamed: (id: string) => `Conexión ${id}`,
      unnamedGroup: (id: string) => `Grupo ${id}`,
      serverDefaults: 'Valores predeterminados de este servidor',
      on: 'Activado',
      off: 'Desactivado',
      andMore: (names: string, n: number) => `${names} y ${n} más`,
      defaultsLine: 'Estos son los valores predeterminados de todas las conexiones.',
      defaultsOwn: (n: number) =>
        `${n} ${plural(n, 'conexión tiene', 'conexiones tienen')} valores propios aquí.`,
      defaultsNoneOwn: 'Cada conexión puede guardar sus propios valores.',
      seeConnections: 'Ajustes por conexión',
      overriddenOn: (list: string) => `Ajuste propio en: ${list}`,
      alsoSetFor: (list: string) => `También en: ${list}`,
      editorIntro:
        'Ajustes solo de esta conexión. Los marcados con «Esta conexión» son propios; el resto sigue los valores predeterminados. Los cambios se aplican al momento, también a una sesión abierta.',
      serverEditorIntro:
        'Valores predeterminados para todas las conexiones de este servidor, por encima de los de la app. Los valores propios de cada conexión siguen teniendo prioridad.',
      own: 'Esta conexión',
      ownServer: 'Este servidor',
      inherited: 'Usa el predeterminado',
      defaultValue: (value: string) => `Predeterminado: ${value}`,
      useDefault: 'Usar predeterminado',
      useDefaultFor: (label: string) => `Usar el valor predeterminado para ${label}`,
      ownCount: (n: number) =>
        n === 0
          ? 'Usa los valores predeterminados'
          : `${n} ${plural(n, 'valor propio', 'valores propios')}`,
      resetPage: 'Usar los predeterminados en esta página',
      resetPageHint: 'Elimina los valores propios de esta conexión en esta página.',
      resetPageServerHint: 'Elimina los valores propios de este servidor en esta página.',
      resetAll: 'Restablecer todo en esta conexión',
      resetAllServer: 'Restablecer todo en este servidor',
      resetAllHint: 'Todos los ajustes vuelven a los valores predeterminados.',
      resetConfirmTitle: (name: string) => `¿Restablecer todos los ajustes de ${name}?`,
      resetConfirmBody:
        'Se eliminan sus valores propios y vuelve a usar los predeterminados. No se puede deshacer.',
      reset: 'Restablecer',
      backToSession: 'Volver a la sesión',
      forConnection: 'Ajustes de esta conexión',
    },
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
      'one-to-one': '1:1 (píxeles del dispositivo)',
      'css-pixels': '100 % (píxeles CSS)',
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
    clipboardAutoSendOnFocus: 'Enviar el portapapeles del dispositivo al volver a la app',
    clipboardAutoSendHint: 'En iOS puede aparecer un aviso de permiso para pegar.',
    keepAwake: 'Mantener la pantalla encendida durante las sesiones',
    resetDefaults: 'Restablecer valores de sesión',
    security: 'Seguridad',
    lockEnable: 'Pedir Face ID / huella / código del dispositivo',
    lockHint:
      'Se pide al volver de segundo plano y antes de usar las credenciales guardadas. Mientras esté activado, el contenido de la app se oculta en el selector de apps.',
    lockUnavailableWeb: 'Solo disponible en la app móvil.',
    lockUnavailableDevice: 'Configura antes un código, Face ID o huella en el dispositivo.',
    lockUnavailableError:
      'El dispositivo no indicó si hay un código o biometría configurados. Vuelve a abrir la app e inténtalo de nuevo.',
    lockAfter: 'Bloquear cuando la app lleve en segundo plano',
    rememberConnection: 'Recordar las contraseñas de conexión',
    rememberConnectionOptions: {
      never: 'Nunca',
      '5m': '5 min',
      '15m': '15 min',
      '1h': '1 hora',
      app: 'Hasta cerrar',
      device: 'En este dispositivo',
    },
    rememberConnectionHint:
      'Cuando un equipo remoto pide su propio usuario y contraseña después de elegir una conexión, la app puede responder sola la próxima vez, también al reconectar después de estar en segundo plano. Los límites de tiempo cuentan desde el último uso. Todas las opciones salvo «En este dispositivo» los guardan solo en memoria, como mucho hasta que se cierra la app; «En este dispositivo» los guarda en el llavero / almacén de claves, detrás del bloqueo de la app si está activado. La opción de abajo también puede pedir una comprobación del dispositivo cada vez que se rellena una. El aviso tiene una casilla «Recordar» para decir que no en una conexión.',
    rememberConnectionMemoryOnly:
      'Esta versión no puede guardar secretos en el dispositivo: «En este dispositivo» los guarda en memoria hasta que se cierra la app.',
    rememberConnectionUnlock: (method: string) =>
      `Pedir ${method} antes de rellenar una contraseña recordada`,
    biometryMethods: {
      'face-id': 'Face ID',
      'touch-id': 'Touch ID',
      fingerprint: 'la huella',
      face: 'el desbloqueo facial',
      iris: 'el escaneo del iris',
      generic: 'la biometría o el código del dispositivo',
    },
    rememberConnectionUnlockHint:
      'Cada vez que se va a rellenar una contraseña de conexión recordada, el dispositivo lo pide antes (también vale el código del dispositivo). Cancélalo para escribir la contraseña; no se olvida nada. Una comprobación vale para lo que se rellene en los 30 segundos siguientes mientras la app siga en primer plano, y desbloquear el bloqueo de la app cuenta como comprobación. Activado por defecto con «En este dispositivo».',
    rememberConnectionUnlockUnavailable:
      'Necesita Face ID, una huella o un código del dispositivo (solo en la app móvil). Mientras tanto, las contraseñas recordadas se rellenan sin preguntar.',
    forgetConnectionPasswords: 'Olvidar las contraseñas de conexión recordadas',
    connectionPasswordsForgotten: 'Contraseñas de conexión recordadas olvidadas.',
    lockOffWithSeeds:
      'Las claves de doble factor guardadas solo se usan tras desbloquear. Si desactivas el bloqueo, se eliminarán de este dispositivo.',
    lockOffConfirm: 'Desactivar y eliminar claves',
    sessions: 'Sesiones',
    maxSessions: 'Sesiones abiertas a la vez',
    maxSessionsHint:
      'Cada sesión abierta consume memoria y datos. En dispositivos antiguos puede ser mejor 1 o 2.',
    openAgain: 'Si una conexión ya está abierta',
    openAgainAsk: 'Preguntar',
    openAgainSwitch: 'Ir a la sesión abierta',
    openAgainNew: 'Abrir otra',
    openAgainHint:
      'Qué hace tocar una conexión que ya tiene una sesión abierta en la app. Una sesión desconectada se vuelve a conectar. Una segunda sesión al mismo equipo puede cerrar la primera (por ejemplo con RDP). Unirse a la sesión de otra persona y los enlaces compartidos siempre van a la abierta.',
    askInUse: 'Preguntar antes de conectar',
    askInUseInUse: 'Si está en uso',
    askInUseAlways: 'Siempre',
    askInUseNever: 'Nunca',
    askInUseHint:
      'Antes de conectar, la app pregunta al servidor si la conexión ya tiene sesiones activas, por ejemplo una que quedó abierta al cerrarse la app o al perder el inicio de sesión. Si es así, ofrece abrir la existente, cerrarla y empezar de nuevo, o abrir otra. «Si una conexión ya está abierta» trata de las sesiones abiertas en esta app; este ajuste, de las sesiones que indica el servidor. Si el servidor no responde en 2 segundos, la app conecta sin más. Nunca se pregunta en la demo, en los enlaces compartidos ni al unirse a una sesión.',
    backgroundDisconnect: 'Desconectar las sesiones cuando la app lleve en segundo plano',
    backgroundDisconnectIos:
      'En iPhone y iPad el sistema pausa la app poco después de salir de ella, así que no puede mantener una sesión: el servidor Guacamole la cierra unos 15 segundos después de que la app deja de responder, elijas lo que elijas aquí. Al volver, la sesión se reconecta sola.',
    backgroundDisconnectHint:
      'Ahorra batería y datos. No cierra tu sesión en el servidor: volver a conectar es un toque.',
    serverSignOut: 'Cerrar sesión en los servidores cuando la app lleve en segundo plano',
    serverSignOutHint:
      'Pasado este tiempo, la app cierra la sesión en todos los servidores y el siguiente inicio de sesión pide la contraseña aunque esté guardada. «Nunca» mantiene la sesión hasta que el propio servidor la termine (por defecto, tras una hora sin uso). Es distinto de desconectar las sesiones (Ajustes › Sesiones) y del bloqueo de la app, que solo pide Face ID / huella / código del dispositivo. No se aplica mientras Android mantiene las sesiones conectadas en segundo plano.',
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
    licenceValue: 'GNU GPL, versión 3 o posterior',
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
    showDemo: 'Servidor de demostración en la lista',
    showDemoAuto: 'Automático',
    showDemoShow: 'Mostrar',
    showDemoHide: 'Ocultar',
    showDemoHint:
      'Automático lo muestra solo mientras no hay ningún servidor guardado. La demostración funciona sin conexión y siempre se puede volver a mostrar aquí.',
  },

  backup: {
    autoTitle: 'Copias automáticas',
    autoEnable: 'Hacer copias automáticamente',
    autoHint:
      'Se hace la próxima vez que abras la app después de que toque: los teléfonos no dejan que la app se ejecute según un horario en segundo plano. Las copias se guardan en el almacenamiento privado de la app en este dispositivo.',
    frequency: 'Frecuencia',
    frequencies: {
      daily: 'Diaria',
      weekly: 'Semanal',
      monthly: 'Mensual',
    } as Record<string, string>,
    keep: 'Conservar las más recientes',
    keepFormat: (n: number) => `${n} ${plural(n, 'copia', 'copias')}`,
    lastBackup: (when: string) => `Última copia automática: ${when}`,
    lastNever: 'Última copia automática: nunca',
    nextBackup: (when: string) => `Siguiente: la primera vez que abras la app después del ${when}`,
    nextSoon: 'Siguiente: la próxima vez que abras la app',
    lastFailed: (error: string) => `La última copia automática falló (${error}).`,
    backUpNow: 'Hacer copia ahora',
    backingUp: 'Haciendo la copia…',
    savedAuto: (name: string) => `Guardada ${name}.`,
    storedTitle: 'Copias en este dispositivo',
    storedBrowser: 'Versión de desarrollo: se guardan en el almacenamiento de este navegador.',
    noneStored: 'Aún no hay copias automáticas.',
    share: 'Compartir',
    shareName: (name: string) => `Compartir ${name}`,
    restoreThis: 'Restaurar',
    restoreName: (name: string) => `Restaurar ${name}`,
    deleteThis: 'Eliminar',
    deleteName: (name: string) => `Eliminar ${name}`,
    deleteConfirmTitle: '¿Eliminar esta copia?',
    deleteConfirmBody: (name: string) =>
      `Se elimina ${name} de este dispositivo. No se puede deshacer.`,
    loaded: (name: string) => `Cargada ${name}. Elige abajo cómo restaurarla.`,
    passTitle: 'Frase de contraseña de las copias',
    passHint:
      'Con una frase de contraseña, las copias automáticas también incluyen tus contraseñas guardadas y claves de doble factor, cifradas con ella. Sin ella, no incluyen secretos. La frase se guarda solo en el almacenamiento seguro del dispositivo y nunca va en una copia.',
    passLockNote:
      'Con el bloqueo de la app activado, los secretos solo se incluyen si la copia se hace justo después de desbloquear la app.',
    passSet: 'Hay una frase de contraseña: las copias automáticas incluyen contraseñas cifradas.',
    passNone: 'Sin frase de contraseña: las copias automáticas no incluyen secretos.',
    setPass: 'Definir frase de contraseña',
    changePass: 'Cambiar la frase de contraseña',
    removePass: 'Quitar la frase de contraseña',
    savePass: 'Guardar la frase de contraseña',
    passSaved: 'Frase de contraseña guardada.',
    passRemoved: 'Frase de contraseña quitada.',
    withSecrets: 'con contraseñas cifradas',
    withoutSecrets: 'sin secretos',
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
    restoredAddressChanged: (n: number) =>
      ` ${n} ${n === 1 ? 'servidor guardado tiene' : 'servidores guardados tienen'} otra dirección en la copia, así que se ${n === 1 ? 'añadió como servidor nuevo' : 'añadieron como servidores nuevos'} sin contraseñas ni sesión guardadas. Vuelve a iniciar sesión si la dirección es correcta.`,
    restoredSecretsSkipped:
      ' Las contraseñas y claves TOTP de la copia no se restauraron (sin frase de contraseña).',
    restoredUnsealedSkipped: (n: number) =>
      ` No se restauraron las contraseñas o claves TOTP de ${n} ${n === 1 ? 'servidor' : 'servidores'}: la copia no indica a qué dirección pertenecen.`,
    restoredPinsDropped: (n: number) =>
      ` No se restauraron los certificados de confianza de ${n} ${n === 1 ? 'servidor' : 'servidores'}; se te volverá a preguntar.`,
    restoredSecurityReset:
      ' Algunos ajustes de seguridad no se restauraron y conservan los valores de este dispositivo o los valores seguros: «Cerrar sesión en los servidores tras», preguntar antes de que un enlace de la app conecte, aceptar archivos del equipo remoto y el micrófono.',
    restored: (added: number, updated: number, removed: number) =>
      `Restaurado: ${added} ${plural(added, 'añadido', 'añadidos')}, ${updated} ${plural(updated, 'actualizado', 'actualizados')}${removed ? `, ${removed} ${plural(removed, 'eliminado', 'eliminados')}` : ''}.`,
    replaceConfirmTitle: '¿Sustituir todos los servidores?',
    replaceConfirm: 'Sustituir',
    errors: {
      json: 'Ese archivo no es JSON válido.',
      format: 'No es una copia de seguridad de Open Mobile Guac.',
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
    network: 'Red',
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
