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
  /** Title on a narrow taskbar. */
  readonly shortTitle: string;
  x: number;
  y: number;
  /** Size follows the desktop size (see `desktopLayout`). */
  w: number;
  h: number;
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

// ---- Window layouts (window-local coordinates) ------------------------------------------
//
// Each window has a wide layout (its classic size) and narrower or shorter variants, so on a
// phone-sized desktop (for example 375 × 812) every window fits on screen and stays usable.
// The layouts are recomputed whenever the desktop size changes; painting and hit-testing
// read the same objects from `DemoDesktop.layout`. A landscape phone (for example 812 × 375)
// gets two columns (see `Arrangement`).

/** Margin around windows when they are arranged. */
const MARGIN = 16;

const HINT_WIDE = [
  'Click the text area and type. Ctrl+A select all, C copy, X cut, V paste.',
] as const;
const HINT_COMPACT = [
  'Click the text area and type.',
  'Ctrl+A select all, C copy, X cut, V paste.',
] as const;

export interface NotesLayout {
  readonly w: number;
  readonly h: number;
  /** Lines of the hint above the text area. */
  readonly hintLines: readonly string[];
  readonly hint: Rect;
  readonly area: Rect;
  readonly clip: Rect;
  readonly status: Rect;
  readonly pad: number;
  readonly lineH: number;
  readonly font: FontSpec;
  /** Shorter wording on the clipboard line, for narrow windows. */
  readonly compact: boolean;
}

/** Notes at width `w`, with the text area shortened (to 120 px at least) to fit `maxH`. */
export function notesLayout(w: number, maxH = Infinity): NotesLayout {
  const inner = w - 24;
  const hintLines = inner >= 496 ? HINT_WIDE : HINT_COMPACT;
  const hint = rect(12, TITLE_H + 6, inner, hintLines.length * 14 + 6);
  const areaY = hint.y + hint.h + 4;
  // Below the area: 6 gap + clipboard line 20 + 4 gap + status line 20 + 14 bottom.
  const below = 64;
  const areaH = Math.max(120, Math.min(270, Math.floor(maxH - areaY - below)));
  const area = rect(12, areaY, inner, areaH);
  const clip = rect(12, areaY + areaH + 6, inner, 20);
  const status = rect(12, clip.y + 24, inner, 20);
  return {
    w,
    h: status.y + status.h + 14,
    hintLines,
    hint,
    area,
    clip,
    status,
    pad: 6,
    lineH: 18,
    font: { size: 13, mono: true },
    compact: inner < 400,
  };
}

const ROWS_TOP = TITLE_H + 8;
const ROW_H = 20;
const INPUT_WIDE_W = 560;
/** Below this, stacked Input panels get too short and go side by side instead. */
const MIN_STACKED_PANEL_H = 64;

/** Input test rows, by index into `InputLayout.row`. */
export const ROW = {
  pointer: 0,
  buttons: 1,
  click: 2,
  wheel: 3,
  key: 4,
  held: 5,
  targets: 6,
} as const;

export interface InputLayout {
  readonly w: number;
  readonly h: number;
  readonly valueX: number;
  readonly rowsTop: number;
  readonly rowH: number;
  row(i: number): Rect;
  pill(i: number): Rect;
  checkbox(i: number): Rect;
  readonly checkboxCount: number;
  /** Where the "n of 8 checked" caption goes: its x and the row it sits on. */
  readonly checkedCaption: { readonly x: number; readonly row: number };
  /** Centre lines of the captions above the drag area and the list. */
  readonly dragCaptionY: number;
  readonly listCaption: { readonly x: number; readonly y: number };
  readonly dragArea: Rect;
  readonly boxSize: number;
  readonly list: Rect;
  readonly listRowH: number;
  readonly listItems: number;
  readonly scrollbarW: number;
}

/**
 * The Input test window at width `w`. At its full 560 px the drag area and list sit side by
 * side; narrower, they are stacked. Their height shrinks (to 100 px, or 80 px each when
 * stacked) to fit `maxH`; when stacked panels would drop below 64 px each (a short window),
 * the narrow layout puts them side by side too.
 */
