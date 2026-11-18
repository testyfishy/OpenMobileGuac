/**
 * Paints each demo surface through the `Painter` interface. Everything here is original
 * and deliberately generic: a flat, neutral look that does not resemble any real product.
 */
import type { DemoDesktop, DemoWindow, SurfaceId } from './desktop.ts';
import {
  MENU,
  MENU_ITEMS,
  ROW,
  TASKBAR_H,
  TASKBAR_ORDER,
  TITLE_H,
  closeButtonRect,
  type AboutLayout,
} from './desktop.ts';
import { keysymName } from './keysyms.ts';
import type { FontSpec, Painter } from './painter.ts';
import { lineIndexOf, xOfIndex } from './textModel.ts';

export const COLORS = {
  windowBg: '#f6f7f9',
  border: '#8e99a8',
  borderFocused: '#2b5c8f',
  titleFocused: '#2b5c8f',
  title: '#d5dbe3',
  text: '#1c222b',
  muted: '#5a6472',
  accent: '#2f6fd0',
  field: '#ffffff',
  fieldBorder: '#a7b0bd',
  selection: '#cfe0fb',
  pill: '#e4e8ee',
  box: '#e07a3f',
  boxActive: '#c95e22',
  taskbar: '#161a21',
  taskbarText: '#e8ecf2',
  taskbarMuted: '#8a93a3',
  mint: '#5cc8b0',
} as const;

/** Colour layer 0 is filled with (via `rect` + `cfill`) before its tiles arrive. */
export const DESKTOP_BASE_RGB: readonly [number, number, number] = [0x1f, 0x4a, 0x5e];
export const WINDOW_BASE_RGB: readonly [number, number, number] = [0xf6, 0xf7, 0xf9];

const UI: FontSpec = { size: 12 };
const UI_BOLD: FontSpec = { size: 12, bold: true };
const SMALL: FontSpec = { size: 11 };

interface Wallpaper {
  readonly stops: readonly (readonly [number, string])[];
  readonly angle: number;
}

const WALLPAPERS: readonly Wallpaper[] = [
  {
    stops: [
      [0, '#16324a'],
      [0.55, '#24697a'],
      [1, '#8cc4ad'],
    ],
    angle: 35,
  },
  {
    stops: [
      [0, '#2c2142'],
      [0.5, '#6b3f66'],
      [1, '#d6987a'],
    ],
    angle: 120,
  },
  {
    stops: [
      [0, '#1b2a24'],
      [0.5, '#355f48'],
      [1, '#b5c784'],
    ],
    angle: 70,
  },
];

export function paintSurface(d: DemoDesktop, id: SurfaceId, p: Painter): void {
  switch (id) {
    case 'desktop':
      return paintDesktop(d, p);
    case 'menu':
      return paintMenu(d, p);
    case 'notes':
      paintFrame(d, d.windows.notes, p);
      return paintNotes(d, p);
    case 'input':
      paintFrame(d, d.windows.input, p);
      return paintInput(d, p);
    case 'about':
      paintFrame(d, d.windows.about, p);
      return paintAbout(d.layout.about, p);
  }
}

