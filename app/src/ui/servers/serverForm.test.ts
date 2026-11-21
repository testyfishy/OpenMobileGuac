import { describe, expect, it } from 'vitest';
import { applyClipboardPolicy, type ClipboardPolicy } from '../settings/settingsModel.ts';
import { serverClipboardPolicy } from './clipboardPolicy.ts';
import { reorderMode, signInChangeOf } from './serverForm.ts';

describe('signInChangeOf', () => {
  const saved = { username: 'alice' };
  it('a new address wins over everything', () => {
    expect(signInChangeOf(saved, true, 'bob')).toBe('moved');
    expect(signInChangeOf(saved, true, 'alice')).toBe('moved');
  });
  it('another username on the same address is another account', () => {
    expect(signInChangeOf(saved, false, 'bob')).toBe('account');
    expect(signInChangeOf(saved, false, '')).toBe('account');
    expect(signInChangeOf({ username: '' }, false, 'bob')).toBe('account');
  });
  it('the same username (spaces aside) keeps the sign-in', () => {
    expect(signInChangeOf(saved, false, 'alice')).toBe('none');
    expect(signInChangeOf(saved, false, '  alice ')).toBe('none');
  });
});

describe('reorderMode', () => {
  it('shows the arrows only while there are two servers to order', () => {
    expect(reorderMode(true, 2)).toBe(true);
    expect(reorderMode(true, 1)).toBe(false);
    expect(reorderMode(true, 0)).toBe(false);
    expect(reorderMode(true, undefined)).toBe(false);
    expect(reorderMode(false, 5)).toBe(false);
  });
});

describe('serverClipboardPolicy', () => {
  const appBoth = { clipboardRemoteToDevice: true, clipboardAutoSendOnFocus: true };
  const appOff = { clipboardRemoteToDevice: false, clipboardAutoSendOnFocus: false };

  it('shows what is in effect when the server sets only one field', () => {
    // Only "send the device clipboard on return" set; remote → device comes from the app.
    expect(serverClipboardPolicy({ clipboardAutoSendOnFocus: true }, appBoth)).toBe('both');
    expect(serverClipboardPolicy({ clipboardRemoteToDevice: true }, appBoth)).toBe('both');
    expect(serverClipboardPolicy({ clipboardRemoteToDevice: true }, appOff)).toBe('to-device');
  });

  it('says custom for the pair no preset covers', () => {
    expect(serverClipboardPolicy({ clipboardAutoSendOnFocus: true }, appOff)).toBe('custom');
    expect(
      serverClipboardPolicy(
        { clipboardRemoteToDevice: false, clipboardAutoSendOnFocus: true },
        appBoth,
      ),
    ).toBe('custom');
  });

  it('round-trips every preset', () => {
    for (const inherited of [appBoth, appOff]) {
      for (const p of ['inherit', 'both', 'to-device', 'off'] as ClipboardPolicy[]) {
        expect(serverClipboardPolicy(applyClipboardPolicy({ quality: 'low' }, p), inherited)).toBe(
          p,
        );
      }
    }
  });
});
