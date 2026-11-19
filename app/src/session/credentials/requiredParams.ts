/**
 * The server credential prompt (FEATURES gap 4, proposed SRV-11).
 *
 * When guacd needs connection parameters it does not have (typically RDP or SSH credentials
 * left empty in the connection), it sends a `required` instruction listing parameter names.
 * The vendored client dispatches it as `client.onrequired(names)` (`Client.js`, handler
 * `"required"`). The web client builds a form from the names and answers each one on its
 * own argument-value stream (`ManagedClient.sendArguments`, upstream 1.6.0). This module
 * turns the names into form fields and the answers into the list of values to send; the
 * stream calls live in the UI glue.
 *
 * Pure: no DOM, no library imports. Values are never logged or persisted by this module.
 */

export interface RequiredField {
  /** Connection parameter name, exactly as the server sent it (the `argv` stream name). */
  readonly name: string;
  readonly label: string;
  /** Masked input with a show/hide control. */
  readonly secret: boolean;
  /** Multi-line input (private keys). */
  readonly multiline: boolean;
  /** `autocomplete` hint for the input. */
  readonly autocomplete: 'username' | 'current-password' | 'off';
  /** Short help text, if any. */
  readonly hint?: string;
}

/**
 * Labels for parameter names. guacd 1.6.0 requests `username`, `domain` and `password` for
 * RDP (guacamole-server `src/protocols/rdp/rdp.c`; `domain` only when both username and
 * domain are unset) and `username` / `password` for VNC (`src/protocols/vnc/auth.c`). SSH
 * does not use `required` in 1.6.0: it prompts inside the terminal
 * (`src/protocols/ssh/ssh.c`, `guac_terminal_prompt`). The other names are defensive
 * labels for connection parameters a future or patched guacd might request; unknown names
 * get a readable label derived from the name.
 */
const KNOWN: Readonly<Record<string, Omit<RequiredField, 'name'>>> = {
  username: { label: 'Username', secret: false, multiline: false, autocomplete: 'username' },
  password: {
    label: 'Password',
    secret: true,
    multiline: false,
    autocomplete: 'current-password',
  },
  domain: {
    label: 'Domain',
    secret: false,
    multiline: false,
    autocomplete: 'off',
    hint: 'Leave empty if the computer is not in a domain',
  },
  passphrase: {
    label: 'Key passphrase',
    secret: true,
    multiline: false,
    autocomplete: 'off',
    hint: 'Passphrase of the private key',
  },
  'private-key': {
    label: 'Private key',
    secret: true,
    multiline: true,
    autocomplete: 'off',
    hint: 'PEM text of the private key',
  },
  'sftp-username': {
    label: 'SFTP username',
    secret: false,
    multiline: false,
    autocomplete: 'username',
  },
  'sftp-password': {
    label: 'SFTP password',
    secret: true,
    multiline: false,
    autocomplete: 'current-password',
  },
  'sftp-passphrase': {
    label: 'SFTP key passphrase',
    secret: true,
    multiline: false,
    autocomplete: 'off',
  },
  'gateway-username': {
    label: 'Gateway username',
    secret: false,
    multiline: false,
    autocomplete: 'username',
  },
  'gateway-password': {
    label: 'Gateway password',
    secret: true,
    multiline: false,
    autocomplete: 'current-password',
  },
  'gateway-domain': {
    label: 'Gateway domain',
    secret: false,
    multiline: false,
    autocomplete: 'off',
  },
};

/** Whether a parameter name looks like a secret (masked, never shown or logged). */
export function isSecretParam(name: string): boolean {
  const known = KNOWN[name];
  if (known) return known.secret;
  return /pass|secret|key|token|pin\b/i.test(name);
}

/** "client-name" → "Client name". */
export function humanizeParamName(name: string): string {
  const words = name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  if (words === '') return 'Value';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Order used for display: username before domain before password, then the rest. */
const ORDER = ['username', 'domain', 'password', 'passphrase', 'private-key'];

/**
 * Form fields for the requested parameter names: de-duplicated, empty names dropped,
 * known names in a natural order, unknown names after them in the server's order.
 */
export function describeRequiredParams(names: readonly string[]): RequiredField[] {
  const unique: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string' || n === '' || unique.includes(n)) continue;
    unique.push(n);
  }
  const rank = (n: string) => {
    const i = ORDER.indexOf(n);
    return i === -1 ? ORDER.length : i;
  };
  const sorted = unique
    .map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
    .map((x) => x.n);
  return sorted.map((name) => {
    const known = KNOWN[name];
    if (known) return { name, ...known };
    const secret = isSecretParam(name);
    return {
      name,
      label: humanizeParamName(name),
      secret,
      multiline: false,
      autocomplete: 'off',
    };
  });
}

/**
 * The values to send, one per requested field, in field order. Like the web client
 * (`requiredParameters[name] = ''` then `sendArguments`), every requested parameter is
 * answered, an empty field with the empty string, so guacd never waits on a parameter.
 */
export function argumentValues(
  fields: readonly RequiredField[],
  values: Readonly<Record<string, string | undefined>>,
): { name: string; value: string }[] {
  return fields.map((f) => {
    const raw = values[f.name] ?? '';
    // Single-line fields: a pasted trailing newline is never part of a credential.
    const value = f.multiline ? raw : raw.replace(/[\r\n]+$/, '');
    return { name: f.name, value };
  });
}
