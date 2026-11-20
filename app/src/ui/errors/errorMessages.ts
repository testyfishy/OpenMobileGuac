import { GuacApiError, type GuacErrorInfo } from '../../core/api/errors.ts';
import { adminStrings } from '../admin/adminStrings.ts';
import { strings } from '../strings.ts';

/** A human-readable error for the UI (SPEC SRV-2: each failure kind reads differently). */
export interface UiError {
  /** Stable identifier, useful for tests and styling. */
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
}

export interface ErrorContext {
  /** Running in a desktop/mobile browser rather than the native app. */
  readonly browser?: boolean;
  /** The error came from a second login step (TOTP code etc.). */
  readonly duringAdditionalStep?: boolean;
}

/** Text a server sent, unless it is the generic untranslated placeholder. */
function serverText(
  info: Extract<GuacErrorInfo, { message: string | undefined }>,
): string | undefined {
  const msg = info.message?.trim();
  return msg && msg.length > 0 ? msg : undefined;
}

export function describeGuacError(info: GuacErrorInfo, ctx: ErrorContext = {}): UiError {
  const e = strings.errors;
  switch (info.kind) {
    case 'unreachable':
      if (info.timedOut)
        return { code: 'timeout', title: e.timeout.title, detail: e.timeout.detail };
      return {
        code: 'unreachable',
        title: e.unreachable.title,
        detail: ctx.browser ? e.unreachable.detailBrowser : e.unreachable.detail,
      };
    case 'tls':
      return { code: 'tls', title: e.tls.title, detail: e.tls.detail };
    case 'not-guacamole':
      return {
        code: 'not-guacamole',
        title: e.notGuacamole.title,
        detail:
          info.status !== undefined && info.status !== 200
            ? `${e.notGuacamole.detail} ${e.notGuacamole.status(info.status)}`
            : e.notGuacamole.detail,
      };
    case 'invalid-url':
      return { code: `invalid-url-${info.reason}`, title: e.invalidUrl[info.reason] };
    case 'invalid-credentials':
      return {
        code: 'invalid-credentials',
        title: e.invalidCredentials.title,
        detail: e.invalidCredentials.detail,
      };
    case 'additional-credentials-required':
      return { code: 'additional', title: e.additional.title, detail: e.additional.detail };
    case 'session-expired':
      return {
        code: 'session-expired',
        title: e.sessionExpired.title,
        detail: e.sessionExpired.detail,
      };
    case 'permission-denied':
      return {
        code: 'permission-denied',
        title: adminStrings.denied.title,
        detail: adminStrings.denied.detail,
      };
    case 'not-found':
      return {
        code: 'not-found',
        title: adminStrings.notFound.title,
        detail: adminStrings.notFound.detail,
      };
    case 'invalid-response':
      return {
        code: 'invalid-response',
        title: e.invalidResponse.title,
        detail: e.invalidResponse.detail,
      };
    case 'server-error': {
      const text = serverText(info);
      if (info.type === 'BAD_REQUEST' && ctx.duringAdditionalStep) {
        return { code: 'wrong-code', title: e.wrongCode.title, detail: text ?? e.wrongCode.detail };
      }
      return { code: `server-${info.type}`, title: e.server.title, detail: text };
    }
  }
}

/** Any thrown value → `UiError`. Non-API errors never leak raw stack text. */
export function describeError(err: unknown, ctx: ErrorContext = {}): UiError {
  if (err instanceof GuacApiError) return describeGuacError(err.info, ctx);
  return {
    code: 'unknown',
    title: strings.errors.unknown.title,
    detail: strings.errors.unknown.detail,
  };
}
