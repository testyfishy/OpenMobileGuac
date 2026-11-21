import type { AdminStrings } from './admin.en.ts';

/** Spanish strings for connection management. Same keys as `admin.en.ts`. */

const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const adminEs: AdminStrings = {
  add: 'Añadir',
  addTitle: 'Añadir a este servidor',
  newConnection: 'Nueva conexión',
  newFolder: 'Nueva carpeta',
  newConnectionHere: 'Nueva conexión en esta carpeta',
  newFolderHere: 'Nueva carpeta dentro de esta',
  folderActions: (name: string) => `Gestionar la carpeta ${name}`,
  manageTitle: 'Gestionar en el servidor',
  edit: 'Editar',
  editFolder: 'Editar carpeta',
  clone: 'Duplicar',
  move: 'Mover a otra carpeta',
  delete: 'Eliminar',
  activity: 'Sesiones e historial',
  topLevel: 'Nivel superior',
  serverDefault: 'Predeterminado',
  loading: 'Cargando…',
  saved: (name: string) => `Se guardó «${name}».`,
  created: (name: string) => `Se creó «${name}».`,
  deleted: (name: string) => `Se eliminó «${name}».`,
  moved: (name: string) => `Se movió «${name}».`,
  noPasswordStorage:
    'Los valores se envían directamente al servidor. Nada de lo que escribas aquí se guarda en este dispositivo.',

  denied: {
    title: 'Esta cuenta no puede cambiar eso',
    detail:
      'El servidor rechazó el cambio. Las opciones de gestión de este servidor quedan ocultas hasta que actualices. Pide el permiso a un administrador si lo necesitas.',
    banner:
      'El servidor rechazó un cambio porque esta cuenta no tiene permiso. Las opciones de gestión están ocultas; desliza hacia abajo para volver a comprobarlo.',
  },
  notFound: {
    title: 'No existe en el servidor',
    detail: 'Puede que otra persona lo haya eliminado o movido. Actualiza la lista.',
  },

  editor: {
    titleNew: 'Nueva conexión',
    titleEdit: (name: string) => `Editar ${name}`,
    titleClone: 'Duplicar conexión',
    create: 'Crear',
    save: 'Guardar',
    saving: 'Guardando…',
    basics: 'Conexión',
    name: 'Nombre',
    namePlaceholder: 'PC de la oficina',
    location: 'Carpeta',
    chooseLocation: 'Elegir carpeta',
    protocol: 'Protocolo',
    protocolPick: 'Elige un protocolo',
    dataSource: 'Origen de datos',
    parameters: 'Parámetros',
    attributes: 'Límites y proxy en el servidor',
    search: 'Buscar ajustes',
    searchPlaceholder: 'Buscar, p. ej. fondo',
    noMatches: (q: string) => `Ningún ajuste coincide con «${q}».`,
    setBadge: 'Definido',
    setCount: (n: number) => plural(n, '1 definido', `${n} definidos`),
    reset: (label: string) => `Restablecer ${label} al valor predeterminado`,
    showPassword: 'Mostrar contraseña',
    hidePassword: 'Ocultar contraseña',
    expand: (label: string) => `Mostrar ${label}`,
    collapse: (label: string) => `Ocultar ${label}`,
    required: 'Obligatorio.',
    notNumber: 'Escribe un número entero.',
    hostnameRequired: 'Escribe el nombre de host o la dirección IP del equipo.',
    fixErrors: 'Revisa los campos marcados.',
    loadFailed: 'No se pudo cargar esta conexión',
    cloneNotice:
      'Es una copia sin guardar. Al crearla se añade una conexión nueva; la original no cambia.',
    clonePasswords: (fields: string) =>
      `Secretos guardados copiados: ${fields}. Si la original usaba otra contraseña, vuelve a escribirla.`,
    cloneNoPasswords:
      'El servidor no envió contraseñas guardadas de la original. Si usa alguna, vuelve a escribirla aquí.',
    copyOf: (name: string) => `Copia de ${name}`,
    deleteConnection: 'Eliminar conexión',
    pickProtocolFirst: 'Elige un protocolo para ver sus ajustes.',
    unknownProtocol: (p: string) =>
      `El servidor no describe el protocolo «${p}». Sus parámetros aparecen en Avanzado.`,
  },

  advanced: {
    title: 'Parámetros avanzados',
    hint: 'Define cualquier parámetro por su nombre exacto, para los que el formulario de este servidor no muestra. Los nombres no se comprueban.',
    name: 'Nombre del parámetro',
    value: 'Valor',
    add: 'Añadir parámetro',
    remove: (name: string) => `Quitar ${name}`,
    invalidName: 'Usa letras, cifras, puntos, guiones o guiones bajos.',
    duplicate: 'Ese parámetro ya tiene su propio campo más arriba.',
    none: 'No hay parámetros adicionales.',
  },

  unsaved: {
    title: '¿Descartar los cambios?',
    body: 'Tus cambios no se han guardado en el servidor.',
    discard: 'Descartar',
    keep: 'Seguir editando',
  },

  perf: {
    title: 'Rendimiento y calidad',
    hint: 'Los ajustes predefinidos solo cambian los parámetros normales de abajo. El cambio se aplica la próxima vez que alguien se conecte.',
    presets: {
      best: 'Máxima calidad',
      balanced: 'Equilibrado',
      low: 'Poco ancho de banda',
    },
    presetHints: {
      best: 'Todos los colores y efectos visuales. Requiere una conexión rápida.',
      balanced: 'Buena imagen, sin fondo de escritorio ni animaciones.',
      low: 'Menos colores, sin efectos ni sonido. Para datos móviles.',
    },
    current: (name: string) => `Los ajustes actuales coinciden con «${name}».`,
    custom: 'Los ajustes actuales no coinciden con ningún predefinido.',
    previewTitle: (name: string) => `¿Aplicar «${name}»?`,
    previewIntro: 'Estos parámetros cambiarán en este formulario:',
    previewOutro: 'No se envía nada hasta que guardes.',
    noChanges: 'La conexión ya usa estos ajustes.',
    apply: 'Aplicar',
    applied: (name: string) => `Se aplicó «${name}». Guarda para conservarlo.`,
    unset: 'predeterminado',
    on: 'activado',
    off: 'desactivado',
    labels: {
      'color-depth': 'Colores',
      'force-lossless': 'Solo imágenes sin pérdida',
      'disable-gfx': 'Desactivar la canalización gráfica (GFX)',
      'resize-method': 'Adaptarse al tamaño de la pantalla del teléfono',
      'enable-wallpaper': 'Mostrar el fondo de escritorio',
      'enable-theming': 'Temas de ventana',
      'enable-font-smoothing': 'Suavizado de fuentes',
      'enable-full-window-drag': 'Mostrar el contenido al arrastrar ventanas',
      'enable-desktop-composition': 'Transparencias y sombras',
      'enable-menu-animations': 'Animaciones de menús',
      'disable-bitmap-caching': 'Desactivar la caché de mapas de bits',
      'disable-offscreen-caching': 'Desactivar la caché fuera de pantalla',
      'disable-glyph-caching': 'Desactivar la caché de texto',
      'disable-audio': 'Desactivar el sonido',
      'quality-level': 'Calidad de imagen',
      'compress-level': 'Compresión',
      cursor: 'Puntero del ratón',
      'enable-audio': 'Reproducir sonido',
    } as Record<string, string>,
    hints: {
      'force-lossless': 'La imagen más nítida, pero con muchos más datos.',
      'disable-gfx':
        'guacd usa color de 32 bits mientras GFX está activo, así que los ajustes de color más bajos lo necesitan.',
      'disable-bitmap-caching':
        'Las cachés ahorran datos; desactívalas solo si la imagen sale dañada.',
      'quality-level': '0 es lo más pequeño y 9 lo más nítido. Lo usa la codificación Tight.',
      'compress-level': '0 es ninguna y 9 la máxima. Más compresión usa más CPU del servidor.',
      'enable-audio': 'Requiere PulseAudio en el equipo remoto.',
    } as Record<string, string>,
    options: {
      'color-depth=8': '256 colores',
      'color-depth=16': 'Color de alta densidad (16 bits)',
      'color-depth=24': 'Color verdadero (24 bits)',
      'color-depth=32': 'Color verdadero (32 bits)',
      'resize-method=reconnect': 'Reconectar con el nuevo tamaño',
      'resize-method=display-update': 'Redimensionar en directo (RDP 8.1 o posterior)',
      'cursor=local': 'Dibujado en este dispositivo (más rápido)',
      'cursor=remote': 'Dibujado por el servidor',
    } as Record<string, string>,
  },

  folder: {
    titleNew: 'Nueva carpeta',
    titleEdit: (name: string) => `Editar la carpeta ${name}`,
    namePlaceholder: 'Servidores',
    type: 'Tipo',
    organizational: 'Carpeta',
    balancing: 'Grupo de balanceo',
    balancingHint:
      'Al conectarse a un grupo de balanceo se elige una de sus conexiones (la menos ocupada).',
    deleteFolder: 'Eliminar carpeta',
  },

  picker: {
    title: 'Elegir carpeta',
    current: 'Carpeta actual',
    noPermission: 'No puedes añadir elementos a esta carpeta',
    self: 'Esta carpeta',
    inside: 'Dentro de la carpeta que se mueve',
    moveHere: 'Mover aquí',
    moveTitle: (name: string) => `Mover ${name}`,
    moving: 'Moviendo…',
  },

  remove: {
    titleConnection: (name: string) => `¿Eliminar ${name}?`,
    titleFolder: (name: string) => `¿Eliminar la carpeta ${name}?`,
    bodyConnection:
      'Esto elimina la conexión del servidor de forma permanente, para todos los usuarios, junto con su historial y sus perfiles de uso compartido. No se puede deshacer.',
    bodyFolder: (connections: number, folders: number) =>
      `Esto elimina la carpeta del servidor de forma permanente para todos los usuarios, junto con todo su contenido (como mínimo ${plural(connections, '1 conexión', `${connections} conexiones`)} y ${plural(folders, '1 carpeta', `${folders} carpetas`)}). No se puede deshacer.`,
    confirm: 'Eliminar para siempre',
    deleting: 'Eliminando…',
  },

  sessions: {
    title: (name: string) => `Actividad: ${name}`,
    active: 'Sesiones activas',
    noActive: 'Ahora mismo no hay nadie conectado.',
    disconnect: 'Desconectar',
    disconnectTitle: (user: string) => `¿Desconectar a ${user}?`,
    disconnectBody:
      'Su sesión termina al instante y puede perderse lo que no haya guardado en el equipo remoto.',
    disconnected: 'Sesión desconectada.',
    anonymous: 'Usuario anónimo',
    since: (time: string) => `Desde ${time}`,
    from: (host: string) => `Desde la dirección ${host}`,
    history: 'Historial reciente',
    noHistory: 'No hay usos registrados.',
    ongoing: 'Sigue conectado',
    duration: (minutes: number) => plural(minutes, '1 minuto', `${minutes} minutos`),
    unavailable: 'El servidor no comparte esta información con esta cuenta.',
    allTitle: 'Sesiones activas',
    allButton: 'Sesiones activas en este servidor',
    allIntro:
      'Quién está conectado ahora, en todas las conexiones que esta cuenta puede ver. Unirse abre su sesión junto a la tuya; Desconectar la termina.',
    unknownConnection: 'Conexión desconocida',
    join: 'Unirse',
    joinTitle: (user: string, connection: string) =>
      `¿Unirte a la sesión de ${user} en ${connection}?`,
    joinBody:
      'Ves su pantalla y lo que hagas le llega, salvo que la conexión sea de solo lectura. Guacamole avisa al propietario de que alguien se unió. Unirse no cambia ninguno de tus ajustes.',
    joinedName: (connection: string, user: string) => `${connection} (${user})`,
    refresh: 'Actualizar',
  },
};
