/**
 * The demo desktop: window manager, widgets, text model and input state machine. Pure
 * logic, with no canvas, DOM or timers. The clock time comes in through `pointer`/`tick`
 * arguments and text widths through the injected `measure`.
 *
 * Each window is its own Guacamole layer (a "surface"), so moving a window costs only a
 * `move` instruction. The wallpaper and taskbar are on layer 0. Changes are tracked as
 * damage rectangles per surface, which the server (`server.ts`) repaints and sends.
 */
import { contains, mergeRects, rect, type Rect } from './geometry.ts';
import {
  Keysym,
  heldModifiers,
  keysymName,
  keysymToText,
  modifierOf,
  shortcutLetter,
} from './keysyms.ts';
import type { FontSpec, MeasureText } from './painter.ts';
import {
  TextModel,
  indexAtX,
  layoutText,
  lineIndexOf,
  xOfIndex,
  type TextLine,
} from './textModel.ts';

export const TASKBAR_H = 36;
export const TITLE_H = 28;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 800;
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 240;
export const MAX_WIDTH = 4096;
export const MAX_HEIGHT = 4096;
/** Two presses closer than this (ms and px) form a double click. */
export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_PX = 6;

/** Mouse button mask bits (`Client.sendMouseState`). */
export const Button = { LEFT: 1, MIDDLE: 2, RIGHT: 4, UP: 8, DOWN: 16 } as const;

export type WindowId = 'notes' | 'input' | 'about';
export type SurfaceId = 'desktop' | WindowId | 'menu';
export type CursorShape = 'arrow' | 'text' | 'move';
export type ClickKind = 'left' | 'right' | 'middle' | 'double';

/** Guacamole layer index of each surface. */
export const LAYERS: Readonly<Record<SurfaceId, number>> = {
  desktop: 0,
  notes: 1,
  input: 2,
  about: 3,
  menu: 4,
};

export interface DemoWindow {
  readonly id: WindowId;
  readonly title: string;
  x: number;
  y: number;
  readonly w: number;
  readonly h: number;
  visible: boolean;
}

/** Where a surface is and whether it shows, as the server needs to place its layer. */
export interface SurfaceState {
  readonly id: SurfaceId;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly z: number;
  readonly visible: boolean;
}

/** Content inside `rect` of `surface` moved by `dy` pixels (a scroll). */
export interface CopyHint {
  readonly surface: SurfaceId;
  readonly rect: Rect;
  readonly dy: number;
}

export interface DamageReport {
  readonly rects: ReadonlyMap<SurfaceId, readonly Rect[]>;
  /** Applied by the client before the rects are repainted. */
  readonly copies: readonly CopyHint[];
}

// ---- Layout constants (window-local coordinates) -----------------------------------------

export const NOTES = {
  w: 520,
  h: 392,
  hint: rect(12, TITLE_H + 6, 496, 20),
  area: rect(12, TITLE_H + 30, 496, 270),
  clip: rect(12, TITLE_H + 306, 496, 20),
  status: rect(12, TITLE_H + 330, 496, 20),
  pad: 6,
  lineH: 18,
  font: { size: 13, mono: true } as FontSpec,
} as const;

const ROWS_TOP = TITLE_H + 8;
const ROW_H = 20;
export const INPUT = {
  w: 560,
  h: 416,
  valueX: 120,
  rowsTop: ROWS_TOP,
  rowH: ROW_H,
  row: (i: number): Rect => rect(0, ROWS_TOP + i * ROW_H, 560, ROW_H),
  pill: (i: number): Rect => rect(120 + i * 70, ROWS_TOP + ROW_H + 2, 62, 16),
  checkbox: (i: number): Rect => rect(120 + i * 26, ROWS_TOP + 6 * ROW_H + 4, 12, 12),
  checkboxCount: 8,
  captionsY: ROWS_TOP + 7 * ROW_H + 6,
  dragArea: rect(14, 200, 300, 200),
  boxSize: 44,
  list: rect(330, 200, 216, 200),
  listRowH: 20,
  listItems: 60,
  scrollbarW: 8,
} as const;

