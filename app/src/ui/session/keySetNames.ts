/** Display text for key sets and combos (translated). No React. */

import type { ComboStep } from '../../session/keys/ComboLibrary.ts';
import {
  LEGACY_SET_ID,
  findSet,
  type KeyLibrary,
  type KeySet,
} from '../../session/keys/KeySets.ts';
import { keyCapLabel } from './keyBarLayout.ts';
import { sessionStrings } from './sessionStrings.ts';

export function keySetName(set: KeySet | undefined, id?: string): string {
  const k = sessionStrings.keySets;
  const sid = set?.id ?? id ?? '';
  if (sid === LEGACY_SET_ID) return k.legacyName;
  return k.builtInNames[sid] ?? set?.name ?? sid;
}

/** Name for a set id in a library (for summaries). */
export function keySetNameIn(lib: KeyLibrary, id: string): string {
  return keySetName(findSet(lib, id), id);
}

/** Readable preview of a combo: `Ctrl+K, wait 200 ms, Ctrl+C`. */
export function comboPreview(steps: readonly ComboStep[]): string {
  const c = sessionStrings.combos;
  const parts: string[] = [];
  steps.forEach((s, i) => {
    parts.push(s.keys.map(keyCapLabel).join('+'));
    if (s.delayMs && i < steps.length - 1) parts.push(c.previewWait(s.delayMs));
  });
  return parts.join(', ');
}

/** `openmobileguac-keys-2026-11-20.json` */
export function keysFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `openmobileguac-keys-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