export function inputLayout(w: number, maxH = Infinity): InputLayout {
  const wide = w >= INPUT_WIDE_W;
  const valueX = wide ? 120 : 108;
  const pillStep = wide ? 70 : 60;
  const boxStep = wide ? 26 : 22;
  const checkboxCount = 8;
  const common = {
    w,
    valueX,
    rowsTop: ROWS_TOP,
    rowH: ROW_H,
    row: (i: number): Rect => rect(0, ROWS_TOP + i * ROW_H, w, ROW_H),
    pill: (i: number): Rect => rect(valueX + i * pillStep, ROWS_TOP + ROW_H + 2, pillStep - 8, 16),
    checkbox: (i: number): Rect => rect(valueX + i * boxStep, ROWS_TOP + 6 * ROW_H + 4, 12, 12),
    checkboxCount,
    boxSize: 44,
    listRowH: 20,
    listItems: 60,
    scrollbarW: 8,
  };
  if (wide) {
    const top = 200;
    const panelH = Math.max(100, Math.min(200, Math.floor(maxH - top - 16)));
    return {
      ...common,
      h: top + panelH + 16,
      checkedCaption: { x: valueX + checkboxCount * boxStep + 6, row: ROW.targets },
      dragCaptionY: ROWS_TOP + 7 * ROW_H + 13,
      listCaption: { x: 330, y: ROWS_TOP + 7 * ROW_H + 13 },
      dragArea: rect(14, top, 300, panelH),
      list: rect(330, top, 216, panelH),
    };
  }
  // Narrow: the checked caption gets its own row, then the drag area and the list.
  const dragTop = ROWS_TOP + 8 * ROW_H + 24;
  const gap = 26;
  const stackedH = Math.floor((maxH - dragTop - gap - 14) / 2);
  if (stackedH < MIN_STACKED_PANEL_H) {
    // Short (a landscape phone column): the drag area and the list side by side.
    const panelW = Math.floor((w - 28 - 16) / 2);
    const sideH = Math.max(64, Math.min(200, Math.floor(maxH - dragTop - 14)));
    const listX = 14 + panelW + 16;
    return {
      ...common,
      h: dragTop + sideH + 14,
      checkedCaption: { x: valueX, row: ROW.targets + 1 },
      dragCaptionY: dragTop - 11,
      listCaption: { x: listX, y: dragTop - 11 },
      dragArea: rect(14, dragTop, panelW, sideH),
      list: rect(listX, dragTop, w - 14 - listX, sideH),
    };
  }
  // Stacked: the drag area above the list.
  const panelH = Math.max(80, Math.min(200, stackedH));
  const listTop = dragTop + panelH + gap;
  return {
    ...common,
    h: listTop + panelH + 14,
    checkedCaption: { x: valueX, row: ROW.targets + 1 },
    dragCaptionY: dragTop - 11,
    listCaption: { x: 14, y: listTop - 11 },
    dragArea: rect(14, dragTop, w - 28, panelH),
    list: rect(14, listTop, w - 28, panelH),
  };
}

const ABOUT_WIDE = [
  'This desktop is simulated inside the app. Nothing you',
  'do here leaves your device, and it holds no real data.',
  'It speaks the Guacamole protocol, so the session',
  'controls can be tried without a server.',
  'Right-click the wallpaper for a menu.',
] as const;
const ABOUT_COMPACT = [
  'This desktop is simulated inside the',
  'app. Nothing you do here leaves your',
  'device, and it holds no real data. It',
  'speaks the Guacamole protocol, so the',
  'session controls can be tried without',
  'a server. Right-click the wallpaper',
  'for a menu.',
] as const;

export interface AboutLayout {
  readonly w: number;
  readonly h: number;
  readonly lines: readonly string[];
  /** Sample text after the "9 px: " size prefix. */
  readonly sample: string;
  /** The fine-detail target. */
  readonly target: Rect;
}

