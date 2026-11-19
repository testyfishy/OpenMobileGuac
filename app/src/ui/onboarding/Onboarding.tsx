import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon.tsx';
import { useBackInterceptor } from '../nav/NavContext.ts';
import { strings } from '../strings.ts';

const ICONS: readonly IconName[] = ['server', 'monitor', 'play'];

/** First-run introduction: three short cards, ending at the Demo or "Add a server". */
export function Onboarding({
  onDone,
  onTryDemo,
  onAddServer,
}: {
  onDone: () => void;
  onTryDemo: () => void;
  onAddServer: () => void;
}) {
  const o = strings.onboarding;
  const [i, setI] = useState(0);
  const card = o.cards[i] ?? o.cards[0];
  const last = i === o.cards.length - 1;
  const heading = useRef<HTMLHeadingElement>(null);
  useBackInterceptor(true, onDone);
  useEffect(() => {
    heading.current?.focus();
  }, [i]);
  if (!card) return null;
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={o.label}>
      <div className="onboarding-card">
        <div className="onboarding-icon">
          <Icon name={ICONS[i] ?? 'server'} size="2.5rem" />
        </div>
        <p className="muted onboarding-step">{o.step(i + 1, o.cards.length)}</p>
        <h1 ref={heading} tabIndex={-1} className="onboarding-title">
          {card.title}
        </h1>
        <p>{card.body}</p>
        <div className="onboarding-dots" aria-hidden="true">
          {o.cards.map((_, k) => (
            <span key={k} className={k === i ? 'dot dot-on' : 'dot'} />
          ))}
        </div>
        <div className="form-actions">
          {last ? (
            <>
              <button type="button" className="btn btn-primary btn-block" onClick={onTryDemo}>
                <Icon name="play" /> {o.tryDemo}
              </button>
              <button type="button" className="btn btn-block" onClick={onAddServer}>
                <Icon name="plus" /> {o.addServer}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => setI((n) => n + 1)}
              >
                {strings.common.next}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={onDone}>
                {strings.common.skip}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
