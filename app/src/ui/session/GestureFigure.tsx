import type { CSSProperties, ReactNode } from 'react';
import type { GestureFigureKind } from './gestures.ts';
import './gestureFigure.css';

/**
 * A small looping picture of a gesture: finger dots on a phone outline (inline SVG, CSS
 * animations in `gestureFigure.css`). Decorative: the row's text carries the meaning, so it
 * is `aria-hidden`. Under `prefers-reduced-motion: reduce` it stands still in a pose that
 * still reads (dots where the fingers land, arrows for the movement).
 */
export function GestureFigure({ kind }: { kind: GestureFigureKind }) {
  return (
    <svg
      className="omg-gesture-fig"
      data-figure={kind}
      viewBox="0 0 64 64"
      width="56"
      height="56"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="gf-frame" x="14" y="3" width="36" height="58" rx="7" />
      <rect className="gf-screen" x="17" y="8" width="30" height="46" rx="2" />
      {FIGURES[kind]()}
    </svg>
  );
}

/** Movement for `gf-move`: CSS custom properties read by the keyframes. */
function moveBy(dx: number, dy: number): CSSProperties {
  return { '--dx': `${dx}px`, '--dy': `${dy}px` } as CSSProperties;
}

function Dot({
  x,
  y,
  a,
  dx = 0,
  dy = 0,
}: {
  x: number;
  y: number;
  a: string;
  dx?: number;
  dy?: number;
}) {
  return (
    <circle
      className={`gf-dot ${a}`}
      cx={x}
      cy={y}
      r="4"
      style={dx !== 0 || dy !== 0 ? moveBy(dx, dy) : undefined}
    />
  );
}

function Ring({ x, y, a }: { x: number; y: number; a: string }) {
  return <circle className={`gf-ring ${a}`} cx={x} cy={y} r="4" />;
}

/** A straight arrow from (x1, y1) to (x2, y2): the path of a moving finger. */
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 4;
  const spread = 0.5;
  const hx1 = x2 - head * Math.cos(angle - spread);
  const hy1 = y2 - head * Math.sin(angle - spread);
  const hx2 = x2 - head * Math.cos(angle + spread);
  const hy2 = y2 - head * Math.sin(angle + spread);
  const r = (n: number) => Math.round(n * 10) / 10;
  return (
    <path
      className="gf-trail"
      d={`M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}M${r(hx1)} ${r(hy1)}L${r(x2)} ${r(y2)}L${r(hx2)} ${r(hy2)}`}
    />
  );
}

/** A soft keyboard filling the bottom of the screen, with a few key caps. */
function Keyboard({ y, a }: { y: number; a?: string }) {
  const keys: ReactNode[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      keys.push(
        <rect
          key={`${row}-${col}`}
          className="gf-key"
          x={19 + col * 5.4}
          y={y + 2 + row * 5}
          width="4.2"
          height="3.6"
          rx="0.8"
        />,
      );
    }
  }
  return (
    <g className={a}>
      <rect className="gf-kb" x="17" y={y} width="30" height={54 - y} />
      {keys}
    </g>
  );
}

/** The extra key bar: a strip with key caps. */
function KeyBarStrip({ y, highlight }: { y: number; highlight?: number }) {
  const keys: ReactNode[] = [];
  for (let i = 0; i < 4; i++) {
    keys.push(
      <rect
        key={i}
        className={i === highlight ? 'gf-key gf-key--on' : 'gf-key'}
        x={18.5 + i * 7}
        y={y + 1}
        width="6"
        height="4"
        rx="0.8"
      />,
    );
  }
  return (
    <g>
      <rect className="gf-bar" x="17" y={y} width="30" height="6" />
      {keys}
    </g>
  );
}

