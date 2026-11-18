import { describe, expect, it } from 'vitest';
import { buildTunnelConnectString, buildTunnelUrls, optimalDisplaySize } from './tunnel.ts';

describe('buildTunnelConnectString', () => {
  it('matches the web client parameter order and encoding', () => {
    const s = buildTunnelConnectString({
      token: 'AB+/=',
      dataSource: 'postgresql',
      id: 'conn 1',
      type: 'c',
      width: 1920.7,
      height: 1080.2,
      dpi: 192.9,
      timezone: 'Europe/London',
      audioMimetypes: ['audio/L16;rate=44100,channels=2', 'audio/L8'],
      videoMimetypes: [],
      imageMimetypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    expect(s).toBe(
      'token=AB%2B%2F%3D&GUAC_DATA_SOURCE=postgresql&GUAC_ID=conn%201&GUAC_TYPE=c' +
        '&GUAC_WIDTH=1920&GUAC_HEIGHT=1080&GUAC_DPI=192&GUAC_TIMEZONE=Europe%2FLondon' +
        '&GUAC_AUDIO=audio%2FL16%3Brate%3D44100%2Cchannels%3D2&GUAC_AUDIO=audio%2FL8' +
        '&GUAC_IMAGE=image%2Fpng&GUAC_IMAGE=image%2Fjpeg&GUAC_IMAGE=image%2Fwebp',
    );
  });

  it('omits the timezone and media types when not given', () => {
    expect(
      buildTunnelConnectString({
        token: 't',
        dataSource: 'd',
        id: '4',
        type: 'g',
        width: 800,
        height: 600,
        dpi: 96,
      }),
    ).toBe(
      'token=t&GUAC_DATA_SOURCE=d&GUAC_ID=4&GUAC_TYPE=g&GUAC_WIDTH=800&GUAC_HEIGHT=600&GUAC_DPI=96',
    );
  });
});

describe('optimalDisplaySize', () => {
  it('scales by devicePixelRatio and floors, like ManagedClient', () => {
    expect(optimalDisplaySize(390, 844, 3)).toEqual({ width: 1170, height: 2532, dpi: 288 });
    expect(optimalDisplaySize(100.5, 50.5, 1.5)).toEqual({ width: 150, height: 75, dpi: 144 });
    expect(optimalDisplaySize(800, 600)).toEqual({ width: 800, height: 600, dpi: 96 });
    expect(optimalDisplaySize(800, 600, 0)).toEqual({ width: 800, height: 600, dpi: 96 });
  });
});

describe('buildTunnelUrls', () => {
  it('builds absolute ws(s) and http(s) URLs', () => {
    expect(buildTunnelUrls('https://guac.example/guacamole')).toEqual({
      websocket: 'wss://guac.example/guacamole/websocket-tunnel',
      http: 'https://guac.example/guacamole/tunnel',
    });
    expect(buildTunnelUrls('http://guac.example:8080')).toEqual({
      websocket: 'ws://guac.example:8080/websocket-tunnel',
      http: 'http://guac.example:8080/tunnel',
    });
  });
});
