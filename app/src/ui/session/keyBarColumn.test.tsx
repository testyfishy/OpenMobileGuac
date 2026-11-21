import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KeyBar, type KeyBarProps } from './KeyBar.tsx';
import { columnGroups } from './keyBarLayout.ts';

const noop = () => undefined;
const OFF = { Ctrl: 'off', Alt: 'off', Shift: 'off', Super: 'off', AltGr: 'off' } as const;

function render(extra: Partial<KeyBarProps> = {}): string {
  return renderToStaticMarkup(
    <KeyBar
      modifiers={OFF as KeyBarProps['modifiers']}
      layout={[
        ['Fn', 'Esc', 'Ctrl', 'Tab', 'Left'],
        ['F1', 'F2'],
      ]}
      onKey={noop}
      onModifier={noop}
      onCombo={noop}
      setName="General"
      onNextSet={noop}
      keyboardActive
      onHideKeyboard={noop}
      onSwipeDown={noop}
      {...extra}
    />,
  );
}

describe('key bar as a side column (landscape phones)', () => {
  it('renders one vertical column with the pinned buttons', () => {
    const html = render({ column: 'left' });
    expect(html).toContain('omg-keybar omg-keybar--column omg-keybar--col-left');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html.match(/omg-keybar__col /g)).toHaveLength(1);
    expect(html).toContain('omg-keybar__pinned');
    expect(html).toContain('data-set-switch');
    expect(html).toContain('omg-key--hide-kb');
    // Sticky modifiers keep their state classes.
    expect(html).toContain('omg-key--mod omg-key--off');
  });

  it('stays a row without `column`', () => {
    const html = render();
    expect(html).not.toContain('omg-keybar--column');
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).not.toContain('omg-keybar__col ');
  });

  it('lists the keys in one column; with Fn on, the F keys come right after Fn', () => {
    const rows = [['Ctrl', 'Fn', 'Esc'], ['F1', 'F2'], ['F3']];
    expect(columnGroups(rows, false)).toEqual([['Ctrl', 'Fn', 'Esc']]);
    expect(columnGroups(rows, true)).toEqual([['Ctrl', 'Fn'], ['F1', 'F2'], ['F3'], ['Esc']]);
    // Fn last: nothing after the F keys.
    expect(columnGroups([['Esc', 'Fn'], ['F1']], true)).toEqual([['Esc', 'Fn'], ['F1']]);
    // No Fn: every row, in order; empty rows dropped.
    expect(columnGroups([['Esc'], [], ['Tab']], false)).toEqual([['Esc'], ['Tab']]);
    expect(columnGroups([], true)).toEqual([]);
  });
});