function paintDesktop(d: DemoDesktop, p: Painter): void {
  const { width: W, height: H } = d;
  const wp = WALLPAPERS[d.wallpaper % WALLPAPERS.length] as Wallpaper;
  p.fillGradient(0, 0, W, H, wp.stops, wp.angle);
  const m = Math.min(W, H);
  p.fillCircle(
    Math.round(W * 0.8),
    Math.round(H * 0.3),
    Math.round(m * 0.24),
    'rgba(255,255,255,0.07)',
  );
  p.fillCircle(Math.round(W * 0.12), Math.round(H * 0.9), Math.round(m * 0.34), 'rgba(0,0,0,0.08)');
  p.fillCircle(
    Math.round(W * 0.55),
    Math.round(H * 0.75),
    Math.round(m * 0.1),
    'rgba(255,255,255,0.05)',
  );

  // Heading below the taskbar (both are on layer 0).
  p.text('OpenMobileGuac demo desktop', 18, TASKBAR_H + 22, { size: 14, bold: true }, '#ffffff');
  p.text(
    'Simulated on this device · no network · no personal data',
    18,
    TASKBAR_H + 40,
    SMALL,
    'rgba(255,255,255,0.82)',
  );

  // Taskbar, along the top so the app's bottom session toolbar does not cover it.
  const cy = TASKBAR_H / 2;
  p.fillRect(0, 0, W, TASKBAR_H, COLORS.taskbar);
  p.fillRect(0, TASKBAR_H - 1, W, 1, '#2a303b');
  const compact = d.layout.compactTaskbar;
  p.fillCircle(22, cy, 9, COLORS.mint);
  p.fillCircle(22, cy, 4, COLORS.taskbar);
  if (!compact) p.text('Demo', 38, cy, { size: 13, bold: true }, COLORS.taskbarText);
  for (const [i, id] of TASKBAR_ORDER.entries()) {
    const r = d.taskbarButtonRect(i);
    const w = d.windows[id];
    const active = w.visible && d.focused === id;
    if (w.visible) p.fillRect(r.x, r.y, r.w, r.h, active ? '#3a4352' : '#262c36');
    if (active) p.fillRect(r.x + 8, r.y + r.h - 2, r.w - 16, 2, COLORS.mint);
    p.text(
      d.ellipsize(compact ? w.shortTitle : w.title, r.w - 8, UI),
      r.x + r.w / 2,
      r.y + r.h / 2,
      UI,
      w.visible ? COLORS.taskbarText : COLORS.taskbarMuted,
      'center',
    );
  }
  p.text(d.clockText, W - 14, cy, { size: 13 }, COLORS.taskbarText, 'right');
}

function paintFrame(d: DemoDesktop, w: DemoWindow, p: Painter): void {
  const focused = d.focused === w.id;
  p.fillRect(0, 0, w.w, w.h, COLORS.windowBg);
  p.fillRect(0, 0, w.w, TITLE_H, focused ? COLORS.titleFocused : COLORS.title);
  p.strokeRect(0, 0, w.w, w.h, focused ? COLORS.borderFocused : COLORS.border);
  p.fillRect(0, TITLE_H, w.w, 1, focused ? COLORS.borderFocused : COLORS.border);
  const fg = focused ? '#ffffff' : '#303845';
  p.fillRect(12, TITLE_H / 2 - 4, 8, 8, focused ? COLORS.mint : '#8e99a8');
  p.text(w.title, 28, TITLE_H / 2, { size: 13, bold: true }, fg);
  const c = closeButtonRect(w);
  p.strokeRect(c.x, c.y, c.w, c.h, focused ? 'rgba(255,255,255,0.6)' : '#9aa4b2');
  p.line(c.x + 4, c.y + 4, c.x + c.w - 4, c.y + c.h - 4, fg, 1.5);
  p.line(c.x + c.w - 4, c.y + 4, c.x + 4, c.y + c.h - 4, fg, 1.5);
}

