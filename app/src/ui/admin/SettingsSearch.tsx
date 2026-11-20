import { Icon } from '../components/Icon.tsx';
import { strings } from '../strings.ts';
import { adminStrings } from './adminStrings.ts';

/** Search box for the editor's settings (same look as the connection search). */
export function SettingsSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const e = adminStrings.editor;
  return (
    <div className="search" role="search">
      <Icon name="search" className="search-icon" />
      <input
        type="search"
        className="search-input"
        value={value}
        placeholder={e.searchPlaceholder}
        aria-label={e.search}
        onChange={(ev) => onChange(ev.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onKeyDown={(ev) => {
          // Enter must not submit the editor form.
          if (ev.key === 'Enter') ev.preventDefault();
        }}
      />
      {value ? (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label={strings.connections.clearSearch}
          onClick={() => onChange('')}
        >
          <Icon name="close" size="1.25rem" />
        </button>
      ) : null}
    </div>
  );
}
