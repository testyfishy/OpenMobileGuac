import { useEffect, useState, type ReactNode } from 'react';
import { ChromeButton } from './ChromeButton.tsx';
import {
  IconCursorLarge,
  IconDrag,
  IconEye,
  IconFullscreen,
  IconPower,
  IconScroll,
  IconSplit,
  IconTextBar,
  IconToolbar,
  IconVolume,
} from './icons.tsx';
import {
  buildSessionActions,
  type SessionAction,
  type SessionActionContext,
} from './sessionActions.tsx';
import { sessionStrings } from './sessionStrings.ts';
import { Sheet } from './Sheet.tsx';
import {
  AUDIO_MODES,
  QUALITIES,
  type AudioMode,
  type Quality,
} from '../../session/viewport/remoteSize.ts';

/** Terminal sessions: what the server lets the user change (argv), or null. */
export interface TerminalControls {
  /** Points; null when `font-size` is not changeable. */
  readonly fontSize: number | null;
  readonly colorScheme: string | null;
  readonly onFontStep: (delta: number) => void;
  readonly onNextScheme: () => void;
}

/** On/off settings shown as switches in the More sheet. */
export interface MoreToggles {
  readonly naturalScroll: boolean;
  readonly tapDrag: boolean;
  readonly largeCursor: boolean;
  readonly textInputBar: boolean;
  /** Effective split layout (the `auto` setting resolved for the fold). */
  readonly split: boolean;
  readonly immersive: boolean;
}

export interface MoreSheetProps {
  readonly context: SessionActionContext;
  readonly toggles: MoreToggles;
  readonly pointerMode: string;
  readonly audioActive: boolean;
  readonly hasFilesystem: boolean;
  readonly onToggle: (key: keyof MoreToggles, on: boolean) => void;
  readonly onEditToolbar: () => void;
  readonly quality: Quality;
  readonly audio: AudioMode;
  readonly viewOnly: boolean;
  readonly reconnectToApply: boolean;
  readonly onQuality: (q: Quality) => void;
  readonly onAudio: (a: AudioMode) => void;
  readonly onReconnect: () => void;
  readonly terminal: TerminalControls | null;
  /** "Share this session", when the host supports it (not the demo). */
  readonly onShare?: () => void;
  readonly onClose: () => void;
}

function next<T>(list: readonly T[], cur: T): T {
  return list[(list.indexOf(cur) + 1) % list.length] ?? cur;
}

const CONFIRM_MS = 3000;

function Row({
  icon,
  label,
  hint,
  badge,
  onClick,
  sheet,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  badge?: number;
  onClick: () => void;
  sheet?: boolean;
}) {
  return (
    <ChromeButton
      className="omg-row"
      aria-haspopup={sheet ? 'dialog' : undefined}
      aria-label={hint ? `${label}. ${hint}` : label}
      onClick={onClick}
    >
      <span className="omg-row__icon">{icon}</span>
      <span className="omg-row__text">
        <span className="omg-row__label">{label}</span>
        {hint && (
          <span className="omg-row__hint" aria-hidden="true">
            {hint}
          </span>
        )}
      </span>
      {(badge ?? 0) > 0 && (
        <span className="omg-row__badge" aria-hidden="true">
          {badge}
        </span>
      )}
      {sheet && <span className="omg-row__chevron" aria-hidden="true" />}
    </ChromeButton>
  );
}

function SwitchRow({
  icon,
  label,
  hint,
  on,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <ChromeButton
      className="omg-row"
      role="switch"
      aria-checked={on}
      aria-label={hint ? `${label}. ${hint}` : label}
      onClick={() => onToggle(!on)}
    >
      <span className="omg-row__icon">{icon}</span>
      <span className="omg-row__text">
        <span className="omg-row__label">{label}</span>
        {hint && (
          <span className="omg-row__hint" aria-hidden="true">
            {hint}
          </span>
        )}
      </span>
      <span className={on ? 'omg-switch omg-switch--on' : 'omg-switch'} aria-hidden="true" />
    </ChromeButton>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="omg-group" aria-label={title}>
      <h3 className="omg-section__title">{title}</h3>
      <div className="omg-group__rows">{children}</div>
    </section>
  );
}

