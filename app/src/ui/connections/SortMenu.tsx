import { useId } from 'react';
import { Icon } from '../components/Icon.tsx';
import { useAppSettings } from '../services/context.ts';
import type { ConnectionSort } from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';

const MODES: readonly ConnectionSort[] = ['server', 'name', 'protocol', 'recent'];

/** Connection sort order, remembered app-wide. */
export function SortMenu() {
  const { settings, update } = useAppSettings();
  const id = useId();
  return (
    <div className="sort-select">
      <label htmlFor={id} className="visually-hidden">
        {strings.connections.sort}
      </label>
      <Icon name="sort" size="1.125rem" className="sort-icon" />
      <select
        id={id}
        className="sort-input"
        value={settings.connectionSort}
        onChange={(e) => update({ ...settings, connectionSort: e.target.value as ConnectionSort })}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {strings.connections.sortModes[m] ?? m}
          </option>
        ))}
      </select>
    </div>
  );
}
