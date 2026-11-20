/**
 * Pure mappings between DOM input events and the session models / Guacamole wire format.
 * Kept free of DOM types (plain shapes in, plain shapes out) so they can be unit-tested
 * without a browser.
 */

import type { MouseState } from '../../session/pointer/PointerModel.ts';
import type { PointerKind } from '../../session/gesture/GestureRecognizer.ts';
import { KEYSYM, type KeyEvent } from '../../session/keys/KeyModel.ts';

// ---------------------------------------------------------------------------------------
// Mouse

/** The template accepted by `new Guacamole.Mouse.State(template)` (Mouse.js). */
export interface GuacMouseStateTemplate {
  x: number;
  y: number;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

/** Copy a model state into the library's template shape (integer remote pixels). */
export function toGuacMouseTemplate(s: MouseState): GuacMouseStateTemplate {
  return {
    x: Math.floor(s.x),
    y: Math.floor(s.y),
    left: s.left,
    middle: s.middle,
    right: s.right,
    up: s.up,
    down: s.down,
  };
}

/** Guacamole's `mouse` instruction button mask (Client.js `sendMouseState`). */
export function guacButtonMask(s: MouseState): number {
  return (
    (s.left ? 1 : 0) | (s.middle ? 2 : 0) | (s.right ? 4 : 0) | (s.up ? 8 : 0) | (s.down ? 16 : 0)
  );
}

/**
 * `PointerEvent.buttons` bit field (1 = primary, 2 = secondary, 4 = auxiliary/middle) to
 * named buttons. Note the order differs from Guacamole's mask (middle 2, right 4).
 */
export function pointerButtons(buttons: number): {
  left: boolean;
  middle: boolean;
  right: boolean;
} {
  const b = Number.isFinite(buttons) ? buttons : 0;
  return { left: (b & 1) !== 0, right: (b & 2) !== 0, middle: (b & 4) !== 0 };
}

/**
 * Stylus buttons (PTR-5): tip contact = left button, barrel (side) button = right button
 * (the barrel replaces the tip, so pressing it while touching right-clicks), eraser
 * (`buttons` bit 32) = left as well.
 */
export function penButtons(buttons: number): { left: boolean; middle: boolean; right: boolean } {
  const b = Number.isFinite(buttons) ? buttons : 0;
  const right = (b & 2) !== 0;
  return { left: !right && (b & (1 | 32)) !== 0, middle: false, right };
}

/**
 * Mouse back / forward buttons (`buttons` bits 8 and 16). Guacamole's mouse protocol has
 * only left, middle, right and the vertical wheel, so these are sent as the universal
 * keyboard shortcuts Alt+Left / Alt+Right (browser and file-manager back / forward).
 */
export function extraButtonCombo(prevButtons: number, buttons: number): KeyEvent[] {
  const pressed = (bit: number) => (buttons & bit) !== 0 && (prevButtons & bit) === 0;
  const out: KeyEvent[] = [];
  const chord = (ks: number) => {
    out.push(
      { keysym: KEYSYM.Alt_L, pressed: true },
      { keysym: ks, pressed: true },
      { keysym: ks, pressed: false },
      { keysym: KEYSYM.Alt_L, pressed: false },
    );
  };
  if (pressed(8)) chord(KEYSYM.Left);
  if (pressed(16)) chord(KEYSYM.Right);
  return out;
}

export function pointerKind(pointerType: string): PointerKind {
  if (pointerType === 'mouse') return 'mouse';
  if (pointerType === 'pen') return 'pen';
  return 'touch';
}

/**
 * WheelEvent.deltaMode → pixels. Line = 18 px as upstream `Mouse.js` (`PIXELS_PER_LINE`), so
 * one 3-line notch (54 px) passes the 50 px scroll step; page = 0.9 × viewport height.
 */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeightPx: number): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * 18;
  if (deltaMode === 2) return delta * Math.max(1, pageHeightPx) * 0.9;
  return delta;
}

// ---------------------------------------------------------------------------------------
// Hardware keyboard: the pure logic lives in session/keys/HardwareKeyboard.ts.

export {
  decideHardwareKey,
  keysymForKey,
  missingModifierKeysyms,
  type HardwareKeyDecision,
  type KeyEventLike,
} from '../../session/keys/HardwareKeyboard.ts';
