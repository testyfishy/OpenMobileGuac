/** Simple original line icons for the session chrome (24×24, currentColor). */

import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconTouch() {
  return (
    <Svg>
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 10.5V9a1.5 1.5 0 0 1 3 0v2" />
      <path d="M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L5 16.2a1.6 1.6 0 0 1 2.4-2.1L9 15.5" />
    </Svg>
  );
}

export function IconTrackpad() {
  return (
    <Svg>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M12 17v3M8 20h8" />
      <path d="M9.5 8.5l3.5 1.4-1.5.6-.6 1.5z" />
    </Svg>
  );
}

export function IconView() {
  return (
    <Svg>
      <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
      <rect x="8" y="9" width="8" height="6" rx="1" />
    </Svg>
  );
}

export function IconKeyboard() {
  return (
    <Svg>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </Svg>
  );
}

export function IconKeys() {
  return (
    <Svg>
      <rect x="3" y="8" width="5" height="8" rx="1.2" />
      <rect x="9.5" y="8" width="5" height="8" rx="1.2" />
      <rect x="16" y="8" width="5" height="8" rx="1.2" />
    </Svg>
  );
}

export function IconPaste() {
  return (
    <Svg>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9.5 4.5V3.5h5v1" />
      <path d="M12 9v7M9 13l3 3 3-3" />
    </Svg>
  );
}

export function IconCombo() {
  return (
    <Svg>
      <rect x="3" y="7" width="7" height="7" rx="1.5" />
      <rect x="14" y="7" width="7" height="7" rx="1.5" />
      <path d="M12 9.5v2M11 10.5h2M6.5 17.5h11" />
    </Svg>
  );
}

export function IconPower() {
  return (
    <Svg>
      <path d="M12 3.5v8" />
      <path d="M7 6.5a7 7 0 1 0 10 0" />
    </Svg>
  );
}

export function IconChevronDown() {
  return (
    <Svg>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconChevronUp() {
  return (
    <Svg>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  );
}

export function IconMenu() {
  return (
    <Svg>
      <circle cx="6" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18" cy="12" r="1.3" />
    </Svg>
  );
}

export function IconClose() {
  return (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconTrash() {
  return (
    <Svg>
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
    </Svg>
  );
}

export function IconArrow({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) {
  const rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <Svg>
      <g transform={`rotate(${rot} 12 12)`}>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </g>
    </Svg>
  );
}

/** Fallback pointer arrow drawn when the server has not sent a cursor image. */
export function CursorArrow() {
  return (
    <svg width="14" height="21" viewBox="0 0 14 21" aria-hidden="true" focusable="false">
      <path
        d="M1 1v16.5l4.2-4 2.9 6.6 2.6-1.1-2.9-6.5H13.5z"
        fill="#fff"
        stroke="#000"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