function paintNotes(d: DemoDesktop, p: Painter): void {
  const L = d.layout.notes;
  const { hint, area, clip, status, pad, lineH, font } = L;
  for (const [i, line] of L.hintLines.entries()) {
    p.text(line, hint.x, hint.y + 10 + i * 14, SMALL, COLORS.muted);
  }

  const focused = d.notesFocused && d.focused === 'notes';
  p.fillRect(area.x, area.y, area.w, area.h, COLORS.field);
  if (focused) p.strokeRect(area.x, area.y, area.w, area.h, COLORS.accent, 2);
  else p.strokeRect(area.x, area.y, area.w, area.h, COLORS.fieldBorder);

  const t = d.notes;
  const cps = t.codePoints;
  const lines = d.notesLines();
  const [selStart, selEnd] = t.selection();
  const cw = d.charWidth;
  p.save();
  p.clip(area.x + 2, area.y + 2, area.w - 4, area.h - 4);
  const x0 = area.x + pad;
  const visible = d.notesVisibleLines;
  for (let row = 0; row < visible; row++) {
    const li = d.notesScroll + row;
    const line = lines[li];
    if (!line) break;
    const y = area.y + pad + row * lineH;
    if (selEnd > line.start && selStart < line.end + 1 && selStart !== selEnd) {
      const a = Math.max(selStart, line.start);
      const b = Math.min(selEnd, line.end);
      const xa = xOfIndex(cps, line, a, cw);
      const xb = xOfIndex(cps, line, b, cw) + (selEnd > line.end && li < lines.length - 1 ? 6 : 0);
      p.fillRect(x0 + xa, y, Math.max(1, xb - xa), lineH, focused ? COLORS.selection : '#e2e6ec');
    }
    p.text(cps.slice(line.start, line.end).join(''), x0, y + lineH / 2, font, COLORS.text);
  }
  if (focused) {
    const li = lineIndexOf(lines, t.caret);
    const row = li - d.notesScroll;
    const line = lines[li];
    if (line && row >= 0 && row < visible) {
      const x = x0 + Math.round(xOfIndex(cps, line, t.caret, cw));
      p.fillRect(x, area.y + pad + row * lineH + 2, 1, lineH - 4, COLORS.text);
    }
  }
  p.restore();

  // Clipboard line
  const cyClip = clip.y + clip.h / 2;
  p.text('Clipboard:', clip.x, cyClip, UI_BOLD, COLORS.text);
  const source =
    d.clipboardSource === 'client'
      ? L.compact
        ? 'from your device'
        : 'received from your device'
      : d.clipboardSource === 'notes'
        ? L.compact
          ? 'sent to your device'
          : 'copied here, sent to your device'
        : 'empty';
  const sourceW = d.measure(source, SMALL);
  p.text(source, clip.x + clip.w, cyClip, SMALL, COLORS.muted, 'right');
  if (d.clipboard) {
    // Only the start can fit on the line; don't measure a huge paste on every repaint.
    const head = Array.from(d.clipboard.slice(0, 400)).slice(0, 200).join('');
    const shown = head.replace(/\r\n?|\n/g, ' ⏎ ').replace(/\t/g, ' ');
    const maxW = clip.w - 76 - sourceW - 12;
    p.text(d.ellipsize(shown, maxW, UI), clip.x + 72, cyClip, UI, COLORS.accent);
  }

  // Status line
  const li = lineIndexOf(lines, t.caret);
  const line = lines[li];
  const col = line ? t.caret - line.start : 0;
  let s = `${t.length} characters · line ${li + 1}, column ${col + 1}`;
  if (t.hasSelection()) s += ` · ${selEnd - selStart} selected`;
  if (!focused) s += ' · click the text area to type';
  p.text(d.ellipsize(s, status.w, SMALL), status.x, status.y + status.h / 2, SMALL, COLORS.muted);
}

