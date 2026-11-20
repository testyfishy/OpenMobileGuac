import { useState } from 'react';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { newComboId, reduceKeyLibrary, type KeyLibrary } from '../../session/keys/KeySets.ts';
import { ComboMenu } from './ComboMenu.tsx';
import { KeySetManager, type SaveTextFile } from './KeySetManager.tsx';
import './SessionScreen.css';

export interface KeysEditorHostProps {
  readonly editor: 'keySets' | 'combos';
  readonly library: KeyLibrary;
  readonly onLibrary: (next: KeyLibrary) => void;
  /** The app default key set. */
  readonly defaultSet: string;
  readonly onDefaultSet: (id: string) => void;
  readonly saveFile?: SaveTextFile;
  readonly onClose: () => void;
}

/**
 * The session's key set manager and combo editor, shown over the Settings screen (the same
 * components as in a session, so both places edit the library the same way). Loaded lazily
 * with the session styles; the wrapper supplies the session theme tokens.
 */
export default function KeysEditorHost(p: KeysEditorHostProps) {
  const [view, setView] = useState(p.editor);
  // Android back closes the sheet (not the Settings screen behind it).
  useBackInterceptor(
    true,
    view === 'combos' && p.editor === 'keySets' ? () => setView('keySets') : p.onClose,
  );
  return (
    <div className="omg-session omg-session--overlay">
      {view === 'keySets' ? (
        <KeySetManager
          library={p.library}
          onLibrary={p.onLibrary}
          activeId={p.defaultSet}
          onUse={p.onDefaultSet}
          onCombos={() => setView('combos')}
          showProtocolDefaults
          {...(p.saveFile ? { saveFile: p.saveFile } : {})}
          onClose={p.onClose}
        />
      ) : (
        <ComboMenu
          combos={p.library.combos}
          onLibrary={(a) => p.onLibrary(reduceKeyLibrary(p.library, a).library)}
          newId={() => newComboId(p.library)}
          onClose={p.editor === 'keySets' ? () => setView('keySets') : p.onClose}
        />
      )}
    </div>
  );
}
