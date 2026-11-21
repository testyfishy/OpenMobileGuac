import {
  parseServerOptions,
  serverOptionsToJson,
  type ServerOptions,
} from '../settings/settingsModel.ts';

/** The part of `ProfileStore` that holds per-server options. */
export interface ServerOptionsStorage {
  getOptions(profileId: string): Promise<unknown>;
  setOptions(profileId: string, options: ReturnType<typeof serverOptionsToJson>): Promise<void>;
}

type Listener = (profileId: string, options: ServerOptions) => void;

const chains = new Map<string, Promise<unknown>>();
const listeners = new Set<Listener>();

/**
 * Changes only the fields in `patch`, on top of what is stored now, one write at a time per
 * server. Several screens and sections hold their own copy of a server's options; writing a
 * whole copy back would silently revert a field another one changed meanwhile.
 * Resolves with the stored result, which every subscriber also receives. A failed read
 * rejects without writing, so defaults never overwrite stored options.
 */
export function patchServerOptions(
  store: ServerOptionsStorage,
  profileId: string,
  patch: Partial<ServerOptions>,
): Promise<ServerOptions> {
  const previous = chains.get(profileId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const next: ServerOptions = {
        ...parseServerOptions(await store.getOptions(profileId)),
        ...patch,
      };
      await store.setOptions(profileId, serverOptionsToJson(next));
      for (const l of [...listeners]) {
        try {
          l(profileId, next);
        } catch {
          // One broken listener must not stop the others.
        }
      }
      return next;
    });
  chains.set(profileId, run);
  void run
    .finally(() => {
      if (chains.get(profileId) === run) chains.delete(profileId);
    })
    .catch(() => undefined);
  return run;
}

/** Called with the stored options after every `patchServerOptions`. Returns the unsubscribe. */
export function subscribeServerOptions(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
