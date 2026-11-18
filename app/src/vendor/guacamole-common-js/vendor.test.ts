import { describe, expect, it } from 'vitest';
import Guacamole from './index.js';

describe('vendored guacamole-common-js', () => {
  it('exports the Guacamole namespace at the vendored version', () => {
    expect(Guacamole.API_VERSION).toBe('1.6.0');
    expect(typeof Guacamole.Client).toBe('function');
    expect(typeof Guacamole.WebSocketTunnel).toBe('function');
    expect(Guacamole.Tunnel.State.OPEN).toBe(1);
    expect(Guacamole.Status.Code.CLIENT_UNAUTHORIZED).toBe(0x0301);
  });

  it('parses an instruction with Guacamole.Parser', () => {
    const parser = new Guacamole.Parser();
    const received: { opcode: string; args: string[] }[] = [];
    parser.oninstruction = (opcode: string, args: string[]) => {
      received.push({ opcode, args });
    };

    parser.receive('4.sync,8.12345678;');

    expect(received).toEqual([{ opcode: 'sync', args: ['12345678'] }]);
  });

  it('parses instructions split across packets', () => {
    const parser = new Guacamole.Parser();
    const received: [string, string[]][] = [];
    parser.oninstruction = (opcode, args) => received.push([opcode, args]);

    parser.receive('4.size,1.0,4.10');
    parser.receive('24,3.768;4.sync,1.1;');

    expect(received).toEqual([
      ['size', ['0', '1024', '768']],
      ['sync', ['1']],
    ]);
  });

  it('round-trips through Parser.toInstruction', () => {
    expect(Guacamole.Parser.toInstruction(['sync', 12345678])).toBe('4.sync,8.12345678;');
  });
});
