import { describe, expect, it } from 'vitest';
import { TunnelTargetTypes } from '../../core/api/tunnel.ts';
import { makeConnectDataBuilder } from './connectData.ts';

describe('connect string media (Quality / Audio off)', () => {
  const build = makeConnectDataBuilder({
    getToken: () => 'tok',
    dataSource: 'postgresql',
    id: '1',
    type: TunnelTargetTypes.CONNECTION,
    timezone: undefined,
    media: () => ({
      audio: ['audio/L8', 'audio/L16'],
      video: [],
      image: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });

  it('advertises audio by default and none when audio is off', () => {
    const on = new URLSearchParams(build({ width: 1170, height: 2532, dpi: 298 }));
    expect(on.getAll('GUAC_AUDIO')).toEqual(['audio/L8', 'audio/L16']);
    expect([on.get('GUAC_WIDTH'), on.get('GUAC_HEIGHT'), on.get('GUAC_DPI')]).toEqual([
      '1170',
      '2532',
      '298',
    ]);
    const off = new URLSearchParams(build({ width: 390, height: 844, dpi: 96, audio: false }));
    expect(off.getAll('GUAC_AUDIO')).toEqual([]);
    // WebP is kept: guacd can use it for every layer and it is usually smaller than JPEG.
    expect(off.getAll('GUAC_IMAGE')).toContain('image/webp');
  });
});