const FIGURES: Readonly<Record<GestureFigureKind, () => ReactNode>> = {
  tap: () => (
    <>
      <Ring x={32} y={31} a="gf-a-ring" />
      <Dot x={32} y={31} a="gf-a-tap" />
    </>
  ),
  'double-tap': () => (
    <>
      <Ring x={32} y={31} a="gf-a-ring2" />
      <Dot x={32} y={31} a="gf-a-tap2" />
    </>
  ),
  'long-press': () => (
    <>
      <circle className="gf-progress gf-a-progress" cx="32" cy="31" r="8" />
      <Dot x={32} y={31} a="gf-a-hold" />
    </>
  ),
  drag: () => (
    <>
      <Arrow x1={24} y1={40} x2={40} y2={22} />
      <Dot x={24} y={40} a="gf-a-move" dx={16} dy={-18} />
    </>
  ),
  'tap-drag': () => (
    <>
      <Arrow x1={25} y1={39} x2={40} y2={23} />
      <Ring x={25} y={39} a="gf-a-ring" />
      <Dot x={25} y={39} a="gf-a-tapfirst" />
      <Dot x={25} y={39} a="gf-a-move-late" dx={15} dy={-16} />
    </>
  ),
  'two-finger-tap': () => (
    <>
      <Ring x={27} y={31} a="gf-a-ring" />
      <Ring x={37} y={31} a="gf-a-ring" />
      <Dot x={27} y={31} a="gf-a-tap" />
      <Dot x={37} y={31} a="gf-a-tap" />
    </>
  ),
  'three-finger-tap': () => (
    <>
      <Ring x={24} y={33} a="gf-a-ring" />
      <Ring x={32} y={28} a="gf-a-ring" />
      <Ring x={40} y={33} a="gf-a-ring" />
      <Dot x={24} y={33} a="gf-a-tap" />
      <Dot x={32} y={28} a="gf-a-tap" />
      <Dot x={40} y={33} a="gf-a-tap" />
    </>
  ),
  'three-finger-double-tap': () => (
    <>
      <rect className="gf-content gf-a-unzoom" x="24" y="38" width="16" height="10" rx="1.5" />
      <Dot x={24} y={27} a="gf-a-tap2" />
      <Dot x={32} y={22} a="gf-a-tap2" />
      <Dot x={40} y={27} a="gf-a-tap2" />
    </>
  ),
  'two-finger-drag': () => (
    <>
      <Arrow x1={27} y1={42} x2={27} y2={22} />
      <Arrow x1={37} y1={42} x2={37} y2={22} />
      <Dot x={27} y={42} a="gf-a-move" dy={-18} />
      <Dot x={37} y={42} a="gf-a-move" dy={-18} />
    </>
  ),
  pinch: () => (
    <>
      <rect className="gf-content gf-a-zoom" x="28" y="27" width="8" height="8" rx="1" />
      <Arrow x1={28} y1={35} x2={22} y2={41} />
      <Arrow x1={36} y1={27} x2={42} y2={21} />
      <Dot x={29} y={34} a="gf-a-move" dx={-6} dy={6} />
      <Dot x={35} y={28} a="gf-a-move" dx={6} dy={-6} />
    </>
  ),
  'tap-keyboard': () => (
    <>
      <Keyboard y={40} a="gf-a-kbhide" />
      <Ring x={32} y={22} a="gf-a-ring" />
      <Dot x={32} y={22} a="gf-a-tap" />
    </>
  ),
  'keybar-swipe-down': () => (
    <>
      <g className="gf-a-kbhide-late">
        <KeyBarStrip y={34} />
        <Keyboard y={41} />
      </g>
      <Arrow x1={42} y1={30} x2={42} y2={44} />
      <Dot x={32} y={37} a="gf-a-move" dy={12} />
    </>
  ),
  'keybar-swipe-side': () => (
    <>
      <KeyBarStrip y={46} />
      <Arrow x1={41} y1={41} x2={23} y2={41} />
      <Dot x={41} y={49} a="gf-a-move" dx={-17} />
    </>
  ),
  'hold-button': () => (
    <>
      <g className="gf-a-popup">
        <rect className="gf-popup" x="23" y="22" width="22" height="18" rx="2" />
        <rect className="gf-line" x="26" y="26" width="14" height="2" rx="1" />
        <rect className="gf-line" x="26" y="30" width="11" height="2" rx="1" />
        <rect className="gf-line" x="26" y="34" width="13" height="2" rx="1" />
      </g>
      <KeyBarStrip y={46} highlight={3} />
      <circle className="gf-progress gf-a-progress" cx="42.5" cy="49" r="7" />
      <Dot x={42.5} y={49} a="gf-a-hold" />
    </>
  ),
  'sheet-swipe-down': () => (
    <>
      <g className="gf-a-sheetdown">
        <rect className="gf-popup" x="17" y="24" width="30" height="30" rx="3" />
        <rect className="gf-line" x="28" y="27" width="8" height="1.6" rx="0.8" />
        <rect className="gf-line" x="21" y="34" width="20" height="2" rx="1" />
        <rect className="gf-line" x="21" y="39" width="16" height="2" rx="1" />
      </g>
      <Arrow x1={43} y1={28} x2={43} y2={44} />
      <Dot x={32} y={29} a="gf-a-move" dy={16} />
    </>
  ),
};
