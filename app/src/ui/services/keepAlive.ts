import { Capacitor } from '@capacitor/core';
import {
  ForegroundService,
  Importance,
  type ServiceType,
} from '@capawesome-team/capacitor-android-foreground-service';
import type { Disposable } from './native.ts';

/**
 * Android foreground service that keeps open sessions connected in the background
 * ("Keep sessions connected in the background", off by default). Uses
 * `@capawesome-team/capacitor-android-foreground-service` (MIT). The service type is
 * `specialUse` (see docs/release.md for the Play Console declaration); the manifest declares
 * the service, its type, the subtype property and the permissions.
 *
 * Every call is a no-op off Android and swallows plugin errors: a missing native piece must
 * never break a session.
 */

/** `ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE` (Android 14, API 34). */
const FOREGROUND_SERVICE_TYPE_SPECIAL_USE = 0x40000000;
const NOTIFICATION_ID = 4711;
const CHANNEL_ID = 'sessions';
const BUTTON_DISCONNECT_ALL = 1;
/** Monochrome status-bar icon in `android/app/src/main/res/drawable`. */
const SMALL_ICON = 'ic_stat_session';

export interface KeepAliveTexts {
  readonly title: string;
  readonly body: string;
  readonly disconnectAll: string;
  readonly channelName: string;
  readonly channelDescription: string;
}

export function isAndroid(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export async function notificationPermission(): Promise<NotificationPermission> {
  if (!isAndroid()) return 'unavailable';
  try {
    const s = await ForegroundService.checkPermissions();
    return s.display === 'granted' ? 'granted' : s.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unavailable';
  }
}

/** Android 13+: the POST_NOTIFICATIONS runtime prompt (granted at once on older versions). */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isAndroid()) return 'unavailable';
  try {
    const s = await ForegroundService.requestPermissions();
    return s.display === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

let channelReady = false;
let running = false;

/** Whether the service was started (and not stopped since). */
export function keepAliveRunning(): boolean {
  return running;
}

/** Start the service, or update its notification (session count) if it runs. */
export async function startOrUpdateKeepAlive(t: KeepAliveTexts): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    if (!channelReady) {
      await ForegroundService.createNotificationChannel({
        id: CHANNEL_ID,
        name: t.channelName,
        description: t.channelDescription,
        importance: Importance.Low,
      });
      channelReady = true;
    }
    const options = {
      id: NOTIFICATION_ID,
      title: t.title,
      body: t.body,
      smallIcon: SMALL_ICON,
      buttons: [{ id: BUTTON_DISCONNECT_ALL, title: t.disconnectAll }],
      silent: true,
      notificationChannelId: CHANNEL_ID,
      serviceType: FOREGROUND_SERVICE_TYPE_SPECIAL_USE as ServiceType,
    };
    if (running) await ForegroundService.updateForegroundService(options);
    else await ForegroundService.startForegroundService(options);
    running = true;
    return true;
  } catch {
    running = false;
    return false;
  }
}

export async function stopKeepAlive(): Promise<void> {
  if (!isAndroid() || !running) return;
  running = false;
  await ForegroundService.stopForegroundService().catch(() => undefined);
}

/** The notification's "Disconnect all" button. */
export function onDisconnectAllPressed(cb: () => void): Disposable {
  if (!isAndroid()) return { dispose: () => undefined };
  let removed = false;
  let handle: { remove: () => Promise<void> } | undefined;
  void ForegroundService.addListener('buttonClicked', (e) => {
    if (e.buttonId === BUTTON_DISCONNECT_ALL) cb();
  })
    .then((h) => {
      if (removed) void h.remove();
      else handle = h;
    })
    .catch(() => undefined);
  return {
    dispose: () => {
      removed = true;
      void handle?.remove().catch(() => undefined);
    },
  };
}
