import type { ReactNode } from 'react';

/**
 * Original line icons drawn for this app (24×24 grid, 2px stroke, currentColor).
 * Decorative by default; pass `label` to expose one to assistive technology.
 */

export type IconName =
  | 'back'
  | 'plus'
  | 'gear'
  | 'sun'
  | 'moon'
  | 'server'
  | 'chevron-right'
  | 'chevron-down'
  | 'star'
  | 'star-filled'
  | 'search'
  | 'close'
  | 'refresh'
  | 'monitor'
  | 'terminal'
  | 'cube'
  | 'folder'
  | 'clock'
  | 'up'
  | 'down'
  | 'edit'
  | 'trash'
  | 'lock-open'
  | 'logout'
  | 'alert'
  | 'play'
  | 'beaker'
  | 'layers'
  | 'lock'
  | 'link'
  | 'copy'
  | 'share'
  | 'info'
  | 'sort'
  | 'bug'
  | 'key'
  | 'archive'
  | 'globe'
  | 'pulse'
  | 'pointer'
  | 'hand'
  | 'keyboard'
  | 'shield'
  | 'toolbar';

const paths: Record<IconName, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  gear: (
    <>
      <path d="M9.9 5.2L10.4 2.7L13.6 2.7L14.1 5.2L15.3 5.7L17.4 4.3L19.7 6.6L18.3 8.7L18.8 9.9L21.3 10.4L21.3 13.6L18.8 14.1L18.3 15.3L19.7 17.4L17.4 19.7L15.3 18.3L14.1 18.8L13.6 21.3L10.4 21.3L9.9 18.8L8.7 18.3L6.6 19.7L4.3 17.4L5.7 15.3L5.2 14.1L2.7 13.6L2.7 10.4L5.2 9.9L5.7 8.7L4.3 6.6L6.6 4.3L8.7 5.7Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
    </>
  ),
  moon: <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" />,
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5M11 16.5h5" />
    </>
  ),
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  'star-filled': (
    <path
      d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"
      fill="currentColor"
    />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12.5 15H17" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  folder: (
    <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  'lock-open': (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  logout: <path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h9" />,
  alert: (
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  beaker: (
    <path d="M9 3.5h6M10 3.5v6L4.8 18.3A1.5 1.5 0 0 0 6.1 20.5h11.8a1.5 1.5 0 0 0 1.3-2.2L14 9.5v-6M7.5 14.5h9" />
  ),
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </>
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v11M8 7.5l4-4 4 4" />
      <path d="M6.5 11H5.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  sort: <path d="M7 4.5v15M4 16.5l3 3 3-3M17 19.5v-15M14 7.5l3-3 3 3" />,
  bug: (
    <>
      <rect x="7" y="8" width="10" height="12" rx="5" />
      <path d="M12 12v8M7 13H3.5M20.5 13H17M7.5 9L5 6.5M16.5 9L19 6.5M9 8a3 3 0 0 1 6 0M4.5 19l3-2.5M19.5 19l-3-2.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  pointer: <path d="M6 3.5l12 7.2-5.2 1.3 3.2 6.2-2.4 1.3-3.2-6.3L6 17z" />,
  hand: (
    <path d="M9 11.5V5a1.5 1.5 0 0 1 3 0v5.5M12 10V4a1.5 1.5 0 0 1 3 0v6.5M15 10.5V6a1.5 1.5 0 0 1 3 0v8a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L3.6 15a1.6 1.6 0 0 1 2.4-2.1L9 15.5" />
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.5h.01M18 12.5h.01M8 15h8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5l7.5 3v5.2c0 4.4-3.1 7.6-7.5 8.8-4.4-1.2-7.5-4.4-7.5-8.8V6.5z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  toolbar: (
    <>
      <rect x="3" y="14.5" width="18" height="5.5" rx="2" />
      <path d="M7 17.2h.01M12 17.2h.01M17 17.2h.01M3.5 4.5h17M3.5 9h11" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Accessible label; omit for decorative icons. */
  label?: string;
  size?: number | string;
  className?: string;
}

export function Icon({ name, label, size = '1.5rem', className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
