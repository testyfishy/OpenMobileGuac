import { describe, expect, it } from 'vitest';
import {
  PIP_MAX_SIDE,
  PIP_MAX_WIDTH,
  closePipWindow,
  onPipWindowChange,
  pipFrameDue,
  pipFrameSize,
  pipWanted,
  pipWindowActive,
  pipWindowAfter,
} from './pipFeed.ts';

describe('pipFrameSize', () => {
  it('never upscales and keeps even dimensions', () => {
    expect(pipFrameSize(800, 601)).toEqual({ width: 800, height: 602 });
  });
  it('scales wide displays down to the maximum width', () => {
    const s = pipFrameSize(1920, 1080);
    expect(s).toEqual({ width: PIP_MAX_WIDTH, height: 540 });
  });
  it('caps the height of a portrait display too', () => {
    const s = pipFrameSize(1170, 2532);
    expect(s.height).toBe(PIP_MAX_SIDE);
    expect(s.width).toBe(444);
  });
  it('returns nothing for an empty display', () => {
    expect(pipFrameSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('pipFrameDue', () => {
  const at = (ms: number, hidden: boolean, dirty: boolean) =>
    pipFrameDue({ now: 10_000 + ms, lastSentAt: 10_000, hidden, dirty });
  it('follows display updates up to 12 a second in the background', () => {
    expect(at(50, true, true)).toBe(false);
    expect(at(90, true, true)).toBe(true);
  });
  it('sends only twice a second in the foreground', () => {
    expect(at(90, false, true)).toBe(false);
    expect(at(500, false, true)).toBe(true);
  });
  it('refreshes an unchanged picture once a second', () => {
    expect(at(900, true, false)).toBe(false);
    expect(at(1000, true, false)).toBe(true);
  });
});

describe('pipWanted', () => {
  const base = {
    setting: true,
    available: true,
    active: true,
    disposed: false,
    phase: 'connected',
    everConnected: true,
  };
  it('runs while connected', () => {
    expect(pipWanted(base)).toBe(true);
  });
  it('keeps running through a reconnect, so the window stays up', () => {
    expect(pipWanted({ ...base, phase: 'reconnecting' })).toBe(true);
    expect(pipWanted({ ...base, phase: 'connecting' })).toBe(true);
  });
  it('does not start before the first connection', () => {
    expect(pipWanted({ ...base, phase: 'connecting', everConnected: false })).toBe(false);
  });
  it('stops once the session has ended', () => {
    expect(pipWanted({ ...base, phase: 'disconnected' })).toBe(false);
    expect(pipWanted({ ...base, phase: 'error' })).toBe(false);
  });
  it('stops when off, hidden, closed or unavailable', () => {
    expect(pipWanted({ ...base, setting: false })).toBe(false);
    expect(pipWanted({ ...base, active: false })).toBe(false);
    expect(pipWanted({ ...base, disposed: true })).toBe(false);
    expect(pipWanted({ ...base, available: false })).toBe(false);
  });
});

describe('Picture in Picture window state', () => {
  it('follows the started, stopped and failed events', () => {
    expect(pipWindowAfter(false, 'started')).toBe(true);
    expect(pipWindowAfter(true, 'stopped')).toBe(false);
    expect(pipWindowAfter(true, 'failed')).toBe(false);
  });
  it('ignores other events', () => {
    expect(pipWindowAfter(true, 'possible')).toBe(true);
    expect(pipWindowAfter(false, 'restore')).toBe(false);
    expect(pipWindowAfter(true, undefined)).toBe(true);
  });
  it('is not up without a feed, and closing then is harmless', () => {
    expect(pipWindowActive()).toBe(false);
    expect(() => closePipWindow()).not.toThrow();
    expect(pipWindowActive()).toBe(false);
  });
  it('returns an unsubscribe function', () => {
    const off = onPipWindowChange(() => undefined);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});
