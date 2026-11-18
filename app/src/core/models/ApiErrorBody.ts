import { isRecord, type JsonRecord } from './json.ts';

/**
 * The JSON body of a failed Guacamole REST call (`org.apache.guacamole.rest.APIError`).
 * See docs/protocol-notes.md §1.4.
 */

/** Values of `APIError.Type` in 1.6.0. Unknown future values are kept verbatim. */
export type ApiErrorType =
  | 'BAD_REQUEST'
  | 'INVALID_CREDENTIALS'
  | 'INSUFFICIENT_CREDENTIALS'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'STREAM_ERROR'
  | (string & Record<never, never>);

export interface TranslatableMessage {
  /** Translation key, for example `TOTP.INFO_CODE_REQUIRED` or `APP.TEXT_UNTRANSLATED`. */
  readonly key: string;
  readonly variables: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A field the server wants filled in (`org.apache.guacamole.form.Field` or a subclass).
 * `type` is free-form: extensions define their own (TOTP uses `GUAC_TOTP_CODE`).
 */
export interface FieldDescriptor {
  /** Form parameter name to submit, for example `guac-totp`. */
  readonly name: string;
  readonly type: string;
  readonly options: readonly string[] | undefined;
  /**
   * Any other properties the field carried (for TOTP enrolment: `secret`, `qrCode`,
   * `issuer`, `digits`, …). Kept so the UI can render extension-specific help.
   */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface ApiErrorBody {
  readonly type: ApiErrorType;
  readonly message: string | undefined;
  readonly translatableMessage: TranslatableMessage | undefined;
  readonly statusCode: number | undefined;
  readonly expected: readonly FieldDescriptor[];
}

/** Well-known field type names from `Field.Type` (1.6.0) plus the TOTP extension's type. */
export const FieldType = {
  TEXT: 'TEXT',
  EMAIL: 'EMAIL',
  USERNAME: 'USERNAME',
  PASSWORD: 'PASSWORD',
  NUMERIC: 'NUMERIC',
  BOOLEAN: 'BOOLEAN',
  ENUM: 'ENUM',
  MULTILINE: 'MULTILINE',
  TIMEZONE: 'TIMEZONE',
  LANGUAGE: 'LANGUAGE',
  DATE: 'DATE',
  TIME: 'TIME',
  QUERY_PARAMETER: 'QUERY_PARAMETER',
  TERMINAL_COLOR_SCHEME: 'TERMINAL_COLOR_SCHEME',
  REDIRECT: 'REDIRECT',
  GUAC_TOTP_CODE: 'GUAC_TOTP_CODE',
} as const;

function parseTranslatable(raw: unknown): TranslatableMessage | undefined {
  if (!isRecord(raw) || typeof raw['key'] !== 'string') return undefined;
  const variables = raw['variables'];
  return { key: raw['key'], variables: isRecord(variables) ? variables : undefined };
}

function parseField(raw: unknown): FieldDescriptor | undefined {
  if (!isRecord(raw) || typeof raw['name'] !== 'string' || typeof raw['type'] !== 'string') {
    return undefined;
  }
  const { name, type, options, ...extra } = raw;
  const opts =
    Array.isArray(options) && options.every((o): o is string => typeof o === 'string')
      ? options
      : undefined;
  return { name, type, options: opts, extra: dropNulls(extra) };
}

function dropNulls(obj: JsonRecord): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * Returns the parsed error if `raw` looks like a Guacamole `APIError` (an object with a string
 * `type`), otherwise `undefined`. Lenient: malformed `expected` entries are skipped.
 */
export function parseApiErrorBody(raw: unknown): ApiErrorBody | undefined {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') return undefined;
  const expectedRaw = raw['expected'];
  const expected = Array.isArray(expectedRaw)
    ? expectedRaw.map(parseField).filter((f): f is FieldDescriptor => f !== undefined)
    : [];
  return {
    type: raw['type'],
    message: typeof raw['message'] === 'string' ? raw['message'] : undefined,
    translatableMessage: parseTranslatable(raw['translatableMessage']),
    statusCode: typeof raw['statusCode'] === 'number' ? raw['statusCode'] : undefined,
    expected,
  };
}
