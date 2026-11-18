import { describe, expect, it } from 'vitest';
import { APP_ID, APP_NAME } from './appInfo.ts';

describe('appInfo', () => {
  it('exposes the app name and placeholder id', () => {
    expect(APP_NAME).toBe('OpenMobileGuac');
    expect(APP_ID).toBe('app.openmobileguac.client');
  });
});