/** The About window at width `w`: the detail target moves below the text when narrow. */
export function aboutLayout(w: number): AboutLayout {
  if (w >= 520) {
    return {
      w,
      h: 236,
      lines: ABOUT_WIDE,
      sample: 'The quick brown fox jumps over the lazy dog 0123456789',
      target: rect(w - 148, TITLE_H + 14, 132, 132),
    };
  }
  // Heading (20 + 22), the lines at 17 px, a 6 px gap, then the 9, 8 and 7 px samples.
  const textEnd = TITLE_H + 20 + 22 + ABOUT_COMPACT.length * 17 + 6 + 15 + 14 + 13;
  const target = rect(14, textEnd, 132, 132);
  return {
    w,
    h: target.y + target.h + 26,
    lines: ABOUT_COMPACT,
    sample: 'The quick brown fox jumps over the lazy dog',
    target,
  };
}

/** Wide layouts, for reference and tests. */
export const NOTES = notesLayout(520);
export const INPUT = inputLayout(INPUT_WIDE_W);
export const ABOUT = aboutLayout(520);

/**
 * How `arrange` places the windows:
 * - `cascade`: full-width windows cascading down, Notes on top (a phone in portrait).
 * - `row`: Notes and Input side by side at their classic sizes, About below (wide screens).
 * - `stack`: the three windows one above the other (tall, medium-width screens).
 * - `columns`: Notes and Input in two equal columns, shortened to fit; About below Notes
 *   when there is room, otherwise closed to the taskbar (landscape phones, small tablets).
 */
export type Arrangement = 'cascade' | 'row' | 'stack' | 'columns';

export interface DesktopLayout {
  readonly notes: NotesLayout;
  readonly input: InputLayout;
  readonly about: AboutLayout;
  readonly arrangement: Arrangement;
  /** Top of the arranged windows. */
  readonly top: number;
  /** `columns` only: whether About has a place below Notes (else it starts closed). */
  readonly aboutFits: boolean;
  /** Narrow taskbar: no "Demo" label, short button titles, a narrower clock. */
  readonly compactTaskbar: boolean;
}

/**
 * The taskbar runs along the top of the desktop, so the app's own session toolbar (docked
 * at the bottom of the screen) does not cover it.
 */
const WORK_TOP = TASKBAR_H;
/** Top of the arranged windows, below the wallpaper heading. */
const ARRANGE_TOP = WORK_TOP + 56;
/** Top of the arranged windows when the desktop is too short to keep the heading clear. */
const ARRANGE_TOP_SHORT = WORK_TOP + 8;
/** Gap kept below arranged windows. */
const BOTTOM_GAP = 8;
/** Vertical step between cascaded windows on a narrow desktop: one title bar and a gap. */
const CASCADE_DY = TITLE_H + 4;
/** Narrowest column for the `columns` arrangement (Input's rows need 288 px). */
const MIN_COLUMN_W = 288;

/** Whether windows are arranged as a full-width cascade (a phone in portrait). */
export function isNarrowDesktop(width: number): boolean {
  return width < INPUT_WIDE_W + 2 * MARGIN;
}