/**
 * Every session action, grouped (Input, View, Clipboard and files, Sound, Session) with the
 * most used first. On/off settings are switches that apply at once and keep the sheet open;
 * Disconnect sits apart and asks for a second tap.
 */
export function MoreSheet(p: MoreSheetProps) {
  const [confirmExit, setConfirmExit] = useState(false);
  useEffect(() => {
    if (!confirmExit) return;
    const t = setTimeout(() => setConfirmExit(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [confirmExit]);
  const t = sessionStrings.more;
  const a = buildSessionActions(p.context);
  const run = (x: SessionAction) => () => x.onRun();
  const sw = (x: SessionAction, label: string, hint?: string) => (
    <SwitchRow
      icon={x.icon}
      label={label}
      {...(hint ? { hint } : {})}
      on={x.pressed ?? false}
      onToggle={() => x.onRun()}
    />
  );
  const tog = (key: keyof MoreToggles, icon: ReactNode, label: string, hint?: string) => (
    <SwitchRow
      icon={icon}
      label={label}
      {...(hint ? { hint } : {})}
      on={p.toggles[key]}
      onToggle={(on) => p.onToggle(key, on)}
    />
  );

  return (
    <Sheet title={t.title} onClose={p.onClose} className="omg-sheet--more">
      {p.reconnectToApply && (
        <div className="omg-more__notice">
          <ChromeButton className="omg-row" onClick={p.onReconnect}>
            <span className="omg-row__text">
              <span className="omg-row__label">{t.reconnectToApply}</span>
              <span className="omg-row__hint" aria-hidden="true">
                {t.reconnectToApplyHint}
              </span>
            </span>
          </ChromeButton>
        </div>
      )}
      <Group title={t.groups.input}>
        <SwitchRow
          icon={<IconEye off={false} />}
          label={t.viewOnly}
          hint={t.viewOnlyHint}
          on={p.viewOnly}
          onToggle={() => a['view-only'].onRun()}
        />
        {sw(a.keyboard, t.keyboard, t.keyboardHint)}
        {sw(a['extra-keys'], t.extraKeys, t.extraKeysHint)}
        <Row
          icon={a.pointer.icon}
          label={t.pointerMode}
          hint={t.tapToSwitch(a.pointer.label)}
          onClick={run(a.pointer)}
        />
        <Row icon={a.combos.icon} label={t.keyCombos} onClick={run(a.combos)} sheet />
        <Row
          icon={a['key-sets'].icon}
          label={a['key-sets'].name}
          onClick={run(a['key-sets'])}
          sheet
        />
        {a['ctrl-alt-del'].available && (
          <Row
            icon={a['ctrl-alt-del'].icon}
            label="Ctrl+Alt+Del"
            hint={t.sendNow}
            onClick={run(a['ctrl-alt-del'])}
          />
        )}
        {tog('naturalScroll', <IconScroll />, t.naturalScroll)}
        {p.pointerMode === 'trackpad' && tog('tapDrag', <IconDrag />, t.tapDrag)}
        {tog('largeCursor', <IconCursorLarge />, t.largeCursor)}
        {tog('textInputBar', <IconTextBar />, t.textInputBar)}
        <Row
          icon={a.options.icon}
          label={t.inputOptions}
          hint={t.optionsHint}
          onClick={run(a.options)}
          sheet
        />
      </Group>

      <Group title={t.groups.view}>
        <Row icon={a.view.icon} label={t.viewAndZoom} onClick={run(a.view)} sheet />
        <Row icon={a['zoom-reset'].icon} label={t.resetZoom} onClick={run(a['zoom-reset'])} />
        {tog('split', <IconSplit />, t.splitLayout, t.splitLayoutHint)}
        {tog('immersive', <IconFullscreen />, t.immersive, t.immersiveHint)}
        <Row
          icon={a.view.icon}
          label={t.quality(sessionStrings.options.qualityOptions[p.quality])}
          hint={t.qualityHint}
          onClick={() => p.onQuality(next(QUALITIES, p.quality))}
        />
      </Group>

      {p.terminal && (
        <Group title={t.groups.terminal}>
          {p.terminal.fontSize !== null && (
            <div className="omg-row omg-row--stepper" role="group" aria-label={t.fontSize}>
              <span className="omg-row__text">
                <span className="omg-row__label">{t.fontSize}</span>
                <span className="omg-row__hint">{t.points(p.terminal.fontSize)}</span>
              </span>
              <ChromeButton
                className="omg-btn--ghost"
                aria-label={t.fontSmaller}
                onClick={() => p.terminal?.onFontStep(-1)}
              >
                −
              </ChromeButton>
              <ChromeButton
                className="omg-btn--ghost"
                aria-label={t.fontLarger}
                onClick={() => p.terminal?.onFontStep(1)}
              >
                +
              </ChromeButton>
            </div>
          )}
          {p.terminal.colorScheme !== null && (
            <Row
              icon={a.view.icon}
              label={t.colorScheme}
              hint={t.colorSchemeName(p.terminal.colorScheme)}
              onClick={() => p.terminal?.onNextScheme()}
            />
          )}
        </Group>
      )}

      <Group title={t.groups.clipFiles}>
        <Row icon={a.paste.icon} label={t.paste} hint={t.pasteHint} onClick={run(a.paste)} />
        <Row
          icon={a.clipboard.icon}
          label={t.clipboard}
          hint={t.clipboardHint}
          onClick={run(a.clipboard)}
          sheet
        />
        <Row
          icon={a['type-clipboard'].icon}
          label={t.typeClipboard}
          hint={t.asKeystrokes}
          onClick={run(a['type-clipboard'])}
        />
        <Row
          icon={a.files.icon}
          label={t.files}
          hint={
            (a.files.badge ?? 0) > 0
              ? t.running(a.files.badge ?? 0)
              : p.hasFilesystem
                ? t.browseRemote
                : t.sendOrReceive
          }
          {...(a.files.badge ? { badge: a.files.badge } : {})}
          onClick={run(a.files)}
          sheet
        />
      </Group>

      <Group title={t.groups.sound}>
        <SwitchRow
          icon={a.sound.icon}
          label={t.sound}
          hint={p.audio === 'off' ? t.audioNotRequested : p.audioActive ? t.soundHint : t.noAudio}
          on={!(a.sound.pressed ?? false)}
          onToggle={() => a.sound.onRun()}
        />
        <Row
          icon={<IconVolume muted={p.audio !== 'on'} />}
          label={t.audioMode(sessionStrings.options.audioOptions[p.audio])}
          hint={t.audioModeHint}
          onClick={() => p.onAudio(next(AUDIO_MODES, p.audio))}
        />
        {a.mic.available ? (
          <SwitchRow
            icon={a.mic.icon}
            label={t.microphone}
            hint={p.context.micLive ? t.microphoneLive : t.microphoneHint}
            on={a.mic.pressed ?? false}
            onToggle={() => a.mic.onRun()}
          />
        ) : null}
      </Group>

      <Group title={t.groups.session}>
        <Row
          icon={<IconToolbar />}
          label={t.toolbarButtons}
          hint={t.toolbarButtonsHint}
          onClick={p.onEditToolbar}
          sheet
        />
        {p.onShare && (
          <Row
            icon={a.view.icon}
            label={t.shareSession}
            hint={t.shareSessionHint}
            onClick={p.onShare}
            sheet
          />
        )}
        <Row
          icon={a.info.icon}
          label={t.sessionInfo}
          hint={t.infoHint}
          onClick={run(a.info)}
          sheet
        />
        {a.back.available && (
          <Row
            icon={a.back.icon}
            label={t.backToConnections}
            hint={t.keepOpen}
            onClick={run(a.back)}
          />
        )}
      </Group>

      <div className="omg-more__danger">
        <ChromeButton
          className={
            confirmExit ? 'omg-row omg-row--danger omg-row--confirm' : 'omg-row omg-row--danger'
          }
          aria-label={confirmExit ? t.tapAgain : `${t.disconnect}. ${t.disconnectHint}`}
          onClick={() => {
            if (confirmExit) a.disconnect.onRun();
            else setConfirmExit(true);
          }}
        >
          <span className="omg-row__icon">
            <IconPower />
          </span>
          <span className="omg-row__text">
            <span className="omg-row__label">{confirmExit ? t.tapAgain : t.disconnect}</span>
            {!confirmExit && (
              <span className="omg-row__hint" aria-hidden="true">
                {t.disconnectHint}
              </span>
            )}
          </span>
        </ChromeButton>
      </div>
    </Sheet>
  );
}
