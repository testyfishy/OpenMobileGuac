import { CONFIRM_NEW_PASSWORD_FIELD, NEW_PASSWORD_FIELD } from '../../core/api/authFields.ts';
import type { GuacErrorInfo } from '../../core/api/errors.ts';
import {
  FieldType,
  type FieldDescriptor,
  type TranslatableMessage,
} from '../../core/models/ApiErrorBody.ts';
import { DUO_CODE_PARAM, DUO_STATE_PARAM, findDuoRedirect } from '../../core/sso/sso.ts';
import { describeGuacError, type UiError } from '../errors/errorMessages.ts';
import { strings } from '../strings.ts';

/**
 * The sign-in state machine for one server (SRV-4, SRV-5), pure so it can be unit tested.
 * The screen runs the side effects for the `checking-token` and `signing-in` phases and
 * feeds results back as events tagged with `seq`; stale results are ignored.
 *
 * Rules (docs/protocol-notes.md §1):
 * - A stored token is tried first (`resumeSession`), sending no password.
 * - Then a saved password is used silently, unless plain http still needs the user's OK.
 * - Every credential submission passes the http gate (`confirm-http`) until acknowledged.
 * - `INSUFFICIENT_CREDENTIALS` shows the requested extra fields; username and password are
 *   resent with them on every attempt.
 * - A wrong TOTP code (`BAD_REQUEST` during the extra step) stays on the extra step and
 *   clears the code.
 * - Session expiry during use triggers at most one silent re-login before showing the form.
 * - The server's explanation for an extra step (`message` / `translatableMessage`, e.g.
 *   "Your password has expired") is kept as `prompt` for the form to show.
 * - Forced password change (database extension, `UserService.resetExpiredPassword`): once a
 *   request carrying `new-password` is answered with a different extra step (TOTP), the
 *   server has already stored the new password, so it replaces `password` for every later
 *   attempt. Sending the old one again would be refused (verified on a 1.6.0 server).
 * - Duo: the `duo_code` REDIRECT field is completed by the screen (in-app browser) and
 *   submitted as `{ duo_code, state }` extra values with the username and password.
 */

export { CONFIRM_NEW_PASSWORD_FIELD, NEW_PASSWORD_FIELD };

/** The server's own text for a step or an error, translated later by the form. */
export interface ServerText {
  readonly message: string | undefined;
  readonly translatableMessage: TranslatableMessage | undefined;
}

export interface LoginValues {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
  readonly extra: Readonly<Record<string, string>>;
}

export type FormStep = 'credentials' | 'extra';

interface Common {
  readonly seq: number;
  readonly values: LoginValues;
  readonly expected: readonly FieldDescriptor[];
  /** Plain http and the user has not yet agreed to send credentials in this flow. */
  readonly needsHttpConfirm: boolean;
  /** Whether `values.password` came from secure storage (for the "saved password" message). */
  readonly passwordIsSaved: boolean;
  /** Silent re-logins already done after session expiry (max 1). */
  readonly expiryRetries: number;
  /** The server's explanation of the current extra step, if it gave one. */
  readonly prompt?: ServerText;
}

export type AuthFlowState =
  | ({ readonly phase: 'idle' } & Common)
  | ({ readonly phase: 'checking-token' } & Common)
  | ({ readonly phase: 'confirm-http'; readonly silent: boolean; readonly step: FormStep } & Common)
  | ({ readonly phase: 'signing-in'; readonly silent: boolean; readonly step: FormStep } & Common)
  | ({
      readonly phase: 'form';
      readonly step: FormStep;
      readonly error?: UiError;
      /** The server's text behind `error`, so the form can show it in the UI language. */
      readonly serverError?: ServerText;
      readonly notice?: string;
    } & Common)
  | ({ readonly phase: 'authenticated' } & Common);

