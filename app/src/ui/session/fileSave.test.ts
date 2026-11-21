import { describe, expect, it, vi } from 'vitest';

const downloadFile = vi.fn<(opts: Record<string, unknown>) => Promise<{ path: string }>>(
  async () => ({ path: 'x' }),
);

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE', External: 'EXTERNAL' },
  Filesystem: {
    downloadFile: (opts: Record<string, unknown>) => downloadFile(opts),
    addListener: async () => ({ remove: async () => undefined }),
    mkdir: async () => undefined,
    stat: async () => ({ size: 3 }),
    checkPermissions: async () => ({ publicStorage: 'granted' }),
  },
}));
vi.mock('./platform.ts', () => ({ isPluginAvailable: () => true }));

const { createFileReceiver } = await import('./fileSave.ts');

describe('stream-endpoint download (pre-release review R3)', () => {
  it('asks the native download not to follow redirects with the token header', async () => {
    const receiver = createFileReceiver({
      mode: () => 'downloads',
      streamRequest: () => ({
        url: 'https://guac.example/guacamole/api/session/tunnels/t/streams/1/f',
        headers: { 'Guacamole-Token': 'tok' },
      }),
    });
    const http = receiver.http(
      { filename: 'f', mimetype: 'text/plain', print: false, streamIndex: 1 },
      () => undefined,
    );
    expect(http).not.toBeNull();
    expect(await http?.done).toEqual({ ok: true, bytes: 3 });
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ disableRedirects: true, headers: { 'Guacamole-Token': 'tok' } }),
    );
  });
});
