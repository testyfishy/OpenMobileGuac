import { forwardRef, useEffect, useRef, useState } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import { IconChevronDown, IconMenu, IconMore } from './icons.tsx';
import {
  buildSessionActions,
  type SessionAction,
  type SessionActionContext,
} from './sessionActions.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { resolveToolbarItems, type ToolbarStyle } from './toolbarItems.ts';

export interface ToolbarProps {
  /** Effective style (side docks already resolved for the orientation). */
  readonly style: ToolbarStyle;
  readonly labels: 'auto' | 'always' | 'never';
  /** Floating only: expanded row or the small handle. */
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  /** Immersive: the collapsed handle becomes a thin edge grip. */
  readonly immersive?: boolean;
  /** State and commands of every action. */
  readonly context: SessionActionContext;
  /** The user's row (`toolbarItems`), null = built-in. */
  readonly items: readonly string[] | null;
  readonly onOpenMore: () => void;
  /** Small count on the More button (running transfers). */
  readonly moreBadge?: number;
  /** Interaction anywhere in the toolbar (resets the auto-hide timer). */
  readonly onActivity: () => void;
}

const LONG_PRESS_MS = 500;
const CONFIRM_MS = 3000;

/**
 * Session toolbar. Floating: one compact row over the bottom of the desktop that collapses
 * to a handle on the right edge. Docked (top / bottom / left / right): a static row that
 * the desktop is laid out around (see `setReservedInsets`). Buttons never take focus from
 * the hidden field. "More" is always the last button.
 */
export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(props, ref) {
  const { style, expanded, onExpandedChange, onActivity } = props;
  const t = sessionStrings.toolbar;
  const floating = style === 'floating';
  const badge = props.moreBadge ?? 0;
  const actions = buildSessionActions(props.context);
  const ids = resolveToolbarItems(props.items);
  // Touch pass-through sends pinches to the remote: offer zoom buttons unless already there.
  if (
    props.context.pointerMode === 'touch' &&
    !ids.includes('zoom-in') &&
    !ids.includes('zoom-out')
  ) {
    ids.splice(ids.indexOf('pointer') + 1, 0, 'zoom-in', 'zoom-out');
  }
  const row = ids.map((id) => actions[id]).filter((a) => a.available);

  if (floating && !expanded) {
    return (
      <div ref={ref} className="omg-toolbar omg-toolbar--collapsed">
        <ChromeButton
          className={props.immersive ? 'omg-handle omg-handle--grip' : 'omg-handle'}
          aria-label={t.show}
          aria-expanded={false}
          onClick={() => onExpandedChange(true)}
        >
          <IconMenu />
          {badge > 0 && <span className="omg-badge-dot" aria-hidden="true" />}
        </ChromeButton>
      </div>
    );
  }

  const cls = [
    'omg-toolbar',
    floating ? 'omg-toolbar--floating' : `omg-toolbar--dock omg-toolbar--${style}`,
  ].join(' ');
  return (
    <div
      ref={ref}
      className={cls}
      role="toolbar"
      aria-label={t.label}
      aria-orientation={style === 'dock-left' || style === 'dock-right' ? 'vertical' : undefined}
      data-labels={props.labels}
      onPointerDownCapture={onActivity}
      onKeyDownCapture={onActivity}
    >
      <div className="omg-toolbar__scroll">
        {row.map((a) => (
          <ToolButton key={a.id} action={a} />
        ))}
      </div>
      <ChromeButton
        className="omg-tool omg-tool--more"
        aria-label={badge > 0 ? t.moreActionsRunning(badge) : t.moreActions}
        aria-haspopup="dialog"
        onClick={props.onOpenMore}
      >
        <IconMore />
        <span className="omg-tool__label">{t.more}</span>
        {badge > 0 && (
          <span className="omg-tool__badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </ChromeButton>
      {floating && (
        <ChromeButton
          className="omg-tool omg-tool--collapse"
          aria-label={t.hide}
          aria-expanded={true}
          onClick={() => onExpandedChange(false)}
        >
          <IconChevronDown />
        </ChromeButton>
      )}
    </div>
  );
});

function ToolButton({ action: a }: { action: SessionAction }) {
  const pressStart = useRef<number | null>(null);
  const longPressed = useRef(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), CONFIRM_MS);
    return () => clearTimeout(id);
  }, [confirm]);
  const t = sessionStrings.toolbar;

  const cls = [
    'omg-tool',
    a.pressed ? 'omg-tool--on' : '',
    a.danger ? 'omg-tool--danger' : '',
    confirm ? 'omg-tool--confirm' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const label = confirm ? t.tapAgain : a.label;
  const name = confirm ? t.disconnectConfirm : a.name;
  const pressable = a.id === 'keyboard' || a.id === 'extra-keys' || a.id === 'sound';
  return (
    <ChromeButton
      className={cls}
      aria-label={name}
      aria-pressed={pressable ? (a.pressed ?? false) : undefined}
      aria-haspopup={a.opensSheet ? 'dialog' : undefined}
      data-action={a.id}
      onPointerDown={
        a.onLongPress
          ? () => {
              pressStart.current = performance.now();
              longPressed.current = false;
            }
          : undefined
      }
      onPointerUp={
        a.onLongPress
          ? () => {
              const start = pressStart.current;
              pressStart.current = null;
              if (start !== null && performance.now() - start >= LONG_PRESS_MS) {
                longPressed.current = true;
                a.onLongPress?.();
              }
            }
          : undefined
      }
      onPointerCancel={() => {
        pressStart.current = null;
      }}
      onContextMenu={a.onLongPress ? (e) => e.preventDefault() : undefined}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        if (a.danger && !confirm) {
          setConfirm(true);
          return;
        }
        setConfirm(false);
        a.onRun();
      }}
    >
      {a.icon}
      <span className="omg-tool__label">{label}</span>
      {(a.badge ?? 0) > 0 && (
        <span className="omg-tool__badge" aria-hidden="true">
          {a.badge}
        </span>
      )}
    </ChromeButton>
  );
}