/** Window layouts for a desktop of `width` × `height` pixels. */
export function desktopLayout(width: number, height: number): DesktopLayout {
  const avail = width - 2 * MARGIN;
  const compactTaskbar = width < 96 + 3 * 124 + 108;
  const cascade = (): DesktopLayout => {
    // Every window must fit even in the lowest of the three cascade slots.
    const maxH = height - BOTTOM_GAP / 2 - (ARRANGE_TOP + 2 * CASCADE_DY);
    return {
      notes: notesLayout(avail, maxH),
      input: inputLayout(avail, maxH),
      about: aboutLayout(avail),
      arrangement: 'cascade',
      top: ARRANGE_TOP,
      aboutFits: true,
      compactTaskbar,
    };
  };
  if (isNarrowDesktop(width)) return cascade();

  // Classic sizes.
  const maxH = height - WORK_TOP - BOTTOM_GAP;
  const notes = notesLayout(Math.min(NOTES.w, avail), maxH);
  const input = inputLayout(Math.min(INPUT_WIDE_W, avail), maxH);
  const about = aboutLayout(Math.min(ABOUT.w, avail));
  const classic = { notes, input, about, top: ARRANGE_TOP, aboutFits: true, compactTaskbar };
  if (width >= notes.w + input.w + 3 * MARGIN) return { ...classic, arrangement: 'row' };
  const stackH = notes.h + input.h + about.h + 2 * MARGIN;
  if (ARRANGE_TOP + stackH <= height - BOTTOM_GAP) return { ...classic, arrangement: 'stack' };

  // Short for its width (a landscape phone) or a small tablet: two columns.
  const colW = Math.floor((width - 3 * MARGIN) / 2);
  if (colW < MIN_COLUMN_W) return cascade();
  const colMaxH = height - ARRANGE_TOP_SHORT - BOTTOM_GAP;
  const colInput = inputLayout(Math.min(INPUT_WIDE_W, colW), colMaxH);
  let colNotes = notesLayout(Math.min(NOTES.w, colW), colMaxH);
  let colAbout = aboutLayout(Math.min(ABOUT.w, colW));
  const tallest = Math.max(colNotes.h, colInput.h);
  const top = ARRANGE_TOP + tallest <= height - BOTTOM_GAP ? ARRANGE_TOP : ARRANGE_TOP_SHORT;
  // About goes below Notes if Notes can shrink enough to make room for it.
  const notesRoom = height - BOTTOM_GAP - top - colAbout.h - MARGIN;
  const shortNotes = notesLayout(Math.min(NOTES.w, colW), notesRoom);
  const aboutFits = shortNotes.h <= notesRoom;
  if (aboutFits) colNotes = shortNotes;
  // Otherwise About starts closed and opens over the columns, so it can use the wide (and
  // much shorter) layout.
  else colAbout = aboutLayout(Math.min(ABOUT.w, avail));
  return {
    notes: colNotes,
    input: colInput,
    about: colAbout,
    arrangement: 'columns',
    top,
    aboutFits,
    compactTaskbar,
  };
}

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

