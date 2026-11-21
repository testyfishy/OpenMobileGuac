import { describe, expect, it } from 'vitest';
import {
  TotpParseError,
  decodeBase32,
  encodeBase32,
  hotp,
  parseTotpInput,
  totpFromEnrolmentField,
  secondsRemaining,
  serializeTotp,
  totpAt,
  totpCounter,
  waitForFreshCode,
  type TotpAlgorithm,
} from './totp.ts';

const ascii = (s: string) => new TextEncoder().encode(s);

// RFC 6238 Appendix B: each hash uses its own seed length.
const SEEDS: Record<TotpAlgorithm, Uint8Array> = {
  SHA1: ascii('12345678901234567890'),
  SHA256: ascii('12345678901234567890123456789012'),
  SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
};

const VECTORS: [number, string, string, string][] = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];

describe('RFC 4226 HOTP', () => {
  it('matches Appendix D', async () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    for (let i = 0; i < expected.length; i++) {
      expect(await hotp(SEEDS.SHA1, i, 6, 'SHA1')).toBe(expected[i]);
    }
  });
});

describe('RFC 6238 TOTP', () => {
  it.each(VECTORS)('T=%d', async (t, sha1, sha256, sha512) => {
    const ms = t * 1000;
    const p = { digits: 8, period: 30 };
    expect(await totpAt({ ...p, secret: SEEDS.SHA1, algorithm: 'SHA1' }, ms)).toBe(sha1);
    expect(await totpAt({ ...p, secret: SEEDS.SHA256, algorithm: 'SHA256' }, ms)).toBe(sha256);
    expect(await totpAt({ ...p, secret: SEEDS.SHA512, algorithm: 'SHA512' }, ms)).toBe(sha512);
  });

  it('6-digit codes are the last six digits', async () => {
    expect(
      await totpAt({ secret: SEEDS.SHA1, algorithm: 'SHA1', digits: 6, period: 30 }, 59_000),
    ).toBe('287082');
  });

  it('counts time steps and remaining seconds', () => {
    expect(totpCounter(59_000, 30)).toBe(1);
    expect(secondsRemaining(59_000, 30)).toBe(1);
    expect(secondsRemaining(60_000, 30)).toBe(30);
  });
});

describe('Base32', () => {
  it('round-trips and is lenient about case, spaces and padding', () => {
    const b32 = encodeBase32(SEEDS.SHA1);
    expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(decodeBase32(b32.toLowerCase().replace(/(.{4})/g, '$1 ') + '====')).toEqual(SEEDS.SHA1);
  });

  it('rejects other characters', () => {
    expect(() => decodeBase32('ABC1')).toThrow(TotpParseError);
  });
});

describe('parseTotpInput', () => {
  it('accepts a bare secret with defaults or field overrides', () => {
    const p = parseTotpInput('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(p).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
    const o = parseTotpInput('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', {
      algorithm: 'sha256',
      digits: '8',
      period: 60,
    });
    expect(o).toMatchObject({ algorithm: 'SHA256', digits: 8, period: 60 });
  });

  it('parses otpauth URIs including issuer and account', () => {
    const p = parseTotpInput(
      'otpauth://totp/Example:user@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&algorithm=SHA512&digits=8&period=45',
    );
    expect(p).toMatchObject({
      algorithm: 'SHA512',
      digits: 8,
      period: 45,
      issuer: 'Example',
      account: 'user@example.com',
    });
    expect(p.secret).toEqual(SEEDS.SHA1);
  });

  it('keeps a label with a malformed % escape as written', () => {
    const p = parseTotpInput(
      'otpauth://totp/Acme:%E0%A4%A?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
    expect(p).toMatchObject({ issuer: 'Acme', account: '%E0%A4%A' });
    expect(p.secret).toEqual(SEEDS.SHA1);
  });

  it('round-trips through the stored form', () => {
    const p = parseTotpInput('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { digits: 7 });
    const again = parseTotpInput(serializeTotp(p));
    expect(again).toMatchObject({ algorithm: 'SHA1', digits: 7, period: 30 });
    expect(again.secret).toEqual(p.secret);
  });

  it('rejects bad input with a reason', () => {
    const reason = (s: string) => {
      try {
        parseTotpInput(s);
        return 'ok';
      } catch (e) {
        return e instanceof TotpParseError ? e.reason : 'other';
      }
    };
    expect(reason('')).toBe('empty');
    expect(reason('not base32!')).toBe('base32');
    expect(reason('GEZDG')).toBe('short');
    expect(reason('otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')).toBe('uri');
    expect(reason('otpauth://totp/x')).toBe('uri');
    expect(reason('otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=9')).toBe(
      'digits',
    );
    expect(reason('otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=MD5')).toBe(
      'algorithm',
    );
  });
});

describe('waitForFreshCode', () => {
  it('waits for the next step after a code was used', () => {
    expect(waitForFreshCode(undefined, 10_000, 30)).toBe(0);
    expect(waitForFreshCode(0, 10_000, 30)).toBe(20_000);
    expect(waitForFreshCode(0, 30_000, 30)).toBe(0);
  });
});

describe('totpFromEnrolmentField (Guacamole 1.6.0 AuthenticationCodeField, AUDIT #4)', () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  it('uses digits, period and mode from the field', () => {
    const p = totpFromEnrolmentField({
      secret,
      digits: 8,
      period: 60,
      mode: 'SHA256',
      issuer: 'Apache Guacamole',
      username: 'testuser',
    });
    expect([p.digits, p.period, p.algorithm]).toEqual([8, 60, 'SHA256']);
    expect(p.issuer).toBe('Apache Guacamole');
    expect(p.account).toBe('testuser');
    expect(serializeTotp(p)).toMatch(/algorithm=SHA256&digits=8&period=60/);
  });

  it('prefers the server key URI, which is its complete description', () => {
    const p = totpFromEnrolmentField({
      secret,
      digits: 6,
      keyUri: `otpauth://totp/Guac:testuser?secret=${secret}&issuer=Guac&algorithm=SHA512&digits=7&period=45`,
    });
    expect([p.digits, p.period, p.algorithm]).toEqual([7, 45, 'SHA512']);
  });

  it('falls back to the fields when the key URI is unusable, and to defaults when absent', () => {
    expect(totpFromEnrolmentField({ secret, keyUri: 'nonsense', digits: '8' }).digits).toBe(8);
    const d = totpFromEnrolmentField({ secret });
    expect([d.digits, d.period, d.algorithm]).toEqual([6, 30, 'SHA1']);
    expect(totpFromEnrolmentField({ secret, mode: 'sha512' }).algorithm).toBe('SHA512');
  });

  it('rejects a field without a key', () => {
    expect(() => totpFromEnrolmentField({ digits: 6 })).toThrow(TotpParseError);
  });
});
