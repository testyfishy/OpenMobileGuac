/**
 * Standalone entry for the session harness (dev only, see harness.html). Works without the
 * app shell. `?tunnel=demo` drives the session with the demo desktop (its "Input test"
 * window shows what arrives); `?tunnel=features` uses FeatureTunnel (credential prompt,
 * files, print job, audio; `&prompt=0` skips the prompt, `&fs=0`
 * exposes no filesystem); otherwise the ScribbleTunnel log
 * panel is used. Every
 * instruction sent to the tunnel is also recorded in `window.__omgSent` for automated
 * checks.
 */

import { createRoot } from 'react-dom/client';
import type { TunnelLike } from '../../../core/transport/TunnelLike.ts';
import { DemoTunnel } from '../../../demo/DemoTunnel.ts';
import { SessionHarness } from './SessionHarness.tsx';

declare global {
  interface Window {
    __omgSent?: string[][];
    /** The current tunnel, e.g. to inject `set 0 multi-touch 10` for touch pass-through. */
    __omgTunnel?: TunnelLike;
  }
}

function recording(t: TunnelLike): TunnelLike {
  window.__omgTunnel = t;
  const sent: string[][] = (window.__omgSent = window.__omgSent ?? []);
  const original = t.sendMessage.bind(t);
  t.sendMessage = (...elements: unknown[]) => {
    sent.push(elements.map(String));
    original(...elements);
  };
  return t;
}

const params = new URLSearchParams(location.search);
const demo = params.get('tunnel') === 'demo';
const features = params.get('tunnel') === 'features';
const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <SessionHarness
      createTunnel={demo ? () => recording(new DemoTunnel()) : undefined}
      features={
        features
          ? {
              requireCredentials: params.get('prompt') !== '0',
              filesystem: params.get('fs') !== '0',
            }
          : undefined
      }
      onTunnel={features ? (t) => void recording(t) : undefined}
    />,
  );
}
