import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sessionEs } from '../i18n/session.es.ts';
import { SessionDefaultsEditor } from './SessionDefaultsEditor.tsx';
import { GESTURES, gestureForKey, gestureKeys } from '../session/gestures.ts';
import { InputMenu } from '../session/InputMenu.tsx';
import { DEFAULT_SESSION_SETTINGS } from '../session/settings.ts';
import { SETTING_DESCRIPTORS, descriptorsIn, matchesGesture } from '../session/settingsSchema.ts';
import { sessionStringsEn } from '../session/sessionStrings.ts';
import { buildSessionActions, type SessionActionContext } from '../session/sessionActions.tsx';

function editor(query: string, values = DEFAULT_SESSION_SETTINGS): string {
  return renderToStaticMarkup(
    <SessionDefaultsEditor
      values={values}
      changed={new Set()}
      query={query}
      onQuery={() => undefined}
      onChange={() => undefined}
      onResetSection={() => undefined}
      onResetAll={() => undefined}
      onEditList={() => undefined}
    />,
  );
}

describe('gesture catalogue (Settings › Gestures)', () => {
  it('has unique ids, and each setting key belongs to at most one gesture', () => {
    const ids = GESTURES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = GESTURES.flatMap(gestureKeys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('owns every setting of the gestures section, and only those', () => {
    const owned = GESTURES.flatMap(gestureKeys).sort();
    expect(owned).toEqual(
      descriptorsIn('gestures')
        .map((d) => d.key)
        .sort(),
    );
    for (const k of owned) expect(gestureForKey(k), k).toBeDefined();
  });

  it('toggles are switches; always-on gestures have no toggle and give a reason', () => {
    for (const g of GESTURES) {
      if (g.toggle) {
        const d = SETTING_DESCRIPTORS.find((x) => x.key === g.toggle);
        expect(d?.control, g.id).toBe('switch');
        expect(g.alwaysOn, g.id).toBe(false);
      }
      const why = (sessionStringsEn.gestures.why as Record<string, string>)[g.id];
      if (g.alwaysOn) {
        expect(g.toggle, g.id).toBeUndefined();
        expect(why, g.id).toBeTruthy();
      } else {
        expect(why, g.id).toBeUndefined();
        // Without a switch, the first setting must be a choice that includes "off".
        if (!g.toggle) {
          const d = SETTING_DESCRIPTORS.find((x) => x.key === g.settings[0]);
          expect(d?.control === 'choice' && d.options.includes('off'), g.id).toBe(true);
        }
      }
    }
  });

  it('new gesture switches default to on (behaviour unchanged for existing users)', () => {
    const added = [
      'gestureLongPress',
      'gestureTwoFingerTap',
      'gestureThreeFingerTap',
      'gestureZoomReset',
      'gesturePinchZoom',
      'sheetSwipeClose',
      'keySetLongPress',
      'pasteLongPress',
    ] as const;
    const toggles = GESTURES.map((g) => g.toggle);
    for (const k of added) {
      expect(toggles, k).toContain(k);
      expect(DEFAULT_SESSION_SETTINGS[k], k).toBe(true);
    }
  });

  it('holding Paste types the clipboard only while its switch is on', () => {
    const ctx = {
      pointerMode: 'direct',
      keyboardActive: false,
      keyBarVisible: false,
      audioMuted: false,
      viewOnly: false,
      showCtrlAltDel: false,
      canMinimize: false,
      pasteHint: 'Paste',
      runningTransfers: 0,
    } as const;
    const noop = () => undefined;
    const handlers = Object.fromEntries(
      [
        'onTogglePointerMode',
        'onToggleKeyboard',
        'onToggleKeyBar',
        'onPaste',
        'onTypeClipboard',
        'onView',
        'onZoomReset',
        'onZoom',
        'onCombos',
        'onKeySets',
        'onCtrlAltDel',
        'onClipboard',
        'onFiles',
        'onToggleAudio',
        'onToggleViewOnly',
        'onOptions',
        'onInfo',
        'onMinimize',
        'onDisconnect',
      ].map((k) => [k, noop]),
    ) as unknown as Omit<SessionActionContext, keyof typeof ctx>;
    expect(buildSessionActions({ ...ctx, ...handlers }).paste.onLongPress).toBeDefined();
    const off = buildSessionActions({ ...ctx, ...handlers, pasteLongPress: false }).paste;
    expect(off.onLongPress).toBeUndefined();
    expect(off.name).toBe('Paste');
  });

  it('every gesture has a name and description in English and Spanish', () => {
    for (const g of GESTURES) {
      expect(sessionStringsEn.gestures.items[g.id].name, g.id).toBeTruthy();
      expect(sessionStringsEn.gestures.items[g.id].desc, g.id).toBeTruthy();
      expect(sessionEs.gestures.items[g.id].name, g.id).toBeTruthy();
      expect(sessionEs.gestures.items[g.id].desc, g.id).toBeTruthy();
      expect(sessionEs.gestures.items[g.id].name, g.id).not.toBe(
        sessionStringsEn.gestures.items[g.id].name,
      );
    }
  });

  it('the Settings screen shows each gesture once with an animation, hidden from readers', () => {
    const html = editor('');
    for (const g of GESTURES) {
      expect(html.split(`data-gesture="${g.id}"`).length - 1, g.id).toBe(1);
    }
    const figures = html.match(/<svg class="omg-gesture-fig"[^>]*>/g) ?? [];
    expect(figures.length).toBe(GESTURES.length);
    for (const f of figures) expect(f).toContain('aria-hidden="true"');
  });

  it('the in-session options show every gesture too', () => {
    const html = renderToStaticMarkup(
      <InputMenu
        settings={DEFAULT_SESSION_SETTINGS}
        touchSupport={0}
        onChange={() => undefined}
        onEditList={() => undefined}
        onClose={() => undefined}
      />,
    );
    for (const g of GESTURES) expect(html, g.id).toContain(`data-gesture="${g.id}"`);
  });

  it('search finds gestures by name and by their settings', () => {
    const pinch = GESTURES.find((g) => g.id === 'pinch');
    const tap = GESTURES.find((g) => g.id === 'tap');
    if (!pinch || !tap) throw new Error('missing gestures');
    expect(matchesGesture(pinch, 'pinch', DEFAULT_SESSION_SETTINGS)).toBe(true);
    expect(matchesGesture(pinch, 'terminal font', DEFAULT_SESSION_SETTINGS)).toBe(true);
    expect(matchesGesture(tap, 'tolerance', DEFAULT_SESSION_SETTINGS)).toBe(true);
    expect(matchesGesture(tap, 'clipboard', DEFAULT_SESSION_SETTINGS)).toBe(false);
    const html = editor('three-finger');
    expect(html).toContain('data-gesture="threeFingerTap"');
    expect(html).not.toContain('data-gesture="pinch"');
    expect(html).toContain('data-setting-key="gestureThreeFingerTap"');
  });

  it('warns when trackpad mode is left without a one-finger drag', () => {
    const warning = sessionStringsEn.gestures.noTrackpadDrag;
    expect(editor('')).not.toContain(warning);
    expect(
      editor('', { ...DEFAULT_SESSION_SETTINGS, gestureLongPress: false, tapDrag: false }),
    ).toContain(warning);
  });
});
