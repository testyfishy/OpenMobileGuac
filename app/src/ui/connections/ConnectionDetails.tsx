import { buildConnectLink } from '../../core/links/links.ts';
import { Icon } from '../components/Icon.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { useToast } from '../components/toastContext.ts';
import { copyText, haptic } from '../services/native.ts';
import { strings } from '../strings.ts';
import { protocolLabel, refOf, type ConnectionMatch } from './treeView.ts';

/** Connection details (protocol, group path, active users, ids, sharing profiles) + actions. */
export function ConnectionDetails({
  serverId,
  match,
  favourite,
  lastUsed,
  thumbnail,
  onConnect,
  onToggleFavourite,
  onClose,
}: {
  serverId: string;
  match: ConnectionMatch;
  favourite: boolean;
  lastUsed: number | undefined;
  thumbnail: string | undefined;
  onConnect: () => void;
  onToggleFavourite: (fav: boolean) => void;
  onClose: () => void;
}) {
  const c = strings.connections;
  const toast = useToast();
  const conn = match.connection;
  const copyLink = async () => {
    const ok = await copyText(buildConnectLink(serverId, refOf(conn)));
    haptic(ok ? 'success' : 'error');
    toast.show(ok ? c.linkCopied : strings.errors.unknown.title);
  };
  return (
    <Sheet title={conn.name} onClose={onClose}>
      {thumbnail ? <img className="details-thumb" src={thumbnail} alt="" /> : null}
      <dl className="about details">
        <div>
          <dt>{c.protocol}</dt>
          <dd>{protocolLabel(conn.protocol)}</dd>
        </div>
        <div>
          <dt>{c.group}</dt>
          <dd>{match.path.length ? match.path.join(' › ') : c.rootGroup}</dd>
        </div>
        <div>
          <dt>{c.activeUsers}</dt>
          <dd>{conn.activeConnections}</dd>
        </div>
        {lastUsed !== undefined ? (
          <div>
            <dt>{c.lastUsed}</dt>
            <dd>{new Date(lastUsed).toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt>{c.source}</dt>
          <dd>{conn.dataSource}</dd>
        </div>
        <div>
          <dt>{c.identifier}</dt>
          <dd>
            <code>{conn.identifier}</code>
          </dd>
        </div>
      </dl>
      {conn.sharingProfiles.length > 0 ? (
        <>
          <h3 className="subsection-title">{c.sharingProfiles}</h3>
          <ul className="plain-list">
            {conn.sharingProfiles.map((sp) => (
              <li key={sp.identifier}>{sp.name || sp.identifier}</li>
            ))}
          </ul>
          <p className="muted">{c.sharingHint}</p>
        </>
      ) : null}
      <div className="form-actions">
        <button type="button" className="btn btn-primary btn-block" onClick={onConnect}>
          <Icon name="play" /> {strings.common.connect}
        </button>
        <button
          type="button"
          className="btn btn-block"
          onClick={() => onToggleFavourite(!favourite)}
        >
          <Icon name={favourite ? 'star-filled' : 'star'} />{' '}
          {favourite ? c.removeFavourite(conn.name) : c.addFavourite(conn.name)}
        </button>
        <button type="button" className="btn btn-block" onClick={() => void copyLink()}>
          <Icon name="link" /> {c.copyLink}
        </button>
      </div>
    </Sheet>
  );
}
