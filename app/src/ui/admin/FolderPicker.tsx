import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { adminStrings } from './adminStrings.ts';
import type { FolderOption } from './folderTree.ts';

/** The folder list (indented tree). Folders the user cannot pick are shown, disabled. */
export function FolderList({
  options,
  selected,
  current,
  onPick,
}: {
  options: readonly FolderOption[];
  selected: string;
  /** The object's present folder, marked as such. */
  current?: string | undefined;
  onPick: (identifier: string) => void;
}) {
  const a = adminStrings;
  return (
    <ul className="list adm-folders" role="listbox" aria-label={a.picker.title}>
      {options.map((o) => {
        const isSelected = o.identifier === selected;
        const reason =
          o.reason === 'self'
            ? a.picker.self
            : o.reason === 'descendant'
              ? a.picker.inside
              : o.reason === 'no-permission'
                ? a.picker.noPermission
                : o.identifier === current
                  ? a.picker.current
                  : undefined;
        return (
          <li key={o.identifier}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={o.disabled || undefined}
              disabled={o.disabled}
              className={isSelected ? 'row-main adm-folder adm-folder-on' : 'row-main adm-folder'}
              style={{ paddingInlineStart: `${0.75 + o.depth * 1.25}rem` }}
              onClick={() => onPick(o.identifier)}
            >
              <Icon name="folder" />
              <span className="row-text">
                <span className="row-title">{o.name || a.topLevel}</span>
                {reason ? <span className="row-subtitle">{reason}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A sheet that picks a folder and closes. */
export function FolderPickerSheet({
  options,
  selected,
  onPick,
  onClose,
}: {
  options: readonly FolderOption[];
  selected: string;
  onPick: (identifier: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={adminStrings.picker.title} onClose={onClose}>
      <FolderList
        options={options}
        selected={selected}
        onPick={(id) => {
          onPick(id);
          onClose();
        }}
      />
    </Sheet>
  );
}
