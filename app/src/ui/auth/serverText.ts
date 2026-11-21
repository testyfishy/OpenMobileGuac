import { canonicalize, deriveLabel, lookup, type TranslationTable } from '../admin/labels.ts';
import { strings } from '../strings.ts';
import type { ServerText } from './authFlow.ts';

/**
 * The server's own wording for a sign-in step or error, in the UI language when the server
 * has it (docs/protocol-notes.md §1.4, §1.7).
 *
 * Upstream errors carry `translatableMessage: { key, variables }` (for example
 * `LOGIN.INFO_PASSWORD_EXPIRED`, `PASSWORD_POLICY.ERROR_TOO_SHORT` with `{ LENGTH: 10 }`,
 * `LOGIN.INFO_DUO_AUTH_REQUIRED`), and the web client translates the key with the
 * server's table (`translations/<lang>.json`, which merges every installed extension's
 * strings). The app does the same and falls back to the English `message`. No upstream
 * text is bundled.
 */

type Vars = Readonly<Record<string, unknown>>;

/** Index of the `}` closing the `{` at `open`, or -1. */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function pluralChoice(body: string, n: number): string | undefined {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const m = /^\s*(=\d+|zero|one|two|few|many|other)\s*\{/.exec(body.slice(i));
    if (!m?.[1]) break;
    const open = i + m[0].length - 1;
    const end = closing(body, open);
    if (end < 0) return undefined;
    options.set(m[1], body.slice(open + 1, end));
    i = end + 1;
  }
  // English-style categories are enough for the messages upstream sends (counts of
  // characters, days, passwords); other languages' servers use the same keys.
  const picked =
    options.get(`=${n}`) ?? (n === 1 ? options.get('one') : undefined) ?? options.get('other');
  return picked?.replace(/#/g, String(n));
}

/**
 * Minimal ICU MessageFormat, as angular-translate's messageformat interpolation uses:
 * `{NAME}` and `{NAME, plural, one{…} other{…}}`. Returns `undefined` when a placeholder
 * cannot be filled, so the caller can fall back to the server's English message.
 */
export function formatServerMessage(template: string, vars: Vars | undefined): string | undefined {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const end = closing(template, open);
    if (end < 0) return undefined;
    const inner = template.slice(open + 1, end);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const value = vars?.[name];
    if (value === undefined || value === null) return undefined;
    if (comma < 0) {
      out += String(value);
    } else {
      const rest = inner.slice(comma + 1);
      const m = /^\s*plural\s*,/.exec(rest);
      const n = typeof value === 'number' ? value : Number(value);
      if (!m || !Number.isFinite(n)) return undefined;
      const choice = pluralChoice(rest.slice(m[0].length), n);
      if (choice === undefined) return undefined;
      const nested = formatServerMessage(choice, vars);
      if (nested === undefined) return undefined;
      out += nested;
    }
    i = end + 1;
  }
  return out;
}

/** The text to show for a server message, or `undefined` if the server gave none. */
export function serverMessageText(
  text: ServerText | undefined,
  table: TranslationTable | null | undefined,
): string | undefined {
  if (!text) return undefined;
  const tm = text.translatableMessage;
  if (tm) {
    const template = lookup(table, tm.key);
    const formatted = template ? formatServerMessage(template, tm.variables) : undefined;
    if (formatted && formatted.trim()) return formatted.trim();
  }
  return text.message;
}

/**
 * Label for a field of the sign-in form, as the web client shows it
 * (`LOGIN.FIELD_HEADER_<NAME>`), else the app's own label for known fields, else one
 * derived from the name.
 */
export function loginFieldLabel(name: string, table: TranslationTable | null | undefined): string {
  return (
    lookup(table, `LOGIN.FIELD_HEADER_${canonicalize(name)}`) ??
    strings.login.fieldLabels[name] ??
    deriveLabel(name.replace(/^guac-/, ''))
  );
}
