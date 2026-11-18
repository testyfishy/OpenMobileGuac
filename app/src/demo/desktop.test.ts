import { beforeEach, describe, expect, it } from 'vitest';
import {
  Button,
  DemoDesktop,
  INPUT,
  MENU,
  MENU_ITEMS,
  TASKBAR_H,
  TASKBAR_ORDER,
  TITLE_H,
  type WindowId,
} from './desktop.ts';
import { contains, type Rect } from './geometry.ts';
import { Keysym } from './keysyms.ts';
import { paintSurface } from './paintDesktop.ts';
import type { FontSpec } from './painter.ts';
import { RecordingPainter, stubMeasure } from './testing.ts';

const inside = (outer: Rect, r: Rect) =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;

/** Every text a window paints, as [left, right] extents with the stub font metrics. */
function textExtents(d: DemoDesktop, id: WindowId): { text: string; l: number; r: number }[] {
  const p = new RecordingPainter();
  paintSurface(d, id, p);
  return p.calls
    .filter((c) => c.op === 'text')
    .map((c) => {
      const [text, x, , font, , align] = c.args as [
        string,
        number,
        number,
        FontSpec,
        string,
        string?,
      ];
      const w = stubMeasure(text, font);
      const l = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      return { text, l, r: l + w };
    });
}

describe.each([
  [375, 812],
  [412, 892],
  [320, 568],
])('phone portrait layout at %i × %i', (width, height) => {
  let d: DemoDesktop;
  beforeEach(() => {
    d = new DemoDesktop({ width, height, measure: stubMeasure, now: 0 });
  });

  it('gives every window the full width and a fully visible place above the taskbar', () => {
    const screen = { x: 0, y: 0, w: width, h: height - TASKBAR_H };
    for (const w of Object.values(d.windows)) {
      expect(w.w).toBe(width - 32);
      expect(inside(screen, w)).toBe(true);
    }
    // Notes is on top and focused; the title bars of the windows below still show.
    expect(d.stack.at(-1)).toBe('notes');
    expect(d.focused).toBe('notes');
    const ys = d.stack.map((id) => d.windows[id].y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] as number).toBeGreaterThanOrEqual((ys[i - 1] as number) + TITLE_H);
    }
  });

  it('keeps every interactive part inside its window', () => {
    const { notes, input, about } = d.layout;
    const box = (w: { w: number; h: number }) => ({ x: 0, y: 0, w: w.w, h: w.h });
    for (const r of [notes.hint, notes.area, notes.clip, notes.status]) {
      expect(inside(box(notes), r)).toBe(true);
    }
    const parts = [input.dragArea, input.list, input.row(input.checkedCaption.row)];
    for (let i = 0; i < 3; i++) parts.push(input.pill(i));
    for (let i = 0; i < input.checkboxCount; i++) parts.push(input.checkbox(i));
    for (const r of parts) expect(inside(box(input), r)).toBe(true);
    expect(input.dragArea.y + input.dragArea.h).toBeLessThanOrEqual(input.list.y);
    expect(inside(box(about), about.target)).toBe(true);
  });

  it('paints no window text past the window edges', () => {
    d.receiveClipboard('a long clipboard text from the phone that cannot fit on the line');
    d.notes.selectAll();
    d.pointer(1234, 2345, Button.LEFT | Button.RIGHT, 0);
    for (const k of [Keysym.Control_L, Keysym.Shift_L, Keysym.Alt_L, Keysym.Delete]) {
      d.key(k, true);
    }
    for (const id of ['notes', 'input', 'about'] as const) {
      for (const t of textExtents(d, id)) {
        expect(t.l, t.text).toBeGreaterThanOrEqual(0);
        expect(t.r, t.text).toBeLessThanOrEqual(d.windows[id].w);
      }
    }
  });

  it('fits the taskbar buttons between the logo and the clock', () => {
    const clock = d.clockRect();
    for (const [i] of TASKBAR_ORDER.entries()) {
      const b = d.taskbarButtonRect(i);
      expect(b.x).toBeGreaterThanOrEqual(36);
      expect(b.x + b.w).toBeLessThanOrEqual(clock.x);
      expect(b.w).toBeGreaterThanOrEqual(50);
    }
    const p = new RecordingPainter();
    paintSurface(d, 'desktop', p);
    expect(p.texts()).toEqual(expect.arrayContaining(['Notes', 'Input', 'About']));
  });

  it('lets each window be raised from the taskbar and used: type into Notes, tick a box', () => {
    const b = d.taskbarButtonRect(TASKBAR_ORDER.indexOf('input'));
    d.pointer(b.x + 5, b.y + 5, Button.LEFT, 0);
    d.pointer(b.x + 5, b.y + 5, 0, 1);
    expect(d.stack.at(-1)).toBe('input');
    const win = d.windows.input;
    const cb = d.layout.input.checkbox(7);
    d.pointer(win.x + cb.x + 6, win.y + cb.y + 6, Button.LEFT, 1000);
    d.pointer(win.x + cb.x + 6, win.y + cb.y + 6, 0, 1001);
    expect(d.checks[7]).toBe(true);
    // The list at the bottom of the stacked Input window scrolls.
    const list = d.layout.input.list;
    d.pointer(win.x + list.x + 20, win.y + list.y + list.h - 10, Button.DOWN, 2000);
    expect(d.listScroll).toBeGreaterThan(0);

    const nb = d.taskbarButtonRect(TASKBAR_ORDER.indexOf('notes'));
    d.pointer(nb.x + 5, nb.y + 5, Button.LEFT, 2500);
    d.pointer(nb.x + 5, nb.y + 5, 0, 2501);
    expect(d.stack.at(-1)).toBe('notes');
    const n = d.windows.notes;
    const area = d.layout.notes.area;
    d.pointer(n.x + area.x + 10, n.y + area.y + 10, Button.LEFT, 3000);
    d.pointer(n.x + area.x + 10, n.y + area.y + 10, 0, 3001);
    expect(d.notesFocused).toBe(true);
    d.notes.setText('');
    d.key(0x61, true);
    expect(d.notes.text).toBe('a');
  });
});