export type AuthFlowEvent =
  | {
      readonly type: 'start';
      readonly hasToken: boolean;
      readonly username: string;
      readonly savedPassword: string | null;
      readonly remember: boolean;
      readonly needsHttpConfirm: boolean;
    }
  | { readonly type: 'token-ok'; readonly seq: number }
  | {
      readonly type: 'token-failed';
      readonly seq: number;
      readonly expired: boolean;
      /** Why, when it was not plain expiry (for example the server is unreachable). */
      readonly error?: GuacErrorInfo;
      readonly browser?: boolean;
    }
  | { readonly type: 'submit'; readonly values: Partial<LoginValues> }
  | { readonly type: 'http-confirm' }
  | { readonly type: 'http-cancel' }
  | { readonly type: 'login-ok'; readonly seq: number }
  | {
      readonly type: 'login-failed';
      readonly seq: number;
      readonly error: GuacErrorInfo;
      readonly browser?: boolean;
    }
  | { readonly type: 'session-expired' }
  /** Signed in without the form: single sign-on or a share link (SRV-7, CON-6). */
  | { readonly type: 'external-ok' }
  | { readonly type: 'logout' }
  | { readonly type: 'start-over' }
  /** The account password was changed in the app ("Change password"). */
  | { readonly type: 'password-changed'; readonly password: string };

export function initialAuthFlow(): AuthFlowState {
  return {
    phase: 'idle',
    seq: 0,
    values: { username: '', password: '', remember: true, extra: {} },
    expected: [],
    needsHttpConfirm: false,
    passwordIsSaved: false,
    expiryRetries: 0,
  };
}

function common(s: AuthFlowState): Common {
  return {
    seq: s.seq,
    values: s.values,
    expected: s.expected,
    needsHttpConfirm: s.needsHttpConfirm,
    passwordIsSaved: s.passwordIsSaved,
    expiryRetries: s.expiryRetries,
    ...(s.prompt ? { prompt: s.prompt } : {}),
  };
}

function withoutPrompt(c: Common): Common {
  const { prompt: _prompt, ...rest } = c;
  void _prompt;
  return rest;
}

/** `message`/`translatableMessage` of a server error, unless there is nothing useful. */
export function serverTextOf(info: {
  readonly message: string | undefined;
  readonly translatableMessage: TranslatableMessage | undefined;
}): ServerText | undefined {
  const message = info.message?.trim() || undefined;
  const tm = info.translatableMessage;
  // `APP.TEXT_UNTRANSLATED` only wraps `message`.
  const translatableMessage = tm && tm.key !== 'APP.TEXT_UNTRANSLATED' ? tm : undefined;
  if (!message && !translatableMessage) return undefined;
  return { message, translatableMessage };
}

/** What the extra step asks for, to tell "the same step again" from a new step. */
function stepKey(expected: readonly FieldDescriptor[]): string {
  return visibleExtraFields(expected)
    .map((f) => f.name)
    .concat(findDuoRedirect(expected) ? ['(duo)'] : [])
    .sort()
    .join('|');
}

/** Sends credentials, via the http gate when needed. */
function sendCredentials(c: Common, silent: boolean, step: FormStep): AuthFlowState {
  if (c.needsHttpConfirm) return { ...c, phase: 'confirm-http', silent, step };
  return { ...c, seq: c.seq + 1, phase: 'signing-in', silent, step };
}

function form(
  c: Common,
  step: FormStep,
  extra: { error?: UiError; serverError?: ServerText; notice?: string } = {},
): AuthFlowState {
  return { ...c, phase: 'form', step, ...extra };
}