/** Input test rows, by index into `INPUT.row`. */
export const ROW = {
  pointer: 0,
  buttons: 1,
  click: 2,
  wheel: 3,
  key: 4,
  held: 5,
  targets: 6,
} as const;

export const ABOUT = { w: 520, h: 236, target: rect(372, TITLE_H + 14, 132, 132) } as const;

export const MENU_ITEMS = [
  'Arrange windows',
  'Show all windows',
  'Change wallpaper',
  'Clear notes',
] as const;
export const MENU = { w: 184, itemH: 24, pad: 4 } as const;
const MENU_H = MENU_ITEMS.length * MENU.itemH + MENU.pad * 2;

export const WALLPAPER_COUNT = 3;
/** Longest paste into Notes, in code points, to keep layout and painting fast. */
export const MAX_PASTE = 20000;

// No astral characters here: guacamole-common-js 1.6.0's StringReader mangles them, so a
// select-all and copy of the seed text would arrive garbled on the device.
const INITIAL_NOTES =
  'Welcome to the demo desktop.\n' +
  'Everything here runs inside the app; nothing is sent anywhere.\n' +
  '\n' +
  'Try typing, Unicode (café, 日本語), Enter and Backspace.\n';

export interface DemoDesktopOptions {
  readonly width?: number;
  readonly height?: number;
  readonly measure: MeasureText;
  /** Epoch ms used for the clock until the first `tick`. Default 0. */
  readonly now?: number;
}