describe('other sizes', () => {
  it('keeps every window fully on screen even on a very short narrow desktop', () => {
    const d = new DemoDesktop({ width: 320, height: 480, measure: stubMeasure, now: 0 });
    for (const w of Object.values(d.windows)) {
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.y + w.h).toBeLessThanOrEqual(480 - TASKBAR_H);
    }
  });

  it('fits every window on a landscape phone (812 × 375 logical)', () => {
    const d = new DemoDesktop({ width: 812, height: 375, measure: stubMeasure, now: 0 });
    for (const w of Object.values(d.windows)) {
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.y + w.h).toBeLessThanOrEqual(375 - TASKBAR_H);
      expect(w.x + w.w).toBeLessThanOrEqual(812);
    }
  });

  it('re-flows when rotated, keeping the box and the list scroll valid', () => {
    const d = new DemoDesktop({ width: 1280, height: 800, measure: stubMeasure, now: 0 });
    d.boxX = INPUT.dragArea.w - INPUT.boxSize;
    d.boxY = INPUT.dragArea.h - INPUT.boxSize;
    d.listScroll = d.listMaxScroll;
    d.resize(320, 240);
    const L = d.layout.input;
    expect(d.boxX + L.boxSize).toBeLessThanOrEqual(L.dragArea.w);
    expect(d.boxY + L.boxSize).toBeLessThanOrEqual(L.dragArea.h);
    expect(d.listScroll).toBeLessThanOrEqual(d.listMaxScroll);
    for (const w of Object.values(d.windows)) expect(w.w).toBe(288);
    d.resize(1280, 800);
    expect(d.windows.input.w).toBe(INPUT.w);
    expect(d.layout.input.list).toEqual(INPUT.list);
    expect(contains(d.taskbarButtonRect(2), 96 + 2 * 124 + 1, 800 - TASKBAR_H + 6)).toBe(true);
  });
});

