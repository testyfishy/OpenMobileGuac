import type { Locale } from '../i18n/locale.ts';
import { activeLocale } from '../strings.ts';

/**
 * Strings for per-server certificate trust (SRV-8). Kept in their own table, like the
 * connection-management strings, and checked for completeness in `tlsStrings.test.ts`.
 */
export const tlsEn = {
  title: 'Certificate',
  checking: 'Reading the server’s certificate…',
  inspectFailed: 'Could not read the server’s certificate.',
  fingerprint: 'SHA-256 fingerprint',
  subject: 'Issued to',
  issuer: 'Issued by',
  validity: 'Valid',
  validRange: (from: string, to: string) => `${from} – ${to}`,
  altNames: 'Names',
  selfSigned: 'Self-signed',
  expired: 'This certificate has expired.',
  notYetValid: 'This certificate is not valid yet.',
  unparsed: 'The certificate details could not be read; the fingerprint is exact.',
  firstUse: {
    title: 'This server’s certificate is not trusted by the device',
    body: 'If this is your own server with a self-signed or private certificate, compare the fingerprint below with the one on the server. Trust it only if they match. On the server:',
    trust: 'Trust this certificate for this server',
    scope: (origin: string) =>
      `Only this exact certificate will be accepted, and only for ${origin}.`,
  },
  changed: {
    title: 'The server’s certificate has changed',
    body: 'The server presented a different certificate from the one you trusted. This happens when the certificate is renewed, but it can also mean someone is intercepting the connection. Nothing was sent to the server.',
    trusted: 'Trusted certificate',
    presented: 'Certificate now presented',
    retrust: 'Trust the new certificate…',
    confirmTitle: 'Trust the new certificate?',
    confirmBody:
      'Only continue if you renewed or replaced the certificate yourself and the new fingerprint matches the one on the server.',
    confirm: 'Trust new certificate',
  },
  alreadyTrusted:
    'The certificate presented is the one you trusted, so this failure has another cause (for example the TLS version or cipher).',
  trusted: 'Certificate trusted. Try again.',
  retry: 'Try again',
  row: {
    none: 'The device’s trusted certificates are used.',
    pinned: 'Trusted certificate (pinned)',
    pinnedAt: (date: string) => `Trusted on ${date}`,
    forget: 'Forget',
    forgetTitle: 'Forget the trusted certificate?',
    forgetBody:
      'The app will use the device’s trusted certificates for this address again. If the server’s certificate is self-signed, connecting will fail until you trust it again.',
    forgotten: 'Trusted certificate removed',
    sharedNote: 'Applies to every saved server at this address.',
  },
};

export type TlsStrings = typeof tlsEn;

export const tlsEs: TlsStrings = {
  title: 'Certificado',
  checking: 'Leyendo el certificado del servidor…',
  inspectFailed: 'No se pudo leer el certificado del servidor.',
  fingerprint: 'Huella SHA-256',
  subject: 'Emitido para',
  issuer: 'Emitido por',
  validity: 'Válido',
  validRange: (from: string, to: string) => `${from} – ${to}`,
  altNames: 'Nombres',
  selfSigned: 'Autofirmado',
  expired: 'Este certificado ha caducado.',
  notYetValid: 'Este certificado todavía no es válido.',
  unparsed: 'No se pudieron leer los detalles del certificado; la huella es exacta.',
  firstUse: {
    title: 'El dispositivo no confía en el certificado de este servidor',
    body: 'Si es tu propio servidor con un certificado autofirmado o privado, compara la huella de abajo con la del servidor. Confía en él solo si coinciden. En el servidor:',
    trust: 'Confiar en este certificado para este servidor',
    scope: (origin: string) =>
      `Solo se aceptará exactamente este certificado, y solo para ${origin}.`,
  },
  changed: {
    title: 'El certificado del servidor ha cambiado',
    body: 'El servidor presentó un certificado distinto del que marcaste como de confianza. Ocurre al renovar el certificado, pero también puede significar que alguien está interceptando la conexión. No se envió nada al servidor.',
    trusted: 'Certificado de confianza',
    presented: 'Certificado presentado ahora',
    retrust: 'Confiar en el nuevo certificado…',
    confirmTitle: '¿Confiar en el nuevo certificado?',
    confirmBody:
      'Continúa solo si tú mismo renovaste o cambiaste el certificado y la nueva huella coincide con la del servidor.',
    confirm: 'Confiar en el nuevo',
  },
  alreadyTrusted:
    'El certificado presentado es el que marcaste como de confianza, así que el fallo tiene otra causa (por ejemplo la versión de TLS o el cifrado).',
  trusted: 'Certificado de confianza guardado. Vuelve a intentarlo.',
  retry: 'Reintentar',
  row: {
    none: 'Se usan los certificados de confianza del dispositivo.',
    pinned: 'Certificado de confianza (fijado)',
    pinnedAt: (date: string) => `De confianza desde el ${date}`,
    forget: 'Olvidar',
    forgetTitle: '¿Olvidar el certificado de confianza?',
    forgetBody:
      'La app volverá a usar los certificados de confianza del dispositivo para esta dirección. Si el certificado del servidor es autofirmado, la conexión fallará hasta que vuelvas a confiar en él.',
    forgotten: 'Certificado de confianza eliminado',
    sharedNote: 'Se aplica a todos los servidores guardados con esta dirección.',
  },
};

const TABLES: Readonly<Record<Locale, TlsStrings>> = { en: tlsEn, es: tlsEs };

/** The table for the active language (read at render time). */
export function tlsStrings(): TlsStrings {
  return TABLES[activeLocale()];
}