export function authFlowReducer(state: AuthFlowState, event: AuthFlowEvent): AuthFlowState {
  const c = common(state);
  switch (event.type) {
    case 'start': {
      const base: Common = {
        ...c,
        values: {
          username: event.username,
          password: event.savedPassword ?? '',
          remember: event.remember,
          extra: {},
        },
        expected: [],
        needsHttpConfirm: event.needsHttpConfirm,
        passwordIsSaved: event.savedPassword !== null,
        expiryRetries: 0,
      };
      if (event.hasToken) return { ...base, seq: base.seq + 1, phase: 'checking-token' };
      if (event.savedPassword !== null) return sendCredentials(base, true, 'credentials');
      return form(base, 'credentials');
    }

    case 'token-ok':
      if (state.phase !== 'checking-token' || event.seq !== state.seq) return state;
      return { ...c, phase: 'authenticated' };

    case 'token-failed':
      if (state.phase !== 'checking-token' || event.seq !== state.seq) return state;
      if (c.passwordIsSaved && c.values.password) return sendCredentials(c, true, 'credentials');
      if (event.expired) return form(c, 'credentials', { notice: strings.login.sessionExpired });
      return form(
        c,
        'credentials',
        event.error ? { error: describeGuacError(event.error, { browser: event.browser }) } : {},
      );

    case 'submit': {
      if (state.phase !== 'form') return state;
      const typed = event.values.password;
      const keepPassword = typed === undefined || typed === '';
      const values: LoginValues = {
        ...c.values,
        ...event.values,
        password: keepPassword ? c.values.password : typed,
        extra: { ...c.values.extra, ...(event.values.extra ?? {}) },
      };
      const passwordIsSaved = keepPassword ? c.passwordIsSaved : false;
      return sendCredentials({ ...c, values, passwordIsSaved }, false, state.step);
    }

    case 'http-confirm':
      if (state.phase !== 'confirm-http') return state;
      return sendCredentials({ ...c, needsHttpConfirm: false }, state.silent, state.step);

    case 'http-cancel':
      if (state.phase !== 'confirm-http') return state;
      return form(c, state.silent ? 'credentials' : state.step);

    case 'login-ok': {
      if (state.phase !== 'signing-in' || event.seq !== state.seq) return state;
      // A forced password change in this request: the new password is now the password.
      const password = c.values.extra[NEW_PASSWORD_FIELD] || c.values.password;
      // Keep the password in memory only when it is also saved (for silent re-login).
      return {
        ...withoutPrompt(c),
        phase: 'authenticated',
        expected: [],
        values: {
          ...c.values,
          password: c.values.remember ? password : '',
          extra: {},
        },
        passwordIsSaved: c.values.remember && password !== '',
      };
    }

    case 'login-failed': {
      if (state.phase !== 'signing-in' || event.seq !== state.seq) return state;
      const info = event.error;
      const ctx = { browser: event.browser, duringAdditionalStep: state.step === 'extra' };
      if (info.kind === 'additional-credentials-required') {
        // The same fields again after we sent them: that answer was not accepted (a Duo
        // denial or a stale Duo code comes back this way, with a fresh redirect).
        const resubmitted =
          state.step === 'extra' && stepKey(info.expected) === stepKey(c.expected);
        const names = new Set(info.expected.map((f) => f.name));
        // Duo's `duo_code` and `state` are single use: drop them when a new Duo step comes
        // or once the Duo step is behind us.
        const duoNext = findDuoRedirect(info.expected) !== undefined;
        if (duoNext || findDuoRedirect(c.expected)) {
          names.add(DUO_CODE_PARAM).add(DUO_STATE_PARAM);
        }
        let values: LoginValues = c.values;
        let passwordIsSaved = c.passwordIsSaved;
        const newPassword = c.values.extra[NEW_PASSWORD_FIELD];
        // Not when the next step is Duo: Duo may run before the database extension, and
        // then the reset has not happened yet (Duo keeps the whole request, new password
        // included, and replays it after the check).
        if (newPassword && !names.has(NEW_PASSWORD_FIELD) && !duoNext) {
          // The reset went through (the server moved on to another step).
          names.add(NEW_PASSWORD_FIELD).add(CONFIRM_NEW_PASSWORD_FIELD);
          values = { ...values, password: newPassword };
          passwordIsSaved = false;
        }
        const extra = Object.fromEntries(
          Object.entries(values.extra).filter(([k]) => !names.has(k)),
        );
        const prompt = serverTextOf(info);
        const next: Common = {
          ...withoutPrompt(c),
          expected: info.expected,
          values: { ...values, extra },
          passwordIsSaved,
          ...(prompt ? { prompt } : {}),
        };
        if (!resubmitted) return form(next, 'extra');
        const duo = findDuoRedirect(info.expected) !== undefined;
        return form(next, 'extra', {
          error: duo
            ? {
                code: 'duo-failed',
                title: strings.login.duo.failedTitle,
                detail: strings.login.duo.failed,
              }
            : describeGuacError(
                {
                  kind: 'server-error',
                  type: 'BAD_REQUEST',
                  status: 400,
                  message: undefined,
                  translatableMessage: undefined,
                },
                ctx,
              ),
        });
      }
      if (info.kind === 'server-error' && info.type === 'BAD_REQUEST' && state.step === 'extra') {
        // A wrong TOTP code, or a new password the server refused (same as the old one,
        // not matching, password policy). Show the server's reason.
        const passwordStep = c.expected.some((f) => f.name === NEW_PASSWORD_FIELD);
        const base = describeGuacError(info, ctx);
        const serverError = serverTextOf(info);
        return form({ ...c, values: { ...c.values, extra: {} } }, 'extra', {
          error: passwordStep
            ? {
                code: 'password-rejected',
                title: strings.login.newPasswordRejected,
                ...(base.detail ? { detail: base.detail } : {}),
              }
            : base,
          ...(serverError ? { serverError } : {}),
        });
      }
      if (info.kind === 'invalid-credentials') {
        const error = describeGuacError(info, ctx);
        return form(
          {
            ...withoutPrompt(c),
            expected: [],
            values: { ...c.values, password: '', extra: {} },
            passwordIsSaved: false,
          },
          'credentials',
          {
            error:
              state.silent && c.passwordIsSaved
                ? { ...error, detail: strings.login.savedPasswordRejected }
                : error,
          },
        );
      }
      const serverError = info.kind === 'server-error' ? serverTextOf(info) : undefined;
      return form(c, state.silent ? 'credentials' : state.step, {
        error: describeGuacError(info, ctx),
        ...(serverError ? { serverError } : {}),
      });
    }

    case 'session-expired': {
      if (state.phase !== 'authenticated') return state;
      if (c.expiryRetries < 1 && c.passwordIsSaved && c.values.password) {
        return sendCredentials({ ...c, expiryRetries: c.expiryRetries + 1 }, true, 'credentials');
      }
      return form({ ...c, expected: [] }, 'credentials', { notice: strings.login.sessionExpired });
    }

    case 'external-ok':
      if (state.phase === 'authenticated') return state;
      return {
        ...withoutPrompt(c),
        phase: 'authenticated',
        expected: [],
        values: { ...c.values, password: '', extra: {} },
        passwordIsSaved: false,
        needsHttpConfirm: c.needsHttpConfirm,
      };

    case 'logout':
      return form(
        {
          ...c,
          expected: [],
          values: { ...c.values, password: '', extra: {} },
          passwordIsSaved: false,
          expiryRetries: 0,
        },
        'credentials',
      );

    case 'start-over':
      if (state.phase !== 'form') return state;
      return form(
        { ...withoutPrompt(c), expected: [], values: { ...c.values, extra: {} } },
        'credentials',
      );

    case 'password-changed':
      // Only a password this flow holds (kept for silent re-login) is replaced.
      if (!state.values.password) return state;
      return { ...state, values: { ...state.values, password: event.password } };
  }
}

/** Whether the screen should show a busy indicator rather than a form. */
export function isBusy(state: AuthFlowState): boolean {
  return state.phase === 'idle' || state.phase === 'checking-token' || state.phase === 'signing-in';
}

/** Field types the generic form cannot complete in-app (SSO redirects; SRV-7 is later). */
const UNSUPPORTED = new Set<string>([FieldType.REDIRECT, FieldType.QUERY_PARAMETER]);
/** Resent automatically on every attempt; never shown again in the extra step. */
const ALWAYS_SENT = new Set(['username', 'password']);

export function visibleExtraFields(expected: readonly FieldDescriptor[]): FieldDescriptor[] {
  return expected.filter((f) => !UNSUPPORTED.has(f.type) && !ALWAYS_SENT.has(f.name));
}