const CTRL = Keysym.Control_L;

function make(): DemoDesktop {
  return new DemoDesktop({ width: 1280, height: 800, measure: stubMeasure, now: 0 });
}

function click(d: DemoDesktop, x: number, y: number, t: number, button: number = Button.LEFT) {
  d.pointer(x, y, 0, t);
  d.pointer(x, y, button, t);
  d.pointer(x, y, 0, t + 1);
}

function tap(d: DemoDesktop, keysym: number) {
  d.key(keysym, true);
  d.key(keysym, false);
}

function chord(d: DemoDesktop, mods: number[], keysym: number) {
  for (const m of mods) d.key(m, true);
  tap(d, keysym);
  for (const m of [...mods].reverse()) d.key(m, false);
}

/** Absolute point inside a window, from window-local coordinates. */
function at(d: DemoDesktop, id: 'notes' | 'input' | 'about', lx: number, ly: number) {
  const w = d.windows[id];
  return [w.x + lx, w.y + ly] as const;
}

function emptyDesktopPoint(d: DemoDesktop): [number, number] {
  return [d.width - 40, d.height - TASKBAR_H - 60];
}

let d: DemoDesktop;
beforeEach(() => {
  d = make();
});

describe('layout', () => {
  it('starts at the requested size with every window on screen', () => {
    expect(d.width).toBe(1280);
    expect(d.height).toBe(800);
    for (const w of Object.values(d.windows)) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(1280);
      expect(w.y + w.h).toBeLessThanOrEqual(800 - TASKBAR_H);
    }
  });

  it('re-lays out on resize and clamps sizes', () => {
    d.takeDamage();
    d.resize(800, 1200);
    expect([d.width, d.height]).toEqual([800, 1200]);
    const { notes, input, about } = d.windows;
    expect(notes.y + notes.h).toBeLessThanOrEqual(input.y);
    expect(input.y + input.h).toBeLessThanOrEqual(about.y);
    expect(about.y + about.h).toBeLessThanOrEqual(1200 - TASKBAR_H);
    expect(d.takeDamage().rects.get('desktop')).toEqual([{ x: 0, y: 0, w: 800, h: 1200 }]);

    d.resize(10, 99999);
    expect([d.width, d.height]).toEqual([320, 4096]);
    for (const w of Object.values(d.windows)) {
      // Title bars stay reachable.
      expect(w.x + w.w).toBeGreaterThanOrEqual(80);
      expect(w.x).toBeLessThanOrEqual(320 - 80);
      expect(w.y).toBeLessThanOrEqual(4096 - TASKBAR_H - TITLE_H);
    }
  });
});

