import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.ts';
import { es } from '../i18n/es.ts';
import { NavContext, type NavApi } from '../nav/NavContext.ts';
import type { InUsePlan } from './inUse.ts';
import { ConnectConfirmDialog, InUseDialog } from './InUseDialog.tsx';

const nav = { addBackInterceptor: () => () => undefined } as unknown as NavApi;
type Prompt = Extract<InUsePlan, { kind: 'prompt' }>;

const NOW = new Date(2026, 10, 21, 15, 0).getTime();
const AT = new Date(2026, 10, 21, 14, 2).getTime();

const base: Prompt = {
  kind: 'prompt',
  count: 1,
  people: [{ own: true, username: 'alice', startDate: AT }],
  existing: { kind: 'join', activeId: 'a1', own: true, username: 'alice' },
  cannotJoin: false,
  end: ['a1'],
};

function render(plan: Prompt, error?: string): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <InUseDialog
        name="Office PC"
        plan={plan}
        now={NOW}
        error={error}
        onExisting={noop}
        onEnd={noop}
        onAnother={noop}
        onCancel={noop}
      />
    </NavContext.Provider>,
  );
}

describe('"already in use" dialog (MUL-5)', () => {
  it('names the connection, the count and who, with all four answers', () => {
    const html = render(base);
    expect(html).toContain('Office PC is already in use');
    expect(html).toContain('The server reports 1 active session on this connection.');
    expect(html).toMatch(/<li>You, since \d{1,2}[:.]02/);
    expect(html).toMatch(/btn btn-primary" data-action="open-existing"[^>]*>Open the existing one/);
    expect(html).toContain('data-action="end-and-start"');
    expect(html).toContain('>End it and start fresh<');
    expect(html).toContain('data-action="open-another"');
    expect(html).toContain(`>${en.common.cancel}<`);
    expect(html).not.toContain(en.session.inUseCannotJoin);
    expect(html).toContain('dialog-actions-stack');
  });

  it('without a joinable session: no "Open the existing one", the note, Open another first', () => {
    const html = render({
      ...base,
      count: 2,
      people: [],
      existing: undefined,
      cannotJoin: true,
      end: [],
    });
    expect(html).toContain('The server reports 2 active sessions on this connection.');
    expect(html).not.toContain('open-existing');
    expect(html).not.toContain('end-and-start');
    expect(html).toContain(en.session.inUseCannotJoin);
    expect(html).toMatch(/btn btn-primary" data-action="open-another"/);
  });

  it('names other users when the server does, "Another user" when it does not', () => {
    const html = render({
      ...base,
      count: 2,
      existing: undefined,
      end: [],
      people: [
        { own: false, username: 'bob', startDate: AT },
        { own: false, username: undefined, startDate: undefined },
      ],
    });
    expect(html).toMatch(/<li>bob, since /);
    expect(html).toContain('<li>Another user</li>');
  });

  it('lists every session, and "End" says how many it ends', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      own: false,
      username: `user${i}`,
      startDate: AT,
    }));
    const html = render({ ...base, count: 6, people: many, end: many.map((_, i) => `b${i}`) });
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).toContain('>End all 6 and start fresh<');
    expect(es.session.inUseEnd(2)).toContain('2');
  });

  it('shows a failed "End it" inline', () => {
    expect(render(base, en.session.inUseEndFailed)).toContain(en.session.inUseEndFailed);
  });

  it('has an unticked "Don\'t ask again" that names the setting, in English and Spanish', () => {
    const html = render(base);
    expect(html).toMatch(/type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('Settings › Sessions › Ask before connecting');
    expect(en.session.inUseDontAsk).toContain(en.settings.askInUse);
    expect(es.session.inUseDontAsk).toContain(es.settings.askInUse);
  });
});

describe('"Connect to …?" (Always)', () => {
  function confirm(checked: boolean): string {
    return renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <ConnectConfirmDialog
          name="Office PC"
          checked={checked}
          onConnect={() => undefined}
          onCancel={() => undefined}
        />
      </NavContext.Provider>,
    );
  }

  it('asks plainly, says "not in use" only when the server answered', () => {
    const html = confirm(true);
    expect(html).toContain('Connect to Office PC?');
    expect(html).toContain('data-action="connect">Connect<');
    expect(html).toContain(en.session.connectBody);
    expect(html).toContain('Ask before connecting');
    expect(confirm(false)).not.toContain(en.session.connectBody);
  });
});
