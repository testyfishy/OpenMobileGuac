import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMEMBER_POLICY,
  MAX_DEVICE_ENTRIES,
  RequiredAnswerGuard,
  answerFor,
  entryKey,
  isCredentialRejection,
  isFresh,
  offersRemember,
  parseDeviceRecord,
  parseRememberPolicy,
  pickValues,
  policyTtlMs,
  serializeDeviceRecord,
  type RememberTarget,
  type RememberedEntry,
} from './rememberedParams.ts';

const T: RememberTarget = {
  server: 'https://guac.example/guacamole',
  dataSource: 'postgresql',
  type: 'c',
  identifier: '7',
};
const MIN = 60_000;

describe('remember policy', () => {
  it('defaults to "on this device" and parses only known values', () => {
    expect(DEFAULT_REMEMBER_POLICY).toBe('device');
    expect(parseRememberPolicy('device')).toBe('device');
    expect(parseRememberPolicy('15m')).toBe('15m');
    expect(parseRememberPolicy('forever')).toBe('device');
    expect(parseRememberPolicy(300)).toBe('device');
    expect(parseRememberPolicy(undefined)).toBe('device');
  });

  it('maps choices to time limits', () => {
    expect(policyTtlMs('never')).toBe(0);
    expect(policyTtlMs('5m')).toBe(5 * MIN);
    expect(policyTtlMs('15m')).toBe(15 * MIN);
    expect(policyTtlMs('1h')).toBe(60 * MIN);
    expect(policyTtlMs('app')).toBeNull();
    expect(policyTtlMs('device')).toBeNull();
  });

  it('offers the Remember box for every choice except never', () => {
    expect(offersRemember('never')).toBe(false);
    expect(offersRemember(null)).toBe(false);
    expect(offersRemember(undefined)).toBe(false);
    expect(offersRemember('5m')).toBe(true);
    expect(offersRemember('device')).toBe(true);
  });

  it('expires from the last use', () => {
    const e: RememberedEntry = { values: { password: 'x' }, at: 1_000_000 };
    expect(isFresh(e, '5m', 1_000_000 + 5 * MIN - 1)).toBe(true);
    expect(isFresh(e, '5m', 1_000_000 + 5 * MIN)).toBe(false);
    expect(isFresh(e, '1h', 1_000_000 + 59 * MIN)).toBe(true);
    expect(isFresh(e, 'app', 1_000_000 + 1e9)).toBe(true);
    expect(isFresh(e, 'never', 1_000_000)).toBe(false);
    // A clock that went backwards does not extend the time.
    expect(isFresh(e, '5m', 1_000_000 - 1)).toBe(false);
  });
});

describe('keys and answers', () => {
  it('keys by server address, data source, type, identifier and the set of names', () => {
    const k = entryKey(T, ['username', 'password']);
    expect(entryKey(T, ['password', 'username', 'password'])).toBe(k);
    expect(entryKey({ ...T, identifier: '8' }, ['username', 'password'])).not.toBe(k);
    expect(entryKey({ ...T, type: 'g' }, ['username', 'password'])).not.toBe(k);
    expect(entryKey({ ...T, dataSource: 'mysql' }, ['username', 'password'])).not.toBe(k);
    expect(entryKey({ ...T, server: 'https://other.example/' }, ['username', 'password'])).not.toBe(
      k,
    );
    expect(entryKey(T, ['password'])).not.toBe(k);
  });

  it('answers only when every requested name has a value (an empty one counts)', () => {
    const e: RememberedEntry = { values: { username: 'u', domain: '', password: 'p' }, at: 0 };
    expect(answerFor(e, ['username', 'domain', 'password'])).toEqual({
      username: 'u',
      domain: '',
      password: 'p',
    });
    expect(answerFor(e, ['username', 'gateway-password'])).toBeNull();
    expect(answerFor(e, [])).toBeNull();
  });

  it('keeps only the requested names', () => {
    expect(pickValues(['password', 'username'], { password: 'p', other: 'x' })).toEqual({
      password: 'p',
      username: '',
    });
  });
});

describe('device record', () => {
  it('round-trips and drops malformed parts', () => {
    const m = new Map<string, RememberedEntry>([
      ['a', { values: { password: 'p' }, at: 5 }],
      ['b', { values: { username: 'u', password: '' }, at: 9 }],
    ]);
    expect(parseDeviceRecord(serializeDeviceRecord(m))).toEqual(m);
    expect(parseDeviceRecord(null).size).toBe(0);
    expect(parseDeviceRecord('{not json').size).toBe(0);
    expect(parseDeviceRecord('[1,2]').size).toBe(0);
    const bad = parseDeviceRecord(
      JSON.stringify({
        v: 1,
        entries: {
          ok: { at: 1, values: { password: 'p', n: 3 } },
          noAt: { values: { password: 'p' } },
          noValues: { at: 1 },
          list: { at: 1, values: ['p'] },
        },
      }),
    );
    expect([...bad.keys()]).toEqual(['ok']);
    expect(bad.get('ok')?.values).toEqual({ password: 'p' });
  });

  it('keeps the most recently used entries when over the limit', () => {
    const m = new Map<string, RememberedEntry>();
    for (let i = 0; i < MAX_DEVICE_ENTRIES + 5; i++) m.set(`k${i}`, { values: {}, at: i });
    const back = parseDeviceRecord(serializeDeviceRecord(m));
    expect(back.size).toBe(MAX_DEVICE_ENTRIES);
    expect(back.has('k0')).toBe(false);
    expect(back.has(`k${MAX_DEVICE_ENTRIES + 4}`)).toBe(true);
  });
});

