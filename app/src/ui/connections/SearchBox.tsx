import { Icon } from '../components/Icon.tsx';
import { strings } from '../strings.ts';

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const c = strings.connections;
  return (
    <div className="search" role="search">
      <Icon name="search" className="search-icon" />
      <input
        type="search"
        className="search-input"
        value={value}
        placeholder={c.searchPlaceholder}
        aria-label={c.search}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      {value ? (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label={c.clearSearch}
          onClick={() => onChange('')}
        >
          <Icon name="close" size="1.25rem" />
        </button>
      ) : null}
    </div>
  );
}