const INITIAL_NOTES =
  'Welcome to the demo desktop.\n' +
  'Everything here runs inside the app; nothing is sent anywhere.\n' +
  '\n' +
  'Try typing, Unicode (café, 日本語, 🙂), Enter and Backspace.\n';

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
  /** Window layouts for the current size (see `desktopLayout`). */
  layout: DesktopLayout;
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

  /** About was closed by `arrange` for lack of room (see `Arrangement`). */
  private aboutParked = false;
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
    this.layout = desktopLayout(width, height);
    const win = (id: WindowId, title: string, shortTitle: string): DemoWindow => ({
      id,
      title,
      shortTitle,
      x: 0,
      y: 0,
      w: this.layout[id].w,
      h: this.layout[id].h,
      visible: true,
    });
    this.windows = {
      notes: win('notes', 'Notes', 'Notes'),
      input: win('input', 'Input test', 'Input'),
      about: win('about', 'About this demo', 'About'),
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
    this.layout = desktopLayout(this.width, this.height);
    for (const id of ['notes', 'input', 'about'] as const) {
      const w = this.windows[id];
      w.w = this.layout[id].w;
      w.h = this.layout[id].h;
    }
    // Keep content positions valid for the new window sizes.
    const { dragArea, boxSize } = this.layout.input;
    this.boxX = Math.max(0, Math.min(dragArea.w - boxSize, this.boxX));
    this.boxY = Math.max(0, Math.min(dragArea.h - boxSize, this.boxY));
    this.listScroll = Math.min(this.listScroll, this.listMaxScroll);
    if (this.pendingScroll !== 0) {
      // A scroll not yet sent: repaint the list rather than copying within a resized window.
      this.pendingScroll = 0;
      this.invalidate('input', this.listViewport());
      this.invalidate('input', this.scrollbarRect());
    }
    this.ensureCaretVisible();
    this.arrange();
    this.invalidate('desktop');
  }

  /** Places the windows in their default layout for the current size. */
  arrange(): void {
    const m = MARGIN;
    const { arrangement, top, aboutFits } = this.layout;
    const bottom = this.height;
    const { notes, input, about } = this.windows;
    // About is closed when the `columns` arrangement has no room for it, and comes back by
    // itself once a later arrangement has room (unless the user opened it in between).
    const parkAbout = arrangement === 'columns' && !aboutFits;
    if (parkAbout && about.visible) {
      this.hide('about');
      this.aboutParked = true;
    } else if (!parkAbout && this.aboutParked) {
      // Reopen without raising it, so focus stays where it was.
      this.aboutParked = false;
      about.visible = true;
      this.invalidate('desktop', this.taskbarRect());
    }
    switch (arrangement) {
      case 'cascade':
        // A phone in portrait: full-width windows cascade straight down, Notes on top and
        // lowest, so every title bar shows and each window fits on screen when raised.
        // (`desktopLayout` sizes them for this; only very short desktops need the clamp.)
        for (const [i, w] of [about, input, notes].entries()) {
          w.x = m;
          w.y = Math.max(WORK_TOP, Math.min(top + i * CASCADE_DY, bottom - w.h - 4));
        }
        this.stack.splice(0, this.stack.length, 'about', 'input', 'notes');
        break;
      case 'row':
        notes.x = m;
        notes.y = top;
        input.x = Math.min(notes.x + notes.w + m * 2, this.width - input.w - m);
        input.y = top;
        about.x = m;
        about.y = notes.y + notes.h + m;
        if (about.y + about.h > bottom - BOTTOM_GAP) {
          about.x = input.x;
          about.y = Math.max(top, bottom - about.h - m);
        }
        break;
      case 'stack': {
        let y = top;
        for (const w of [notes, input, about]) {
          w.x = m;
          w.y = y;
          y += w.h + m;
        }
        break;
      }
      case 'columns':
        // Notes left, Input right, About below Notes (or, when closed, ready to open over
        // the Input column). Nothing overlaps.
        notes.x = m;
        notes.y = top;
        input.x = this.width - input.w - m;
        input.y = top;
        about.x = aboutFits ? m : this.width - about.w - m;
        about.y = aboutFits ? notes.y + notes.h + m : top;
        break;
    }
    for (const w of [notes, input, about]) this.clampWindow(w);
  }

  /** Text received from the client's clipboard stream. */
  receiveClipboard(text: string): void {
    this.clipboard = text;
    this.clipboardSource = 'client';
    this.invalidate('notes', this.layout.notes.clip);
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
      const L = this.layout.input;
      if (hit.kind === 'window' && hit.win.id === 'input' && contains(L.list, hit.lx, hit.ly)) {
        this.scrollList(bit === Button.UP ? -2 * L.listRowH : 2 * L.listRowH);
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
      if (contains(this.layout.notes.area, lx, ly)) {
        this.setNotesFocused(true);
        this.placeCaret(lx, ly);
      } else {
        this.setNotesFocused(false);
      }
    } else if (win.id === 'input') {
      const L = this.layout.input;
      for (let i = 0; i < L.checkboxCount; i++) {
        // A 2px margin keeps the target honest while forgiving sub-pixel rounding.
        const cb = L.checkbox(i);
        if (contains(rect(cb.x - 2, cb.y - 2, cb.w + 4, cb.h + 4), lx, ly)) {
          this.checks[i] = !this.checks[i];
          this.invalidateRow(ROW.targets);
          this.invalidateRow(L.checkedCaption.row);
          return;
        }
      }
      const area = L.dragArea;
      const bx = area.x + this.boxX;
      const by = area.y + this.boxY;
      if (contains(rect(bx, by, L.boxSize, L.boxSize), lx, ly)) {
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
      const { dragArea: area, boxSize } = this.layout.input;
      const lx = this.pointerX - win.x - area.x - d.dx;
      const ly = this.pointerY - win.y - area.y - d.dy;
      const nx = Math.max(0, Math.min(area.w - boxSize, lx));
      const ny = Math.max(0, Math.min(area.h - boxSize, ly));
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
    if (y < TASKBAR_H) {
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
        else if (hit.win.id === 'notes' && contains(this.layout.notes.area, hit.lx, hit.ly)) {
          shape = 'text';
        }
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
    this.invalidate('notes', this.layout.notes.area);
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
    if (id === 'about') this.aboutParked = false;
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
    this.menuY = Math.max(WORK_TOP, Math.min(this.height - MENU_H, y));
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
        // Arrange first: in the `columns` arrangement it may close About, which the user
        // has just asked to see.
        this.arrange();
        for (const id of ['about', 'notes', 'input'] as const) this.show(id);
        break;
      case 'Change wallpaper':
        this.wallpaper = (this.wallpaper + 1) % WALLPAPER_COUNT;
        this.invalidate('desktop');
        break;
      case 'Clear notes':
        this.notes.setText('');
        this.notesScroll = 0;
        this.invalidate('notes', this.layout.notes.area);
        this.invalidate('notes', this.layout.notes.status);
        break;
    }
  }

  private clampWindow(w: DemoWindow): void {
    const keep = 80;
    w.x = Math.round(Math.max(keep - w.w, Math.min(this.width - keep, w.x)));
    w.y = Math.round(Math.max(WORK_TOP, Math.min(this.height - TITLE_H, w.y)));
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
    this.invalidate('notes', this.layout.notes.clip);
    return true;
  }

  private textChanged(): void {
    this.ensureCaretVisible();
    this.invalidate('notes', this.layout.notes.area);
    this.invalidate('notes', this.layout.notes.status);
  }

  /** Visible text lines in the Notes area. */
  get notesVisibleLines(): number {
    const L = this.layout.notes;
    return Math.floor((L.area.h - L.pad * 2) / L.lineH);
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
    const L = this.layout.notes;
    return layoutText(this.notes.codePoints, L.area.w - L.pad * 2, this.charWidth);
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
    const L = this.layout.notes;
    const lines = this.notesLines();
    const row = Math.floor((ly - L.area.y - L.pad) / L.lineH) + this.notesScroll;
    const line = lines[Math.max(0, Math.min(lines.length - 1, row))] as TextLine;
    const x = lx - L.area.x - L.pad;
    this.notes.moveTo(indexAtX(this.notes.codePoints, line, x, this.charWidth));
    this.invalidate('notes', L.area);
    this.invalidate('notes', L.status);
  }

  // ---- Scroll list --------------------------------------------------------------------

  get listMaxScroll(): number {
    const L = this.layout.input;
    return Math.max(0, L.listItems * L.listRowH - this.listViewport().h);
  }

  /** The scrolling part of the list (inside its border, left of the scrollbar). */
  listViewport(): Rect {
    const { list: l, scrollbarW } = this.layout.input;
    return rect(l.x + 1, l.y + 1, l.w - 2 - scrollbarW, l.h - 2);
  }

  scrollbarRect(): Rect {
    const { list: l, scrollbarW } = this.layout.input;
    return rect(l.x + l.w - 1 - scrollbarW, l.y + 1, scrollbarW, l.h - 2);
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
    this.invalidate('input', this.layout.input.row(i));
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
    return rect(0, 0, this.width, TASKBAR_H);
  }

  taskbarButtonRect(i: number): Rect {
    const y = 5;
    if (!this.layout.compactTaskbar) return rect(96 + i * 124, y, 116, TASKBAR_H - 10);
    // Narrow: buttons share the space between the logo and the clock. They start right of
    // where the app's "Demo" badge sits (top-left of the session screen), so it does not
    // cover the first button.
    const left = 72;
    const step = Math.floor((this.width - left - this.clockRect().w) / TASKBAR_ORDER.length);
    return rect(left + i * step, y, step - 6, TASKBAR_H - 10);
  }

  clockRect(): Rect {
    const w = this.layout.compactTaskbar ? 80 : 100;
    return rect(this.width - w, 0, w, TASKBAR_H);
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