describe('RequiredAnswerGuard (loop safety)', () => {
  const NAMES = ['username', 'password'];
  const VALUES = { username: 'u', password: 'p' };

  it('tries remembered values first, at most once per field and attempt', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    expect(g.onRequired(NAMES)).toEqual({ action: 'recall', forget: [] });
    g.answeredAutomatically(NAMES, VALUES);
    // The server asks again for a field it was just given: the value was rejected.
    expect(g.onRequired(['password'])).toEqual({
      action: 'prompt',
      forget: [['password', 'username']],
    });
    // And never again in this attempt, not even after the forget.
    expect(g.onRequired(['password'])).toEqual({ action: 'prompt', forget: [] });
    // A new attempt starts over.
    g.begin();
    expect(g.onRequired(NAMES).action).toBe('recall');
  });

  it('does not recall for a field the user already typed in this attempt', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    expect(g.answeredByUser(NAMES, VALUES, true)).toBeNull();
    expect(g.onRequired(['password'])).toEqual({ action: 'prompt', forget: [] });
  });

  it('remembers typed values only once connected', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    g.answeredByUser(NAMES, VALUES, true);
    expect(g.connected()).toEqual([{ names: ['password', 'username'], values: VALUES }]);
    expect(g.connected()).toEqual([]);
  });

  it('never remembers a typed value that did not connect', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    g.answeredByUser(NAMES, VALUES, true);
    // A typed value was never stored: nothing to forget, and nothing kept.
    expect(g.serverError(0x0301)).toEqual([]);
    expect(g.ended(false)).toEqual([]);
    expect(g.connected()).toEqual([]);
  });

  it('a credential rejection forgets at once, also after the first frame', () => {
    expect(isCredentialRejection(0x0301)).toBe(true);
    expect(isCredentialRejection(0x0303)).toBe(true);
    expect(isCredentialRejection(0x0207)).toBe(false);

    const auto = new RequiredAnswerGuard();
    auto.begin();
    auto.answeredAutomatically(NAMES, VALUES);
    expect(auto.serverError(0x0301)).toEqual([['password', 'username']]);
    expect(auto.ended(false)).toEqual([]);

    // "Connected" (first sync) came before the remote computer refused the sign-in.
    const early = new RequiredAnswerGuard();
    early.begin();
    early.answeredByUser(NAMES, VALUES, true);
    expect(early.connected()).toHaveLength(1);
    expect(early.serverError(0x0303)).toEqual([['password', 'username']]);
    // Another error is not a rejection of the credentials.
    const other = new RequiredAnswerGuard();
    other.begin();
    other.answeredAutomatically(NAMES, VALUES);
    other.connected();
    expect(other.serverError(0x0203)).toEqual([]);
  });

  it('unticking Remember forgets at once and keeps nothing', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    expect(g.answeredByUser(NAMES, VALUES, false)).toEqual(['password', 'username']);
    expect(g.connected()).toEqual([]);
  });

  it('does not remember an all-empty answer', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    g.answeredByUser(['domain'], { domain: '' }, true);
    expect(g.connected()).toEqual([]);
  });

  it('refreshes remembered values that connected', () => {
    const g = new RequiredAnswerGuard();
    g.begin();
    g.answeredAutomatically(NAMES, VALUES);
    expect(g.connected()).toEqual([{ names: ['password', 'username'], values: VALUES }]);
  });

  it('forgets remembered values when guacd refuses the attempt or the server closes it', () => {
    const refused = new RequiredAnswerGuard();
    refused.begin();
    refused.answeredAutomatically(NAMES, VALUES);
    expect(refused.serverError(0x0207)).toEqual([]);
    // Even if the tunnel then reports a "network" code for the same close.
    expect(refused.ended(true)).toEqual([['password', 'username']]);

    const closed = new RequiredAnswerGuard();
    closed.begin();
    closed.answeredAutomatically(NAMES, VALUES);
    expect(closed.ended(false)).toEqual([['password', 'username']]);
  });

  it('keeps remembered values over a network drop or after connecting', () => {
    const drop = new RequiredAnswerGuard();
    drop.begin();
    drop.answeredAutomatically(NAMES, VALUES);
    expect(drop.ended(true)).toEqual([]);

    const later = new RequiredAnswerGuard();
    later.begin();
    later.answeredAutomatically(NAMES, VALUES);
    later.connected();
    later.serverError(0x0207);
    expect(later.ended(false)).toEqual([]);
  });
});
