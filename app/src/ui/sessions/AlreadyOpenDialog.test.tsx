import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { NavContext, type NavApi } from '../nav/NavContext.ts';
import { AlreadyOpenDialog } from './AlreadyOpenDialog.tsx';

const nav = { addBackInterceptor: () => () => undefined } as unknown as NavApi;

function render(): string {
  return renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <AlreadyOpenDialog
        name="Office PC"
        onGoToOpen={() => undefined}
        onOpenAnother={() => undefined}
        onCancel={() => undefined}
      />
    </NavContext.Provider>,
  );
}

describe('"already open" dialog (MUL-1)', () => {
  it('names the connection and offers go to / open another / cancel', () => {
    const html = render();
    expect(html).toContain('Office PC is already open');
    expect(html).toMatch(/btn btn-primary" data-action="go-to-open">Go to the open session/);
    expect(html).toContain('data-action="open-another">Open another');
    expect(html).toContain(`>${en.common.cancel}<`);
  });

  it('has an unticked "Don\'t ask again" box that says where to change it back', () => {
    const html = render();
    expect(html).toMatch(/type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('Settings › Sessions › When a connection is already open');
  });

  it('the Spanish hint names the Spanish setting label', () => {
    expect(es.session.alreadyOpenDontAsk).toContain(es.settings.openAgain);
    expect(en.session.alreadyOpenDontAsk).toContain(en.settings.openAgain);
    expect(es.settings.openAgainSwitch).toBe(es.session.alreadyOpenGoTo);
    expect(en.settings.openAgainSwitch).toBe(en.session.alreadyOpenGoTo);
  });
});
