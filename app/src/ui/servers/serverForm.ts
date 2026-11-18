import { normalizeServerUrl } from '../../core/url/normalizeServerUrl.ts';
import { strings } from '../strings.ts';

/** Values of the add/edit server form. */
export interface ServerFormValues {
  readonly name: string;
  readonly url: string;
  readonly username: string;
  /** Empty when editing means "keep the saved password". */
  readonly password: string;
  readonly rememberPassword: boolean;
}

export type ServerFormErrors = Partial<Record<'name' | 'url', string>>;

export function emptyServerForm(): ServerFormValues {
  return { name: '', url: '', username: '', password: '', rememberPassword: true };
}

/** Client-side checks before probing. Returns an empty object when valid. */
export function validateServerForm(values: ServerFormValues): ServerFormErrors {
  const errors: { name?: string; url?: string } = {};
  if (values.name.trim().length === 0) errors.name = strings.serverForm.errors.nameRequired;
  const n = normalizeServerUrl(values.url);
  if (!n.ok) {
    errors.url =
      n.reason === 'empty'
        ? strings.serverForm.errors.urlRequired
        : n.reason === 'unsupported-scheme'
          ? strings.serverForm.errors.urlScheme
          : strings.serverForm.errors.urlInvalid;
  }
  return errors;
}

export function hasErrors(errors: ServerFormErrors): boolean {
  return Object.values(errors).some((v) => v !== undefined);
}

/** A default display name from what the user typed, e.g. `guac.example:8080` → `guac.example`. */
export function suggestName(url: string): string {
  const n = normalizeServerUrl(url);
  if (!n.ok) return '';
  const first = n.candidates[0];
  if (!first) return '';
  try {
    return new URL(first.baseUrl).hostname;
  } catch {
    return '';
  }
}

/**
 * Whether the URL the user typed still matches a saved base URL, so editing other fields
 * does not force a new probe.
 */
export function urlUnchanged(typed: string, savedBaseUrl: string): boolean {
  if (typed.trim() === savedBaseUrl) return true;
  const n = normalizeServerUrl(typed);
  return n.ok && n.candidates.length === 1 && n.candidates[0]?.baseUrl === savedBaseUrl;
}

/** The host to show in the http warning. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function isInsecureUrl(baseUrl: string): boolean {
  return baseUrl.toLowerCase().startsWith('http:');
}