function paintInput(d: DemoDesktop, p: Painter): void {
  const INPUT = d.layout.input;
  const label = (i: number, text: string) => {
    const r = INPUT.row(i);
    p.text(text, 14, r.y + r.h / 2, UI_BOLD, COLORS.text);
  };
  const value = (i: number, text: string, color: string = COLORS.text) => {
    const r = INPUT.row(i);
    const maxW = INPUT.w - INPUT.valueX - 10;
    p.text(d.ellipsize(text, maxW, UI), INPUT.valueX, r.y + r.h / 2, UI, color);
  };

  label(ROW.pointer, 'Pointer');
  value(ROW.pointer, `x ${d.pointerX}, y ${d.pointerY}     (desktop ${d.width} × ${d.height})`);

  label(ROW.buttons, 'Buttons down');
  for (const [i, [name, bit]] of (
    [
      ['Left', 1],
      ['Middle', 2],
      ['Right', 4],
    ] as const
  ).entries()) {
    const r = INPUT.pill(i);
    const down = (d.mask & bit) !== 0;
    p.fillRect(r.x, r.y, r.w, r.h, down ? COLORS.accent : COLORS.pill);
    p.text(name, r.x + r.w / 2, r.y + r.h / 2, SMALL, down ? '#ffffff' : COLORS.muted, 'center');
  }

  label(ROW.click, 'Last click');
  value(
    ROW.click,
    d.lastClick ? `${d.lastClick}     (${d.clicks} presses in total)` : 'none yet',
    d.lastClick ? COLORS.text : COLORS.muted,
  );

  label(ROW.wheel, 'Wheel');
  value(ROW.wheel, `up ${d.wheelUp} · down ${d.wheelDown} notches`);

  label(ROW.key, 'Last key');
  if (d.lastKey !== null && d.lastKeysym !== null) {
    value(ROW.key, `${d.lastKey}     (keysym 0x${d.lastKeysym.toString(16)})`);
  } else {
    value(ROW.key, 'none yet: press any key or shortcut', COLORS.muted);
  }

  label(ROW.held, 'Keys held');
  const held = [...d.held].map(keysymName);
  value(
    ROW.held,
    held.length ? held.join(' + ') : 'none',
    held.length ? COLORS.text : COLORS.muted,
  );

  label(ROW.targets, 'Small targets');
  let checked = 0;
  for (let i = 0; i < INPUT.checkboxCount; i++) {
    const r = INPUT.checkbox(i);
    const on = d.checks[i] === true;
    if (on) checked++;
    p.fillRect(r.x, r.y, r.w, r.h, on ? COLORS.accent : COLORS.field);
    p.strokeRect(r.x, r.y, r.w, r.h, on ? COLORS.accent : '#7d8796');
    if (on) {
      p.line(r.x + 3, r.y + 6, r.x + 5, r.y + 9, '#ffffff', 1.5);
      p.line(r.x + 5, r.y + 9, r.x + 9, r.y + 3, '#ffffff', 1.5);
    }
  }
  const cap = INPUT.checkedCaption;
  const tr = INPUT.row(cap.row);
  p.text(
    `${checked} of ${INPUT.checkboxCount} checked (12 px boxes)`,
    cap.x,
    tr.y + tr.h / 2,
    SMALL,
    COLORS.muted,
  );

  // Captions
  const dragCaption = d.ellipsize('Drag the box with the left button', INPUT.dragArea.w, SMALL);
  p.text(dragCaption, 14, INPUT.dragCaptionY, SMALL, COLORS.muted);
  const lc = INPUT.listCaption;
  p.text(
    d.ellipsize('Scroll with the wheel', INPUT.list.w, SMALL),
    lc.x,
    lc.y,
    SMALL,
    COLORS.muted,
  );

  // Drag area
  const a = INPUT.dragArea;
  p.fillRect(a.x, a.y, a.w, a.h, '#eef1f5');
  for (let gx = a.x + 10; gx < a.x + a.w; gx += 10) {
    for (let gy = a.y + 10; gy < a.y + a.h; gy += 10) p.fillRect(gx, gy, 1, 1, '#c3cad4');
  }
  p.strokeRect(a.x, a.y, a.w, a.h, COLORS.fieldBorder);
  const bx = a.x + d.boxX;
  const by = a.y + d.boxY;
  const s = INPUT.boxSize;
  const active = d.dragging === 'box';
  p.fillRect(bx, by, s, s, active ? COLORS.boxActive : COLORS.box);
  p.strokeRect(bx, by, s, s, '#8f3f12');
  p.text('drag', bx + s / 2, by + s / 2, SMALL, '#ffffff', 'center');
  p.text(`${d.boxX}, ${d.boxY}`, a.x + a.w - 6, a.y + a.h - 9, { size: 9 }, COLORS.muted, 'right');

  // Scroll list
  const l = INPUT.list;
  const view = d.listViewport();
  p.fillRect(l.x, l.y, l.w, l.h, COLORS.field);
  p.strokeRect(l.x, l.y, l.w, l.h, COLORS.fieldBorder);
  p.save();
  p.clip(view.x, view.y, view.w, view.h);
  const rh = INPUT.listRowH;
  const first = Math.floor(d.listScroll / rh);
  const last = Math.min(INPUT.listItems - 1, Math.floor((d.listScroll + view.h) / rh));
  for (let i = first; i <= last; i++) {
    const y = view.y + i * rh - d.listScroll;
    p.fillRect(view.x, y, view.w, rh, i % 2 ? '#f3f5f8' : COLORS.field);
    p.text(`List item ${String(i + 1).padStart(2, '0')}`, view.x + 8, y + rh / 2, UI, COLORS.text);
    p.text(`#${i + 1}`, view.x + view.w - 8, y + rh / 2, { size: 9 }, COLORS.muted, 'right');
  }
  p.restore();
  const sb = d.scrollbarRect();
  p.fillRect(sb.x, sb.y, sb.w, sb.h, COLORS.pill);
  const total = INPUT.listItems * rh;
  const thumbH = Math.max(16, Math.round((sb.h * view.h) / total));
  const max = d.listMaxScroll;
  const thumbY = sb.y + (max > 0 ? Math.round(((sb.h - thumbH) * d.listScroll) / max) : 0);
  p.fillRect(sb.x + 1, thumbY, sb.w - 2, thumbH, '#9aa4b2');
}