describe('pointer', () => {
  it('tracks the position and buttons held', () => {
    d.pointer(10, 20, Button.LEFT | Button.RIGHT, 0);
    expect([d.pointerX, d.pointerY, d.mask]).toEqual([10, 20, 5]);
  });

  it('tells a double click from two single clicks', () => {
    const [x, y] = emptyDesktopPoint(d);
    click(d, x, y, 1000);
    expect(d.lastClick).toBe('left');
    click(d, x + 3, y - 2, 1200);
    expect(d.lastClick).toBe('double');
    // A third quick press starts a new pair.
    click(d, x, y, 1300);
    expect(d.lastClick).toBe('left');
    // Too slow.
    click(d, x, y, 1300 + 401);
    expect(d.lastClick).toBe('left');
    // Too far.
    click(d, x, y, 3000);
    click(d, x + 20, y, 3100);
    expect(d.lastClick).toBe('left');
    expect(d.clicks).toBe(6);
  });

  it('records right and middle clicks', () => {
    const [x, y] = at(d, 'input', 50, 100);
    click(d, x, y, 0, Button.MIDDLE);
    expect(d.lastClick).toBe('middle');
    click(d, x, y, 1000, Button.RIGHT);
    expect(d.lastClick).toBe('right');
  });

  it('counts wheel notches and scrolls the list under the pointer', () => {
    const [ex, ey] = emptyDesktopPoint(d);
    d.pointer(ex, ey, Button.UP, 0);
    d.pointer(ex, ey, 0, 0);
    expect([d.wheelUp, d.wheelDown, d.listScroll]).toEqual([1, 0, 0]);

    const [lx, ly] = at(d, 'input', INPUT.list.x + 50, INPUT.list.y + 50);
    d.takeDamage();
    for (let i = 0; i < 3; i++) {
      d.pointer(lx, ly, Button.DOWN, i);
      d.pointer(lx, ly, 0, i);
    }
    expect(d.wheelDown).toBe(3);
    expect(d.listScroll).toBe(3 * 2 * INPUT.listRowH);
    const { copies, rects } = d.takeDamage();
    expect(copies).toEqual([{ surface: 'input', rect: d.listViewport(), dy: -120 }]);
    // The newly exposed strip at the bottom is repainted.
    const view = d.listViewport();
    const strip = { x: view.x, y: view.y + view.h - 120, w: view.w, h: 120 };
    const covering = (rects.get('input') ?? []).filter(
      (r) =>
        r.x <= strip.x &&
        r.y <= strip.y &&
        r.x + r.w >= strip.x + strip.w &&
        r.y + r.h >= strip.y + strip.h,
    );
    expect(covering).toHaveLength(1);
    // ...but not the part that the copy already moved.
    expect(covering[0]?.y).toBeGreaterThan(view.y);

    // Scrolling stops at the top.
    for (let i = 0; i < 10; i++) {
      d.pointer(lx, ly, Button.UP, i);
      d.pointer(lx, ly, 0, i);
    }
    expect(d.listScroll).toBe(0);
  });

  it('drags a window by its title bar', () => {
    const notes = d.windows.notes;
    const [x0, y0] = at(d, 'notes', 200, 10);
    const start = { x: notes.x, y: notes.y };
    d.pointer(x0, y0, Button.LEFT, 0);
    expect(d.dragging).toBe('window');
    expect(d.cursor).toBe('move');
    d.pointer(x0 + 100, y0 + 50, Button.LEFT, 10);
    d.pointer(x0 + 120, y0 + 70, Button.LEFT, 20);
    d.pointer(x0 + 120, y0 + 70, 0, 30);
    expect(d.dragging).toBe(null);
    expect({ x: notes.x, y: notes.y }).toEqual({ x: start.x + 120, y: start.y + 70 });
    // Dragged window comes to the front.
    expect(d.stack[d.stack.length - 1]).toBe('notes');
    // Moving after release does nothing.
    d.pointer(0, 0, 0, 40);
    expect(notes.x).toBe(start.x + 120);
  });

  it('drags the box inside its area, clamped', () => {
    const a = INPUT.dragArea;
    const [x0, y0] = at(d, 'input', a.x + d.boxX + 10, a.y + d.boxY + 10);
    const before = { x: d.boxX, y: d.boxY };
    d.pointer(x0, y0, Button.LEFT, 0);
    expect(d.dragging).toBe('box');
    d.pointer(x0 + 30, y0 + 15, Button.LEFT, 1);
    expect({ x: d.boxX, y: d.boxY }).toEqual({ x: before.x + 30, y: before.y + 15 });
    d.pointer(x0 + 5000, y0 + 5000, Button.LEFT, 2);
    expect({ x: d.boxX, y: d.boxY }).toEqual({
      x: a.w - INPUT.boxSize,
      y: a.h - INPUT.boxSize,
    });
    d.pointer(x0, y0, 0, 3);
    expect(d.dragging).toBe(null);
  });

  it('toggles a 12 px checkbox only when the click is on it', () => {
    const cb = INPUT.checkbox(3);
    expect(cb.w).toBe(12);
    const [x, y] = at(d, 'input', cb.x + 6, cb.y + 6);
    click(d, x, y, 0);
    expect(d.checks[3]).toBe(true);
    click(d, x, y, 1000);
    expect(d.checks[3]).toBe(false);
    const [mx, my] = at(d, 'input', cb.x + 13, cb.y - 6);
    click(d, mx, my, 2000);
    expect(d.checks.filter(Boolean)).toHaveLength(1);
  });

  it('opens a context menu on right-click on the desktop, closing on the next click', () => {
    const [x, y] = emptyDesktopPoint(d);
    click(d, x, y, 0, Button.RIGHT);
    expect(d.menuOpen).toBe(true);
    expect(d.menuX + MENU.w).toBeLessThanOrEqual(d.width);
    // Any click elsewhere closes it without acting.
    click(d, 5, 5, 1000);
    expect(d.menuOpen).toBe(false);

    click(d, x, y, 2000, Button.RIGHT);
    const item = MENU_ITEMS.indexOf('Change wallpaper');
    const iy = d.menuY + MENU.pad + item * MENU.itemH + MENU.itemH / 2;
    d.pointer(d.menuX + 20, iy, 0, 3000);
    expect(d.menuHover).toBe(item);
    click(d, d.menuX + 20, iy, 3000);
    expect(d.menuOpen).toBe(false);
    expect(d.wallpaper).toBe(1);
  });

  it('does not open the menu when right-clicking a window', () => {
    const [x, y] = at(d, 'about', 100, 100);
    click(d, x, y, 0, Button.RIGHT);
    expect(d.menuOpen).toBe(false);
  });

  it('closes a window with its close button and restores it from the taskbar', () => {
    const notes = d.windows.notes;
    const [x, y] = at(d, 'notes', notes.w - 16, 14);
    click(d, x, y, 0);
    expect(notes.visible).toBe(false);
    const b = d.taskbarButtonRect(0);
    click(d, b.x + 10, b.y + 10, 1000);
    expect(notes.visible).toBe(true);
    expect(d.focused).toBe('notes');
  });

  it('shows an I-beam over the text area', () => {
    const [x, y] = at(d, 'notes', 100, 120);
    d.pointer(x, y, 0, 0);
    expect(d.cursor).toBe('text');
    const [ex, ey] = emptyDesktopPoint(d);
    d.pointer(ex, ey, 0, 1);
    expect(d.cursor).toBe('arrow');
  });
});

