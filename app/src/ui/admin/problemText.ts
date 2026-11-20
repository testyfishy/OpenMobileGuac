import { adminStrings } from './adminStrings.ts';
import type { FieldProblem } from './validation.ts';

/** The message for a validation problem on one field. */
export function problemText(problem: FieldProblem | undefined, name: string): string | undefined {
  if (!problem) return undefined;
  const e = adminStrings.editor;
  if (problem === 'number') return e.notNumber;
  return name === 'hostname' ? e.hostnameRequired : e.required;
}