export function clampSize(width: number, height: number): { width: number; height: number } {
  const fix = (v: number, min: number, max: number, def: number) =>
    Number.isFinite(v) && v > 0 ? Math.max(min, Math.min(max, Math.floor(v))) : def;
  return {
    width: fix(width, MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH),
    height: fix(height, MIN_HEIGHT, MAX_HEIGHT, DEFAULT_HEIGHT),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

type Drag =
  | { readonly kind: 'window'; readonly id: WindowId; readonly dx: number; readonly dy: number }
  | { readonly kind: 'box'; readonly dx: number; readonly dy: number };

type Hit =
  | { readonly kind: 'taskbar'; readonly button: WindowId | null }
  | { readonly kind: 'window'; readonly win: DemoWindow; readonly lx: number; readonly ly: number }
  | { readonly kind: 'menu'; readonly item: number | null }
  | { readonly kind: 'desktop' };

export class DemoDesktop {
  width: number;
  height: number;
  readonly measure: MeasureText;

  readonly windows: Record<WindowId, DemoWindow>;
  /** Stacking order, bottom first. */
  readonly stack: WindowId[] = ['about', 'notes', 'input'];
  focused: WindowId | null = 'notes';
  notesFocused = true;
  readonly notes = new TextModel(INITIAL_NOTES);
  notesScroll = 0;

  clipboard = '';
  clipboardSource: 'none' | 'client' | 'notes' = 'none';

  wallpaper = 0;
  clockText: string;

  menuOpen = false;
  menuX = 0;
  menuY = 0;
  menuHover: number | null = null;

  // Input test state
  pointerX = 0;
  pointerY = 0;
  mask = 0;
  lastClick: ClickKind | null = null;
  clicks = 0;
  wheelUp = 0;
  wheelDown = 0;
  lastKey: string | null = null;
  lastKeysym: number | null = null;
  readonly held = new Set<number>();
  readonly checks: boolean[] = Array.from({ length: INPUT.checkboxCount }, (_, i) => i === 1);
  boxX = 24;
  boxY = 24;
  listScroll = 0;

  cursor: CursorShape = 'arrow';

  private drag: Drag | null = null;
  private lastLeft: { t: number; x: number; y: number } | null = null;
  private damage = new Map<SurfaceId, Rect[]>();
  private pendingScroll = 0;
  private outgoingClipboard: string | null = null;
  private readonly charWidths = new Map<string, number>();

  constructor(options: DemoDesktopOptions) {
    const { width, height } = clampSize(
      options.width ?? DEFAULT_WIDTH,
      options.height ?? DEFAULT_HEIGHT,
    );
    this.width = width;
    this.height = height;
    this.measure = options.measure;
    this.clockText = formatClock(options.now ?? 0);
    this.windows = {
      notes: { id: 'notes', title: 'Notes', x: 0, y: 0, w: NOTES.w, h: NOTES.h, visible: true },
      input: {
        id: 'input',
        title: 'Input test',
        x: 0,
        y: 0,
        w: INPUT.w,
        h: INPUT.h,
        visible: true,
      },
      about: {
        id: 'about',
        title: 'About this demo',
        x: 0,
        y: 0,
        w: ABOUT.w,
        h: ABOUT.h,
        visible: true,
      },
    };
    this.arrange();
  }

  // ---- Surfaces and damage ------------------------------------------------------------

  surfaces(): SurfaceState[] {
    const out: SurfaceState[] = [
      { id: 'desktop', layer: 0, x: 0, y: 0, w: this.width, h: this.height, z: 0, visible: true },
    ];
    for (const id of ['notes', 'input', 'about'] as const) {
      const w = this.windows[id];
      out.push({
        id,
        layer: LAYERS[id],
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        z: this.stack.indexOf(id) + 1,
        visible: w.visible,
      });
    }
    out.push({
      id: 'menu',
      layer: LAYERS.menu,
      x: this.menuX,
      y: this.menuY,
      w: MENU.w,
      h: MENU_H,
      z: 100,
      visible: this.menuOpen,
    });
    return out;
  }

  /** Marks part (or, without `r`, all) of a surface for repainting. */
  invalidate(id: SurfaceId, r?: Rect): void {
    const s = this.surfaceSize(id);
    const list = this.damage.get(id) ?? [];
    list.push(r ?? rect(0, 0, s.w, s.h));
    this.damage.set(id, list);
  }

  /** Returns and clears the damage collected since the last call. */
  takeDamage(): DamageReport {
    const copies: CopyHint[] = [];
    if (this.pendingScroll !== 0) {
      const dy = this.pendingScroll;
      this.pendingScroll = 0;
      const view = this.listViewport();
      if (Math.abs(dy) < view.h) {
        copies.push({ surface: 'input', rect: view, dy: -dy });
        const exposed =
          dy > 0
            ? rect(view.x, view.y + view.h - dy, view.w, dy)
            : rect(view.x, view.y, view.w, -dy);
        this.invalidate('input', exposed);
      } else {
        this.invalidate('input', view);
      }
      this.invalidate('input', this.scrollbarRect());
    }
    const rects = new Map<SurfaceId, Rect[]>();
    for (const [id, list] of this.damage) rects.set(id, mergeRects(list));
    this.damage = new Map();
    return { rects, copies };
  }

  hasDamage(): boolean {
    return this.damage.size > 0 || this.pendingScroll !== 0;
  }

  /** Text copied or cut in Notes since the last call, to send to the client. */
  takeClipboard(): string | null {
    const c = this.outgoingClipboard;
    this.outgoingClipboard = null;
    return c;
  }

  // ---- Commands -----------------------------------------------------------------------

  resize(width: number, height: number): void {
    const size = clampSize(width, height);
    if (size.width === this.width && size.height === this.height) return;
    this.width = size.width;
    this.height = size.height;
    this.closeMenu();
    this.drag = null;
    this.arrange();
    this.invalidate('desktop');
  }

  /** Places the windows in their default layout for the current size. */
  arrange(): void {
    const m = 16;
    const top = 56;
    const bottom = this.height - TASKBAR_H;
    const { notes, input, about } = this.windows;
    if (this.width >= notes.w + input.w + 3 * m) {
      notes.x = m;
      notes.y = top;
      input.x = Math.min(notes.x + notes.w + m * 2, this.width - input.w - m);
      input.y = top;
      about.x = m;
      about.y = notes.y + notes.h + m;
      if (about.y + about.h > bottom) {
        about.x = input.x;
        about.y = Math.max(top, bottom - about.h - m);
      }
    } else {
      let y = top;
      const fits = notes.h + input.h + about.h + 2 * m + top <= bottom;
      for (const [i, w] of [notes, input, about].entries()) {
        w.x = fits ? m : m + i * 32;
        w.y = fits ? y : top + i * 40;
        y += w.h + m;
      }
      // Stack in cascade order so every title bar stays visible.
      if (!fits) this.stack.splice(0, this.stack.length, 'notes', 'input', 'about');
    }
    for (const w of [notes, input, about]) this.clampWindow(w);
  }

  /** Text received from the client's clipboard stream. */
  receiveClipboard(text: string): void {
    this.clipboard = text;
    this.clipboardSource = 'client';
    this.invalidate('notes', NOTES.clip);
  }

  /** Updates the clock; returns whether it changed. */
  tick(epochMs: number): boolean {
    const text = formatClock(epochMs);
    if (text === this.clockText) return false;
    this.clockText = text;
    this.invalidate('desktop', this.clockRect());
    return true;
  }

  // ---- Pointer ------------------------------------------------------------------------

  /** Handles one `mouse,<x>,<y>,<mask>` instruction received at `t` ms. */
  pointer(x: number, y: number, mask: number, t: number): void {
    const prev = this.mask;
    const moved = x !== this.pointerX || y !== this.pointerY;
    this.pointerX = x;
    this.pointerY = y;
    this.mask = mask;
    const pressed = mask & ~prev;
    const released = prev & ~mask;

    if (moved) {
      this.invalidateRow(ROW.pointer);
      this.continueDrag();
      this.updateMenuHover();
    }
    if ((pressed | released) & 7) this.invalidateRow(ROW.buttons);

    for (const bit of [Button.LEFT, Button.MIDDLE, Button.RIGHT, Button.UP, Button.DOWN]) {
      if (pressed & bit) this.press(bit, x, y, t);
    }
    if (released & Button.LEFT) this.drag = null;
    this.updateCursor();
  }

  private press(bit: number, x: number, y: number, t: number): void {
    if (bit === Button.UP || bit === Button.DOWN) {
      if (bit === Button.UP) this.wheelUp++;
      else this.wheelDown++;
      this.invalidateRow(ROW.wheel);
      const hit = this.hitTest(x, y);
      if (hit.kind === 'window' && hit.win.id === 'input' && contains(INPUT.list, hit.lx, hit.ly)) {
        this.scrollList(bit === Button.UP ? -2 * INPUT.listRowH : 2 * INPUT.listRowH);
      }
      return;
    }

    this.recordClick(bit, x, y, t);

    if (this.menuOpen) {
      const hit = this.hitTest(x, y);
      this.closeMenu();
      if (bit === Button.LEFT && hit.kind === 'menu' && hit.item !== null) {
        this.runMenuItem(hit.item);
      }
      return;
    }

    const hit = this.hitTest(x, y);
    if (bit === Button.LEFT) this.leftPress(hit);
    else if (bit === Button.RIGHT) {
      if (hit.kind === 'desktop') this.openMenu(x, y);
      else if (hit.kind === 'window') this.raise(hit.win.id);
    } else if (hit.kind === 'window') {
      this.raise(hit.win.id);
    }
  }

  private recordClick(bit: number, x: number, y: number, t: number): void {
    let kind: ClickKind = bit === Button.LEFT ? 'left' : bit === Button.RIGHT ? 'right' : 'middle';
    if (bit === Button.LEFT) {
      const p = this.lastLeft;
      if (
        p &&
        t - p.t <= DOUBLE_CLICK_MS &&
        Math.abs(x - p.x) <= DOUBLE_CLICK_PX &&
        Math.abs(y - p.y) <= DOUBLE_CLICK_PX
      ) {
        kind = 'double';
        this.lastLeft = null;
      } else {
        this.lastLeft = { t, x, y };
      }
    }
    this.lastClick = kind;
    this.clicks++;
    this.invalidateRow(ROW.click);
  }

  private leftPress(hit: Hit): void {
    if (hit.kind === 'taskbar') {
      if (hit.button) this.toggleFromTaskbar(hit.button);
      return;
    }
    if (hit.kind !== 'window') {
      this.setFocus(null);
      return;
    }
    const { win, lx, ly } = hit;
    this.raise(win.id);
    if (ly < TITLE_H) {
      if (contains(closeButtonRect(win), lx, ly)) {
        this.hide(win.id);
      } else {
        this.drag = {
          kind: 'window',
          id: win.id,
          dx: this.pointerX - win.x,
          dy: this.pointerY - win.y,
        };
      }
      if (win.id === 'notes') this.setNotesFocused(false);
      return;
    }
    if (win.id === 'notes') {
      if (contains(NOTES.area, lx, ly)) {
        this.setNotesFocused(true);
        this.placeCaret(lx, ly);
      } else {
        this.setNotesFocused(false);
      }
    } else if (win.id === 'input') {
      for (let i = 0; i < INPUT.checkboxCount; i++) {
        // A 2px margin keeps the target honest while forgiving sub-pixel rounding.
        const cb = INPUT.checkbox(i);
        if (contains(rect(cb.x - 2, cb.y - 2, cb.w + 4, cb.h + 4), lx, ly)) {
          this.checks[i] = !this.checks[i];
          this.invalidateRow(ROW.targets);
          return;
        }
      }
      const area = INPUT.dragArea;
      const bx = area.x + this.boxX;
      const by = area.y + this.boxY;
      if (contains(rect(bx, by, INPUT.boxSize, INPUT.boxSize), lx, ly)) {
        this.drag = { kind: 'box', dx: lx - bx, dy: ly - by };
      }
    }
  }

  private continueDrag(): void {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'window') {
      const w = this.windows[d.id];
      w.x = this.pointerX - d.dx;
      w.y = this.pointerY - d.dy;
      this.clampWindow(w);
    } else {
      const win = this.windows.input;
      const area = INPUT.dragArea;
      const lx = this.pointerX - win.x - area.x - d.dx;
      const ly = this.pointerY - win.y - area.y - d.dy;
      const nx = Math.max(0, Math.min(area.w - INPUT.boxSize, lx));
      const ny = Math.max(0, Math.min(area.h - INPUT.boxSize, ly));
      if (nx !== this.boxX || ny !== this.boxY) {
        this.boxX = nx;
        this.boxY = ny;
        this.invalidate('input', area);
      }
    }
  }

  /** Whether a drag is in progress, and of what. */
  get dragging(): 'window' | 'box' | null {
    return this.drag?.kind ?? null;
  }

  private hitTest(x: number, y: number): Hit {
    if (this.menuOpen && contains(this.menuRect(), x, y)) {
      const i = Math.floor((y - this.menuY - MENU.pad) / MENU.itemH);
      return { kind: 'menu', item: i >= 0 && i < MENU_ITEMS.length ? i : null };
    }
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const win = this.windows[this.stack[i] as WindowId];
      if (win.visible && contains(rect(win.x, win.y, win.w, win.h), x, y)) {
        return { kind: 'window', win, lx: x - win.x, ly: y - win.y };
      }
    }
    if (y >= this.height - TASKBAR_H) {
      for (const [i, id] of TASKBAR_ORDER.entries()) {
        if (contains(this.taskbarButtonRect(i), x, y)) return { kind: 'taskbar', button: id };
      }
      return { kind: 'taskbar', button: null };
    }
    return { kind: 'desktop' };
  }

  private updateCursor(): void {
    let shape: CursorShape = 'arrow';
    if (this.drag?.kind === 'window') shape = 'move';
    else if (!this.menuOpen) {
      const hit = this.hitTest(this.pointerX, this.pointerY);
      if (hit.kind === 'window') {
        if (hit.ly < TITLE_H && !contains(closeButtonRect(hit.win), hit.lx, hit.ly)) shape = 'move';
        else if (hit.win.id === 'notes' && contains(NOTES.area, hit.lx, hit.ly)) shape = 'text';
      }
    }
    this.cursor = shape;
  }

  // ---- Windows, focus, menu ------------------------------------------------------------

  raise(id: WindowId): void {
    const i = this.stack.indexOf(id);
    if (i !== this.stack.length - 1) {
      this.stack.splice(i, 1);
      this.stack.push(id);
    }
    this.setFocus(id);
  }

  setFocus(id: WindowId | null): void {
    if (id !== 'notes') this.setNotesFocused(false);
    if (this.focused === id) return;
    const old = this.focused;
    this.focused = id;
    if (old) this.invalidate(old, rect(0, 0, this.windows[old].w, TITLE_H));
    if (id) this.invalidate(id, rect(0, 0, this.windows[id].w, TITLE_H));
    this.invalidate('desktop', this.taskbarRect());
  }

  private setNotesFocused(focused: boolean): void {
    if (this.notesFocused === focused) return;
    this.notesFocused = focused;
    this.invalidate('notes', NOTES.area);
  }

  hide(id: WindowId): void {
    const w = this.windows[id];
    if (!w.visible) return;
    w.visible = false;
    if (this.drag?.kind === 'window' && this.drag.id === id) this.drag = null;
    if (this.focused === id) this.setFocus(null);
    this.invalidate('desktop', this.taskbarRect());
  }

  show(id: WindowId): void {
    const w = this.windows[id];
    if (!w.visible) {
      w.visible = true;
      this.clampWindow(w);
    }
    this.raise(id);
    this.invalidate('desktop', this.taskbarRect());
  }

  private toggleFromTaskbar(id: WindowId): void {
    const w = this.windows[id];
    const onTop = this.stack[this.stack.length - 1] === id;
    if (w.visible && onTop && this.focused === id) this.hide(id);
    else this.show(id);
  }

  openMenu(x: number, y: number): void {
    this.menuX = Math.max(0, Math.min(this.width - MENU.w, x));
    this.menuY = Math.max(0, Math.min(this.height - TASKBAR_H - MENU_H, y));
    this.menuOpen = true;
    this.menuHover = null;
    this.updateMenuHover();
    this.invalidate('menu');
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.menuHover = null;
  }

  private updateMenuHover(): void {
    if (!this.menuOpen) return;
    const hit = this.hitTest(this.pointerX, this.pointerY);
    const hover = hit.kind === 'menu' ? hit.item : null;
    if (hover !== this.menuHover) {
      this.menuHover = hover;
      this.invalidate('menu');
    }
  }

  private runMenuItem(i: number): void {
    switch (MENU_ITEMS[i]) {
      case 'Arrange windows':
        this.arrange();
        break;
      case 'Show all windows':
        for (const id of ['about', 'notes', 'input'] as const) this.show(id);
        this.arrange();
        break;
      case 'Change wallpaper':
        this.wallpaper = (this.wallpaper + 1) % WALLPAPER_COUNT;
        this.invalidate('desktop');
        break;
      case 'Clear notes':
        this.notes.setText('');
        this.notesScroll = 0;
        this.invalidate('notes', NOTES.area);
        this.invalidate('notes', NOTES.status);
        break;
    }
  }

  private clampWindow(w: DemoWindow): void {
    const keep = 80;
    w.x = Math.round(Math.max(keep - w.w, Math.min(this.width - keep, w.x)));
    w.y = Math.round(Math.max(0, Math.min(this.height - TASKBAR_H - TITLE_H, w.y)));
  }

  // ---- Keyboard -----------------------------------------------------------------------

  /** Handles one `key,<keysym>,<pressed>` instruction. */
  key(keysym: number, pressed: boolean): void {
    if (!pressed) {
      if (this.held.delete(keysym)) this.invalidateRow(ROW.held);
      return;
    }
    this.held.add(keysym);
    const mods = heldModifiers(this.held);
    const isMod = modifierOf(keysym) !== undefined;
    this.lastKey = isMod ? mods.join('+') : [...mods, keysymName(keysym)].join('+');
    this.lastKeysym = keysym;
    this.invalidateRow(ROW.key);
    this.invalidateRow(ROW.held);
    if (!isMod) this.typeKey(keysym);
  }

  private get typingIntoNotes(): boolean {
    return this.notesFocused && this.focused === 'notes' && this.windows.notes.visible;
  }

  private typeKey(keysym: number): void {
    if (!this.typingIntoNotes) return;
    const mods = new Set(heldModifiers(this.held));
    // Ctrl+Alt is how AltGr arrives on some platforms, so it types rather than shortcuts.
    const ctrl = mods.has('Ctrl') && !mods.has('Alt') && !mods.has('AltGr');
    const shift = mods.has('Shift');
    const t = this.notes;

    if (ctrl) {
      switch (shortcutLetter(keysym)) {
        case 'a':
          t.selectAll();
          break;
        case 'c':
          this.copySelection();
          return;
        case 'x':
          if (this.copySelection()) t.deleteSelection();
          break;
        case 'v':
          if (this.clipboard) {
            const text = this.clipboard.replace(/\r\n?/g, '\n');
            t.insert(Array.from(text).slice(0, MAX_PASTE).join(''));
          }
          break;
        default:
          return;
      }
      this.textChanged();
      return;
    }

    switch (keysym) {
      case Keysym.Return:
      case Keysym.KP_Enter:
        t.insert('\n');
        break;
      case Keysym.BackSpace:
        t.backspace();
        break;
      case Keysym.Delete:
        t.deleteForward();
        break;
      case Keysym.Tab:
        t.insert('    ');
        break;
      case Keysym.Left:
        t.left(shift);
        break;
      case Keysym.Right:
        t.right(shift);
        break;
      case Keysym.Home:
      case Keysym.End: {
        const lines = this.notesLines();
        const line = lines[lineIndexOf(lines, t.caret)] as TextLine;
        t.moveTo(keysym === Keysym.Home ? line.start : line.end, shift);
        break;
      }
      case Keysym.Up:
      case Keysym.Down: {
        const lines = this.notesLines();
        const li = lineIndexOf(lines, t.caret);
        const target = lines[li + (keysym === Keysym.Up ? -1 : 1)];
        if (!target) {
          t.moveTo(keysym === Keysym.Up ? 0 : t.length, shift);
        } else {
          const cw = this.charWidth;
          const x = xOfIndex(t.codePoints, lines[li] as TextLine, t.caret, cw);
          t.moveTo(indexAtX(t.codePoints, target, x, cw), shift);
        }
        break;
      }
      default: {
        const ch = keysymToText(keysym);
        if (ch === null || mods.has('Meta') || mods.has('Super')) return;
        if (mods.has('Alt') && !mods.has('Ctrl')) return;
        t.insert(ch);
      }
    }
    this.textChanged();
  }

  private copySelection(): boolean {
    const text = this.notes.selectedText();
    if (!text) return false;
    this.clipboard = text;
    this.clipboardSource = 'notes';
    this.outgoingClipboard = text;
    this.invalidate('notes', NOTES.clip);
    return true;
  }

  private textChanged(): void {
    this.ensureCaretVisible();
    this.invalidate('notes', NOTES.area);
    this.invalidate('notes', NOTES.status);
  }

  /** Visible text lines in the Notes area. */
  get notesVisibleLines(): number {
    return Math.floor((NOTES.area.h - NOTES.pad * 2) / NOTES.lineH);
  }

  readonly charWidth = (c: string): number => {
    let w = this.charWidths.get(c);
    if (w === undefined) {
      w = this.measure(c, NOTES.font);
      this.charWidths.set(c, w);
    }
    return w;
  };

  notesLines(): TextLine[] {
    return layoutText(this.notes.codePoints, NOTES.area.w - NOTES.pad * 2, this.charWidth);
  }

  private ensureCaretVisible(): void {
    const lines = this.notesLines();
    const li = lineIndexOf(lines, this.notes.caret);
    const vis = this.notesVisibleLines;
    if (li < this.notesScroll) this.notesScroll = li;
    else if (li >= this.notesScroll + vis) this.notesScroll = li - vis + 1;
    this.notesScroll = Math.max(0, Math.min(this.notesScroll, Math.max(0, lines.length - vis)));
  }

  private placeCaret(lx: number, ly: number): void {
    const lines = this.notesLines();
    const row = Math.floor((ly - NOTES.area.y - NOTES.pad) / NOTES.lineH) + this.notesScroll;
    const line = lines[Math.max(0, Math.min(lines.length - 1, row))] as TextLine;
    const x = lx - NOTES.area.x - NOTES.pad;
    this.notes.moveTo(indexAtX(this.notes.codePoints, line, x, this.charWidth));
    this.invalidate('notes', NOTES.area);
    this.invalidate('notes', NOTES.status);
  }

  // ---- Scroll list --------------------------------------------------------------------

  get listMaxScroll(): number {
    return Math.max(0, INPUT.listItems * INPUT.listRowH - this.listViewport().h);
  }

  /** The scrolling part of the list (inside its border, left of the scrollbar). */
  listViewport(): Rect {
    const l = INPUT.list;
    return rect(l.x + 1, l.y + 1, l.w - 2 - INPUT.scrollbarW, l.h - 2);
  }

  scrollbarRect(): Rect {
    const l = INPUT.list;
    return rect(l.x + l.w - 1 - INPUT.scrollbarW, l.y + 1, INPUT.scrollbarW, l.h - 2);
  }

  private scrollList(delta: number): void {
    const next = Math.max(0, Math.min(this.listMaxScroll, this.listScroll + delta));
    const d = next - this.listScroll;
    if (d === 0) return;
    this.listScroll = next;
    this.pendingScroll += d;
  }

  // ---- Geometry helpers ----------------------------------------------------------------

  private invalidateRow(i: number): void {
    this.invalidate('input', INPUT.row(i));
  }

  private surfaceSize(id: SurfaceId): { w: number; h: number } {
    if (id === 'desktop') return { w: this.width, h: this.height };
    if (id === 'menu') return { w: MENU.w, h: MENU_H };
    return this.windows[id];
  }

  menuRect(): Rect {
    return rect(this.menuX, this.menuY, MENU.w, MENU_H);
  }

  taskbarRect(): Rect {
    return rect(0, this.height - TASKBAR_H, this.width, TASKBAR_H);
  }

  taskbarButtonRect(i: number): Rect {
    return rect(96 + i * 124, this.height - TASKBAR_H + 5, 116, TASKBAR_H - 10);
  }

  clockRect(): Rect {
    return rect(this.width - 100, this.height - TASKBAR_H, 100, TASKBAR_H);
  }

  ellipsize(text: string, maxWidth: number, font: FontSpec): string {
    if (this.measure(text, font) <= maxWidth) return text;
    const cps = Array.from(text);
    let lo = 0;
    let hi = cps.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.measure(cps.slice(0, mid).join('') + '…', font) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return cps.slice(0, lo).join('') + '…';
  }
}

export const TASKBAR_ORDER: readonly WindowId[] = ['notes', 'input', 'about'];

export function closeButtonRect(w: { readonly w: number }): Rect {
  return rect(w.w - 24, 6, 16, 16);
}
