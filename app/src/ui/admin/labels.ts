/**
 * Labels for schema forms, fields and options (docs/protocol-notes.md §8.4).
 *
 * The web client looks every label up in its translation table under
 * `<NS>.FIELD_HEADER_<NAME>`, `<NS>.FIELD_OPTION_<NAME>_<VALUE|EMPTY>` and
 * `<NS>.SECTION_HEADER_<FORM>`. We use the server's own table when it can be fetched
 * (`translations/<lang>.json`) and otherwise derive a readable label from the name. No
 * upstream translation text is bundled.
 */

/** A server translation table: `{ NAMESPACE: { KEY: "text" } }`. */
export type TranslationTable = Readonly<Record<string, unknown>>;

/** Upstream `translationStringService.canonicalize`: non-alphanumeric runs → `_`, upper case. */
export function canonicalize(identifier: string): string {
  return identifier.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

/** Namespace of a protocol's parameter labels (`Protocol.getNamespace`). */
export function protocolNamespace(protocol: string): string {
  return `PROTOCOL_${canonicalize(protocol)}`;
}

export const CONNECTION_ATTRIBUTES_NS = 'CONNECTION_ATTRIBUTES';
export const GROUP_ATTRIBUTES_NS = 'CONNECTION_GROUP_ATTRIBUTES';

/** Words kept in capitals when deriving a label from a parameter name. */
const ACRONYMS = new Map<string, string>([
  ['rdp', 'RDP'],
  ['vnc', 'VNC'],
  ['ssh', 'SSH'],
  ['sftp', 'SFTP'],
  ['dpi', 'DPI'],
  ['gfx', 'GFX'],
  ['ssl', 'SSL'],
  ['tls', 'TLS'],
  ['nla', 'NLA'],
  ['udp', 'UDP'],
  ['mac', 'MAC'],
  ['url', 'URL'],
  ['id', 'ID'],
  ['ca', 'CA'],
  ['pdu', 'PDU'],
  ['wol', 'WoL'],
  ['guacd', 'guacd'],
]);

/**
 * `enable-wallpaper` → "Enable wallpaper", `sftp-host-key` → "SFTP host key",
 * `max-connections-per-user` → "Max connections per user".
 */
export function deriveLabel(name: string): string {
  const words = name
    .split(/[-_\s.]+/)
    .filter((w) => w.length > 0)
    .map((w) => ACRONYMS.get(w.toLowerCase()) ?? w.toLowerCase());
  if (words.length === 0) return name;
  const [first, ...rest] = words;
  const head = first && ACRONYMS.has(first.toLowerCase()) ? first : capitalise(first ?? '');
  return [head, ...rest].join(' ');
}

function capitalise(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const MAX_LINK_DEPTH = 5;

/**
 * Looks a dotted key (`NS.KEY`) up, following angular-translate `@:NS.KEY` links and
 * dropping the trailing colon upstream uses on field headers. `undefined` when missing or
 * empty.
 */
export function lookup(
  table: TranslationTable | null | undefined,
  key: string,
): string | undefined {
  if (!table) return undefined;
  let current = key;
  for (let depth = 0; depth <= MAX_LINK_DEPTH; depth++) {
    const dot = current.indexOf('.');
    if (dot <= 0) return undefined;
    const ns = table[current.slice(0, dot)];
    if (!ns || typeof ns !== 'object') return undefined;
    const value = (ns as Record<string, unknown>)[current.slice(dot + 1)];
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    const link = /^@:([A-Z0-9_]+\.[A-Z0-9_]+)$/.exec(trimmed);
    if (link?.[1]) {
      current = link[1];
      continue;
    }
    const text = trimmed.replace(/\s*:$/, '').trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

export function fieldLabel(ns: string, field: string, table?: TranslationTable | null): string {
  return lookup(table, `${ns}.FIELD_HEADER_${canonicalize(field)}`) ?? deriveLabel(field);
}

export function sectionLabel(ns: string, form: string, table?: TranslationTable | null): string {
  if (!form) return '';
  return lookup(table, `${ns}.SECTION_HEADER_${canonicalize(form)}`) ?? deriveLabel(form);
}

/**
 * Label of one ENUM option. `defaultLabel` is used for the empty option ("server default")
 * when the server has no text for it (upstream's English text for `…_EMPTY` is blank).
 */
export function optionLabel(
  ns: string,
  field: string,
  value: string,
  defaultLabel: string,
  table?: TranslationTable | null,
): string {
  const key = `${ns}.FIELD_OPTION_${canonicalize(field)}_${canonicalize(value || 'EMPTY')}`;
  return lookup(table, key) ?? (value === '' ? defaultLabel : value);
}

/** Display name of a protocol (`PROTOCOL_<P>.NAME`), else its name in capitals. */
export function protocolName(protocol: string, table?: TranslationTable | null): string {
  return lookup(table, `${protocolNamespace(protocol)}.NAME`) ?? protocol.toUpperCase();
}