describe('keyboard', () => {
  it('shows the last key with the modifiers held', () => {
    d.key(CTRL, true);
    expect(d.lastKey).toBe('Ctrl');
    d.key(Keysym.Alt_L, true);
    d.key(Keysym.Delete, true);
    expect(d.lastKey).toBe('Ctrl+Alt+Delete');
    expect(d.lastKeysym).toBe(0xffff);
    expect([...d.held]).toEqual([CTRL, Keysym.Alt_L, Keysym.Delete]);
    d.key(Keysym.Delete, false);
    d.key(Keysym.Alt_L, false);
    d.key(CTRL, false);
    expect(d.held.size).toBe(0);
    chord(d, [Keysym.Shift_L], 0x41);
    expect(d.lastKey).toBe('Shift+A');
    tap(d, 0xffc2);
    expect(d.lastKey).toBe('F5');
  });

  it('types into Notes, including Unicode, Enter and Backspace', () => {
    d.notes.setText('');
    for (const k of [0x48, 0x69, 0xe9, 0x0101f642]) tap(d, k); // H i é 🙂
    expect(d.notes.text).toBe('Hié🙂');
    tap(d, Keysym.BackSpace);
    expect(d.notes.text).toBe('Hié');
    tap(d, Keysym.Return);
    tap(d, 0x01000416); // Ж
    expect(d.notes.text).toBe('Hié\nЖ');
    tap(d, Keysym.Home);
    tap(d, 0x3e); // >
    expect(d.notes.text).toBe('Hié\n>Ж');
    tap(d, Keysym.Up);
    tap(d, Keysym.End);
    tap(d, 0x21);
    expect(d.notes.text).toBe('Hié!\n>Ж');
    tap(d, Keysym.Left);
    tap(d, Keysym.BackSpace);
    expect(d.notes.text).toBe('Hi!\n>Ж');
    tap(d, Keysym.Delete);
    expect(d.notes.text).toBe('Hi\n>Ж');
  });

  it('only types when the Notes text area has focus', () => {
    d.notes.setText('x');
    const [ex, ey] = emptyDesktopPoint(d);
    click(d, ex, ey, 0);
    tap(d, 0x61);
    expect(d.notes.text).toBe('x');
    const [x, y] = at(d, 'notes', 100, 120);
    click(d, x, y, 1000);
    expect(d.notesFocused).toBe(true);
    tap(d, 0x61);
    expect(d.notes.text).toBe('xa');
  });

  it('places the caret where the text area is clicked', () => {
    d.notes.setText('abcdef');
    // stubMeasure gives 8 px per character at 13 px.
    const [x, y] = at(d, 'notes', 12 + 6 + 8 * 2 + 1, 58 + 6 + 4);
    click(d, x, y, 0);
    expect(d.notes.caret).toBe(2);
  });

  it('ignores Alt+letter but types with AltGr', () => {
    d.notes.setText('');
    chord(d, [Keysym.Alt_L], 0x66);
    expect(d.notes.text).toBe('');
    chord(d, [Keysym.AltGr], 0x40);
    expect(d.notes.text).toBe('@');
  });

  it('supports Ctrl+A, Ctrl+C, Ctrl+X and Ctrl+V with the remote clipboard', () => {
    d.notes.setText('copy me');
    chord(d, [CTRL], 0x61);
    expect(d.notes.selectedText()).toBe('copy me');
    chord(d, [CTRL], 0x63);
    expect(d.takeClipboard()).toBe('copy me');
    expect(d.takeClipboard()).toBe(null);
    expect(d.clipboardSource).toBe('notes');

    chord(d, [CTRL, Keysym.Shift_L], 0x58); // Ctrl+Shift+X (upper-case keysym)
    expect(d.notes.text).toBe('');
    expect(d.takeClipboard()).toBe('copy me');

    chord(d, [CTRL], 0x76);
    chord(d, [CTRL], 0x76);
    expect(d.notes.text).toBe('copy mecopy me');

    d.receiveClipboard('from phone\r\nline 2');
    expect(d.clipboardSource).toBe('client');
    d.notes.setText('');
    chord(d, [CTRL], 0x56);
    expect(d.notes.text).toBe('from phone\nline 2');
  });

  it('does not copy an empty selection', () => {
    chord(d, [CTRL], 0x63);
    expect(d.takeClipboard()).toBe(null);
  });
});

describe('painting', () => {
  it('shows live input state in the Input test window', () => {
    d.pointer(321, 123, Button.LEFT, 0);
    d.key(CTRL, true);
    d.key(Keysym.Alt_L, true);
    d.key(Keysym.Delete, true);
    const p = new RecordingPainter();
    paintSurface(d, 'input', p);
    const texts = p.texts();
    expect(texts.some((t) => t.startsWith('x 321, y 123'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Ctrl+Alt+Delete'))).toBe(true);
    expect(texts).toContain('Ctrl + Alt + Delete');
  });

  it('shows the remote clipboard in Notes', () => {
    d.receiveClipboard('hello from the phone');
    const p = new RecordingPainter();
    paintSurface(d, 'notes', p);
    expect(p.texts()).toContain('hello from the phone');
    expect(p.texts()).toContain('received from your device');
  });

  it('paints the clock in the taskbar', () => {
    const t = new Date(2024, 0, 1, 9, 5, 7).getTime();
    expect(d.tick(t)).toBe(true);
    expect(d.tick(t + 100)).toBe(false);
    const p = new RecordingPainter();
    paintSurface(d, 'desktop', p);
    expect(p.texts()).toContain('09:05:07');
  });
});
