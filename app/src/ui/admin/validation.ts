import type { SchemaForm } from '../../core/models/Admin.ts';
import { fieldKind, isSet } from './formModel.ts';

/**
 * Client-side checks before saving. The server repeats the important ones (blank and
 * duplicate names are `BAD_REQUEST`; docs/protocol-notes.md §8.1); these just catch them
 * earlier with a clear message. Pure.
 */

export type FieldProblem = 'required' | 'number';

/** guacd cannot connect without a host for these protocols. */
const NEEDS_HOSTNAME = new Set(['rdp', 'vnc', 'ssh', 'telnet', 'kubernetes']);

export interface ConnectionDraftCheck {
  readonly name: string;
  readonly protocol: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface ValidationResult {
  /** `name`, `protocol`, `param:<name>`, `attr:<name>` → problem. */
  readonly errors: Readonly<Record<string, FieldProblem>>;
  readonly ok: boolean;
}

const INTEGER = /^-?\d+$/;

function numericProblems(
  forms: readonly SchemaForm[],
  values: Readonly<Record<string, string>>,
  prefix: string,
  out: Record<string, FieldProblem>,
): void {
  for (const form of forms) {
    for (const f of form.fields) {
      const v = values[f.name];
      if (fieldKind(f.type) === 'number' && isSet(v) && !INTEGER.test((v ?? '').trim()))
        out[`${prefix}${f.name}`] = 'number';
    }
  }
}

export function requiresHostname(protocol: string, forms: readonly SchemaForm[]): boolean {
  return (
    NEEDS_HOSTNAME.has(protocol) &&
    forms.some((form) => form.fields.some((f) => f.name === 'hostname'))
  );
}

export function validateConnection(
  draft: ConnectionDraftCheck,
  parameterForms: readonly SchemaForm[],
  attributeForms: readonly SchemaForm[],
): ValidationResult {
  const errors: Record<string, FieldProblem> = {};
  if (draft.name.trim() === '') errors['name'] = 'required';
  if (draft.protocol.trim() === '') errors['protocol'] = 'required';
  if (
    requiresHostname(draft.protocol, parameterForms) &&
    !isSet(draft.parameters['hostname']?.trim())
  )
    errors['param:hostname'] = 'required';
  numericProblems(parameterForms, draft.parameters, 'param:', errors);
  numericProblems(attributeForms, draft.attributes, 'attr:', errors);
  return { errors, ok: Object.keys(errors).length === 0 };
}

export function validateGroup(
  draft: { readonly name: string; readonly attributes: Readonly<Record<string, string>> },
  attributeForms: readonly SchemaForm[],
): ValidationResult {
  const errors: Record<string, FieldProblem> = {};
  if (draft.name.trim() === '') errors['name'] = 'required';
  numericProblems(attributeForms, draft.attributes, 'attr:', errors);
  return { errors, ok: Object.keys(errors).length === 0 };
}

/** A parameter name typed in "Advanced": non-empty, no spaces. */
export function isValidParameterName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

/** "Copy of X", unique among sibling names (adds " (2)", " (3)", … when needed). */
export function cloneName(
  base: string,
  prefix: (name: string) => string,
  taken: readonly string[],
): string {
  const first = prefix(base);
  const used = new Set(taken.map((t) => t.trim().toLocaleLowerCase()));
  if (!used.has(first.toLocaleLowerCase())) return first;
  for (let i = 2; i < 100; i++) {
    const candidate = `${first} (${i})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return first;
}
