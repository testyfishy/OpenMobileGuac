/**
 * Connection parameters over argument-value streams (`argv`).
 *
 * - Answering a `required` prompt: one stream per parameter,
 *   `client.createArgumentValueStream('text/plain', name)`, the value, then end, exactly as
 *   the web client's `ManagedClient.sendArguments` (1.6.0). The value is written as
 *   `TextEncoder` UTF-8 bytes (`writeTextStream`): same wire format, without the library
 *   StringWriter's mis-encoding of characters above U+FFFF.
 * - Values the server reports (`client.onargv(stream, mimetype, name)`): e.g. SSH sends
 *   `color-scheme`, `font-name` and `font-size` (guacamole-server `ssh/argv.c`
 *   `guac_ssh_send_current_argv`), and echoes values after a change for parameters
 *   registered with `GUAC_ARGV_OPTION_ECHO` (libguac `argv.c`). Like `ManagedClient.onargv` +
 *   `ManagedArgument.getInstance`, only `text/plain` is read; an argument stream is then
 *   opened at once for that name, and the parameter counts as changeable only if the
 *   server acks it with success ("Ready for updated parameter.", libguac `argv.c`). The
 *   stream is used once: a later value is written to it and it is ended. If the server
 *   echoes the new value back, that opens a fresh stream.
 *
 * Values are never logged. Secret-looking names are not kept at all.
 */

import Guacamole from '../../vendor/guacamole-common-js';
import { isSecretParam } from '../../session/credentials/requiredParams.ts';
import { readTextStream, writeTextStream } from './clipboardText.ts';

type GuacClient = InstanceType<typeof Guacamole.Client>;
type OutputStream = InstanceType<typeof Guacamole.OutputStream>;

/** Send each value on its own argument-value stream. */
export function sendArgumentValues(
  client: GuacClient,
  values: readonly { name: string; value: string }[],
): void {
  for (const { name, value } of values) {
    writeTextStream(client.createArgumentValueStream('text/plain', name), value);
  }
}

export interface MutableArgument {
  readonly name: string;
  readonly value: string;
}

interface Entry {
  name: string;
  value: string;
  stream: OutputStream;
  pending: boolean;
}

/** Tracks the changeable connection parameters the server reported in this session. */
export class ArgvTracker {
  private readonly entries = new Map<string, Entry>();
  private readonly onChange: () => void;
  private list: readonly MutableArgument[] = [];

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  install(client: GuacClient): void {
    client.onargv = (stream, mimetype, name) => {
      if (mimetype !== 'text/plain' || isSecretParam(name)) return;
      readTextStream(stream, (value) => {
        const out = client.createArgumentValueStream('text/plain', name);
        out.onack = (status) => {
          out.onack = null;
          if (status.isError()) return;
          this.entries.set(name, { name, value, stream: out, pending: false });
          this.rebuild();
        };
      });
    };
  }

  reset(): void {
    this.entries.clear();
    this.rebuild();
  }

  arguments(): readonly MutableArgument[] {
    return this.list;
  }

  /** Change a parameter. Returns false if it is not (or no longer) changeable. */
  setValue(name: string, value: string): boolean {
    const e = this.entries.get(name);
    if (!e || e.pending) return false;
    if (value === e.value) return true;
    writeTextStream(e.stream, value);
    e.pending = true;
    this.entries.delete(name);
    this.rebuild();
    return true;
  }

  private rebuild(): void {
    this.list = [...this.entries.values()]
      .map((e) => ({ name: e.name, value: e.value }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.onChange();
  }
}