function paintAbout(L: AboutLayout, p: Painter): void {
  const x = 14;
  let y = TITLE_H + 20;
  p.text('About this demo', x, y, { size: 13, bold: true }, COLORS.text);
  y += 22;
  for (const line of L.lines) {
    p.text(line, x, y, UI, COLORS.text);
    y += 17;
  }
  y += 6;
  for (const size of [9, 8, 7]) {
    p.text(`${size} px: ${L.sample}`, x, y, { size }, COLORS.muted);
    y += size + 6;
  }

  // Fine-detail target: 1 px lines, a 2 px checkerboard and nested squares. On a scaled
  // (high-DPI) demo desktop these are logical pixels, drawn crisply at the device scale.
  const t = L.target;
  const half = t.w / 2;
  p.fillRect(t.x, t.y, t.w, t.h, '#ffffff');
  for (let i = 0; i < half; i += 2) p.fillRect(t.x + i, t.y, 1, half, '#000000');
  for (let i = 0; i < half; i += 2) p.fillRect(t.x + half, t.y + i, half, 1, '#000000');
  for (let gy = 0; gy < half; gy += 2) {
    for (let gx = (gy / 2) % 2 ? 2 : 0; gx < half; gx += 4) {
      p.fillRect(t.x + gx, t.y + half + gy, 2, 2, '#000000');
    }
  }
  for (let k = 0; k < half / 2; k += 2) {
    p.strokeRect(t.x + half + k, t.y + half + k, half - 2 * k, half - 2 * k, '#000000');
  }
  p.strokeRect(t.x, t.y, t.w, t.h, COLORS.fieldBorder);
  p.text(
    'Zoom in: 1 px detail',
    t.x + t.w / 2,
    t.y + t.h + 10,
    { size: 9 },
    COLORS.muted,
    'center',
  );
}

function paintMenu(d: DemoDesktop, p: Painter): void {
  const h = MENU_ITEMS.length * MENU.itemH + MENU.pad * 2;
  p.fillRect(0, 0, MENU.w, h, '#ffffff');
  p.strokeRect(0, 0, MENU.w, h, COLORS.border);
  for (const [i, item] of MENU_ITEMS.entries()) {
    const y = MENU.pad + i * MENU.itemH;
    const hover = d.menuHover === i;
    if (hover) p.fillRect(MENU.pad, y, MENU.w - MENU.pad * 2, MENU.itemH, COLORS.accent);
    p.text(item, 14, y + MENU.itemH / 2, UI, hover ? '#ffffff' : COLORS.text);
  }
}
