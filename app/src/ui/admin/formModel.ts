import type { SchemaField, SchemaForm } from '../../core/models/Admin.ts';
import { foldForSearch } from '../connections/treeView.ts';
import { fieldLabel, optionLabel, sectionLabel, type TranslationTable } from './labels.ts';

/**
 * Turns the server's schema forms into what the editor renders (docs/protocol-notes.md
 * §8.4). Pure. Values are the server's strings: `""` / absent = unset; a BOOLEAN is on when
 * it equals the field's truth value (`options[0]`).
 */

export type FieldKind =
  | 'text'
  | 'username'
  | 'password'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'multiline'
  | 'timezone'
  | 'colorscheme';

export interface FieldModel {
  readonly name: string;
  readonly kind: FieldKind;
  /** The schema's type string, kept for unknown extension types. */
  readonly rawType: string;
  readonly label: string;
  /** ENUM options with labels. `""` is the server default. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** BOOLEAN: the value meaning "on" (`options[0]`, normally `"true"`). */
  readonly truthValue: string;
}

export interface SectionModel {
  /** The form's name (`""` for an unnamed form). */
  readonly id: string;
  readonly label: string;
  readonly fields: readonly FieldModel[];
}

export function fieldKind(type: string): FieldKind {
  switch (type) {
    case 'USERNAME':
      return 'username';
    case 'PASSWORD':
      return 'password';
    case 'NUMERIC':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    case 'ENUM':
      return 'enum';
    case 'MULTILINE':
      return 'multiline';
    case 'TIMEZONE':
      return 'timezone';
    case 'TERMINAL_COLOR_SCHEME':
      return 'colorscheme';
    default:
      // TEXT, EMAIL and any extension type: a plain text box never loses data.
      return 'text';
  }
}

export function buildField(
  field: SchemaField,
  ns: string,
  defaultLabel: string,
  table?: TranslationTable | null,
): FieldModel {
  const kind = fieldKind(field.type);
  return {
    name: field.name,
    kind,
    rawType: field.type,
    label: fieldLabel(ns, field.name, table),
    options:
      kind === 'enum' || kind === 'colorscheme'
        ? field.options.map((value) => ({
            value,
            label: optionLabel(ns, field.name, value, defaultLabel, table),
          }))
        : [],
    truthValue: kind === 'boolean' ? (field.options[0] ?? 'true') : '',
  };
}

export function buildSections(
  forms: readonly SchemaForm[],
  ns: string,
  defaultLabel: string,
  table?: TranslationTable | null,
): SectionModel[] {
  return forms
    .map((form) => ({
      id: form.name,
      label: sectionLabel(ns, form.name, table),
      fields: form.fields.map((f) => buildField(f, ns, defaultLabel, table)),
    }))
    .filter((s) => s.fields.length > 0);
}

/** Every field name the schema knows. */
export function schemaFieldNames(forms: readonly SchemaForm[]): Set<string> {
  const out = new Set<string>();
  for (const form of forms) for (const f of form.fields) out.add(f.name);
  return out;
}

export function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '';
}

/** Equality under the "absent = empty = unset" rule. */
export function sameValue(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

/** Parameters with a value that the schema does not list (shown under "Advanced"). */
export function unknownParameters(
  forms: readonly SchemaForm[],
  values: Readonly<Record<string, string>>,
): string[] {
  const known = schemaFieldNames(forms);
  return Object.keys(values)
    .filter((k) => !known.has(k))
    .sort();
}

/** Number of fields in a section that have a value. */
export function countSet(section: SectionModel, values: Readonly<Record<string, string>>): number {
  return section.fields.filter((f) => isSet(values[f.name])).length;
}

/**
 * Search: keeps fields whose label or parameter name contains every term (case- and
 * accent-insensitive). Sections whose own label matches keep all their fields. Empty query →
 * unchanged.
 */
export function filterSections(sections: readonly SectionModel[], query: string): SectionModel[] {
  const terms = foldForSearch(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [...sections];
  const matches = (hay: string) => {
    const folded = foldForSearch(hay);
    return terms.every((t) => folded.includes(t));
  };
  const out: SectionModel[] = [];
  for (const s of sections) {
    if (matches(s.label)) {
      out.push(s);
      continue;
    }
    const fields = s.fields.filter((f) => matches(`${f.label} ${f.name}`));
    if (fields.length > 0) out.push({ ...s, fields });
  }
  return out;
}

/** Sets or clears (`""` → removed) one value, returning a new map. */
export function withValue(
  values: Readonly<Record<string, string>>,
  name: string,
  value: string,
): Record<string, string> {
  if (value !== '') return { ...values, [name]: value };
  return Object.fromEntries(Object.entries(values).filter(([k]) => k !== name));
}

/** Drops empty values: the server stores nothing for them anyway (§8.1). */
export function compact(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v !== '') out[k] = v;
  return out;
}

/** Whether two value maps differ under the "absent = empty" rule. */
export function valuesDiffer(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!sameValue(a[k], b[k])) return true;
  return false;
}
