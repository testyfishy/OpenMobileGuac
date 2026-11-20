import { useEffect, useState } from 'react';
import {
  runConnectionTest,
  type ConnectionTestResult,
  type WebSocketLike,
} from '../../core/diagnostics/connectionTest.ts';
import type { ServerProfile } from '../../core/models/ServerProfile.ts';
import {
  TotpParseError,
  parseTotpInput,
  secondsRemaining,
  serializeTotp,
  totpAt,
  type TotpParams,
} from '../../core/totp/totp.ts';
import { InfoBanner } from '../components/Feedback.tsx';
import { Segmented, TextField, Toggle } from '../components/Form.tsx';
import { Icon } from '../components/Icon.tsx';
import { useToast } from '../components/toastContext.ts';
import { useAppSettings, useServices } from '../services/context.ts';
import { haptic } from '../services/native.ts';
import {
  applyClipboardPolicy,
  clipboardPolicyOf,
  type ClipboardPolicy,
  type ServerOptions,
  type SessionSettingsPatch,
  type SsoMode,
} from '../settings/settingsModel.ts';
import { strings } from '../strings.ts';
import { isInsecureUrl } from './serverForm.ts';
import { useServerOptions } from './useServerOptions.ts';
// By path: the descriptor strings are already in the main chunk (settingsSchema).
import { sessionStrings } from '../session/sessionStrings.ts';
import {
  AUDIO_MODES,
  QUALITIES,
  type AudioMode,
  type Quality,
} from '../../session/viewport/remoteSize.ts';
import { seedPolicy } from './seedPolicy.ts';
import type { BiometryAvailability } from '../services/native.ts';

type Inherit<T extends string> = T | 'inherit';

export function ServerOptionsSection({ profile }: { profile: ServerProfile }) {
  const services = useServices();
  const { options, save } = useServerOptions(profile.id);
  const [warn, setWarn] = useState<boolean | undefined>(undefined);
  const f = strings.serverForm;
  const t = strings.settings;
  const so = sessionStrings.options;
  useEffect(() => {
    let live = true;
    void services.settings.isHttpWarningDismissed(profile.id).then((d) => {
      if (live) setWarn(!d);
    });
    return () => {
      live = false;
    };
  }, [services.settings, profile.id]);
  if (!options) return null;
  const patch = options.sessionDefaults;
  const setPatch = (p: SessionSettingsPatch) => save({ sessionDefaults: p });
  const setField = <K extends 'fitMode' | 'pointerMode' | 'quality' | 'audio'>(
    key: K,
    value: string,
  ) => {
    const { [key]: _old, ...rest } = patch;
    void _old;
    setPatch(value === 'inherit' ? rest : ({ ...rest, [key]: value } as SessionSettingsPatch));
  };
  return (
    <section className="settings-group" aria-labelledby="srv-options">
      <h2 id="srv-options" className="section-title">
        {f.optionsTitle}
      </h2>
      <p className="muted">{f.optionsHint}</p>
      <Segmented<Inherit<NonNullable<SessionSettingsPatch['fitMode']>>>
        label={t.fitMode}
        value={patch.fitMode ?? 'inherit'}
        onChange={(v) => setField('fitMode', v)}
        options={[
          { value: 'inherit', label: f.inherit },
          ...(['fit-screen', 'fit-width', 'fit-height', 'one-to-one', 'css-pixels'] as const).map(
            (v) => ({
              value: v,
              label: t.fitModes[v] ?? v,
            }),
          ),
        ]}
      />
      <Segmented<Inherit<NonNullable<SessionSettingsPatch['pointerMode']>>>
        label={t.pointerMode}
        value={patch.pointerMode ?? 'inherit'}
        onChange={(v) => setField('pointerMode', v)}
        options={[
          { value: 'inherit', label: f.inherit },
          ...(['direct', 'trackpad', 'touch'] as const).map((v) => ({
            value: v,
            label: t.pointerModes[v] ?? v,
          })),
        ]}
      />
      <Segmented<Inherit<Quality>>
        label={so.quality}
        value={patch.quality ?? 'inherit'}
        onChange={(v) => setField('quality', v)}
        options={[
          { value: 'inherit', label: f.inherit },
          ...QUALITIES.map((v) => ({ value: v, label: so.qualityOptions[v] })),
        ]}
      />
      <p className="field-hint">{so.qualityHint}</p>
      <Segmented<Inherit<AudioMode>>
        label={so.audio}
        value={patch.audio ?? 'inherit'}
        onChange={(v) => setField('audio', v)}
        options={[
          { value: 'inherit', label: f.inherit },
          ...AUDIO_MODES.map((v) => ({ value: v, label: so.audioOptions[v] })),
        ]}
      />
      <Segmented<ClipboardPolicy>
        label={f.clipboardPolicy}
        value={clipboardPolicyOf(patch)}
        onChange={(v) => setPatch(applyClipboardPolicy(patch, v))}
        options={[
          { value: 'inherit', label: f.inherit },
          { value: 'both', label: f.clipboardBoth },
          { value: 'to-device', label: f.clipboardToDevice },
          { value: 'off', label: f.clipboardOff },
        ]}
      />
      {isInsecureUrl(profile.baseUrl) && warn !== undefined ? (
        <Toggle
          label={f.httpWarning}
          hint={f.httpWarningHint}
          checked={warn}
          onChange={(v) => {
            setWarn(v);
            void services.settings.setHttpWarningDismissed(profile.id, !v);
          }}
        />
      ) : null}
      <Toggle
        label={f.confirmLinks}
        hint={f.confirmLinksHint}
        checked={options.confirmLinks}
        onChange={(v) => save({ confirmLinks: v })}
      />
      <h3 className="subsection-title">{f.sso.title}</h3>
      <Segmented<SsoMode>
        label={f.sso.mode}
        value={options.ssoMode}
        onChange={(v) => save({ ssoMode: v })}
        options={[
          { value: 'webview', label: f.sso.webview },
          { value: 'app-callback', label: f.sso.callback },
        ]}
      />
      <p className="field-hint">{f.sso.hint}</p>
      <h3 className="subsection-title">{f.hintsTitle}</h3>
      <ServerHints profileId={profile.id} options={options} />
    </section>
  );
}

function ServerHints({ profileId, options }: { profileId: string; options: ServerOptions }) {
  const { auth } = useServices();
  const f = strings.serverForm;
  const session = auth.current(profileId);
  return (
    <div className="hints">
      {session ? (
        <p>
          {f.hintsDataSources}: <code>{session.dataSources.join(', ')}</code>
        </p>
      ) : (
        <p className="muted">{f.hintsNotSignedIn}</p>
      )}
      {options.seenTotp ? <p className="muted">{f.hintsTotp}</p> : null}
      {options.seenSso ? <p className="muted">{f.hintsSso}</p> : null}
    </div>
  );
}

/** SRV-9: stored TOTP seed, off by default, gated by the app lock. */
export function TotpSeedSection({ profile }: { profile: ServerProfile }) {
  const services = useServices();
  const { settings } = useAppSettings();
  const toast = useToast();
  const { options, save } = useServerOptions(profile.id);
  const [has, setHas] = useState<boolean | undefined>(undefined);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [preview, setPreview] = useState<TotpParams | undefined>();
  const t = strings.serverForm.totp;
  useEffect(() => {
    let live = true;
    void services.auth.hasTotpSeed(profile.id).then((h) => {
      if (live) setHas(h);
    });
    return () => {
      live = false;
    };
  }, [services.auth, profile.id]);

  const [biometry, setBiometry] = useState<BiometryAvailability | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void services.lock.availability().then((a) => {
      if (live) setBiometry(a);
    });
    return () => {
      live = false;
    };
  }, [services.lock]);
  const policy = seedPolicy(services.secretStorage, biometry, settings.lock.enabled);
  if (!options || has === undefined || biometry === undefined) return null;
  let typed: TotpParams | undefined;
  try {
    typed = input.trim() ? parseTotpInput(input) : undefined;
  } catch {
    typed = undefined;
  }

  const reveal = async () => {
    const seed = await services.auth.loadTotpSeed(profile.id);
    if (seed) setPreview(seed);
  };

  const saveSeed = async () => {
    try {
      const p = parseTotpInput(input);
      await services.auth.saveTotpSeed(profile.id, serializeTotp(p));
      save({ totpAutofill: true });
      setHas(true);
      setInput('');
      setPreview(p);
      haptic('success');
      toast.show(t.saved);
    } catch (err) {
      setError(
        err instanceof TotpParseError
          ? (t.errors[err.reason] ?? t.errors['base32'])
          : strings.errors.unknown.title,
      );
    }
  };

  const remove = async () => {
    await services.auth.saveTotpSeed(profile.id, null);
    save({ totpAutofill: false });
    setHas(false);
    setPreview(undefined);
    toast.show(t.removed);
  };

  return (
    <section className="settings-group" aria-labelledby="srv-totp">
      <h2 id="srv-totp" className="section-title">
        <Icon name="key" size="1rem" /> {t.title}
      </h2>
      <InfoBanner tone="warning">{t.warning}</InfoBanner>
      {policy === 'no-storage' ? (
        <p className="muted">{t.noSecureStorage}</p>
      ) : policy === 'needs-lock' && !has ? (
        <p className="muted">{t.needsLock}</p>
      ) : has ? (
        <>
          <p>{t.present}</p>
          <Toggle
            label={t.enable}
            checked={options.totpAutofill && policy === 'allowed'}
            disabled={policy !== 'allowed'}
            onChange={(v) => save({ totpAutofill: v })}
          />
          {preview ? (
            <TotpPreview seed={preview} />
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => void reveal()}>
              {t.showCode}
            </button>
          )}
          <button type="button" className="btn btn-danger-ghost" onClick={() => void remove()}>
            <Icon name="trash" /> {t.remove}
          </button>
        </>
      ) : (
        <>
          <TextField
            label={t.input}
            hint={t.inputHint}
            value={input}
            onChange={(v) => {
              setInput(v);
              setError(undefined);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            error={error}
          />
          {typed ? <TotpPreview seed={typed} /> : null}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void saveSeed()}
            disabled={input.trim() === ''}
          >
            {t.save}
          </button>
        </>
      )}
    </section>
  );
}

/** The live code, so the user can compare it with their authenticator app. */
export function TotpPreview({ seed }: { seed: TotpParams }) {
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState('');
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const step = Math.floor(now / 1000 / seed.period);
  useEffect(() => {
    let live = true;
    void totpAt(seed, step * seed.period * 1000).then((c) => {
      if (live) setCode(c);
    });
    return () => {
      live = false;
    };
  }, [seed, step]);
  return (
    <p className="totp-preview" aria-live="off">
      {code ? strings.serverForm.totp.preview(code, secondsRemaining(now, seed.period)) : null}
    </p>
  );
}

/** DIAG-1 / SRV-2: which address worked, API, WebSocket tunnel and round-trip time. */
export function ConnectionTestPanel({ url }: { url: string }) {
  const services = useServices();
  const [result, setResult] = useState<ConnectionTestResult | undefined>();
  const [busy, setBusy] = useState(false);
  const c = strings.connectionTest;
  const run = async () => {
    setBusy(true);
    setResult(undefined);
    try {
      const r = await runConnectionTest(url, {
        http: services.http,
        openWebSocket:
          typeof WebSocket === 'undefined'
            ? undefined
            : (u) => new WebSocket(u, 'guacamole') as unknown as WebSocketLike,
      });
      services.log.info(
        'diag',
        `connection test: api ${r.api}, websocket ${r.websocket}${r.latencyMs !== undefined ? `, ${r.latencyMs} ms` : ''}`,
      );
      setResult(r);
      haptic(r.api === 'ok' && r.websocket === 'ok' ? 'success' : 'warning');
    } finally {
      setBusy(false);
    }
  };
  const label = (s: 'ok' | 'fail' | 'skipped') =>
    s === 'ok' ? c.ok : s === 'fail' ? c.failed : c.skipped;
  return (
    <div className="conn-test">
      <button
        type="button"
        className="btn btn-block"
        onClick={() => void run()}
        disabled={busy || !url.trim()}
      >
        <Icon name="pulse" /> {busy ? strings.serverForm.testing : strings.serverForm.test}
      </button>
      {result ? (
        <div className="conn-test-result" role="status">
          {result.invalid ? (
            <p className="field-error">{c.invalid}</p>
          ) : (
            <dl className="about">
              {result.candidates.map((x) => (
                <div key={x.baseUrl} className={`test-${x.status}`}>
                  <dt>
                    <code>{x.baseUrl}</code>
                  </dt>
                  <dd>
                    {label(x.status)}
                    {x.failure
                      ? ` (${c.failures[x.failure] ?? x.failure}${x.httpStatus ? ` ${x.httpStatus}` : ''})`
                      : ''}
                    {x.ms !== undefined && x.status !== 'skipped' ? ` · ${c.ms(x.ms)}` : ''}
                  </dd>
                </div>
              ))}
              <div className={`test-${result.api}`}>
                <dt>{c.api}</dt>
                <dd>{label(result.api)}</dd>
              </div>
              <div className={`test-${result.websocket}`}>
                <dt>{c.websocket}</dt>
                <dd>
                  {label(result.websocket)}
                  {result.websocketDetail
                    ? ` (${c.websocketDetail[result.websocketDetail] ?? ''})`
                    : ''}
                </dd>
              </div>
              {result.latencyMs !== undefined ? (
                <div>
                  <dt>{c.latency}</dt>
                  <dd>{c.ms(result.latencyMs)}</dd>
                </div>
              ) : null}
            </dl>
          )}
          {result.api === 'ok' && result.websocket === 'fail' ? (
            <InfoBanner tone="warning">{c.wsHintTls}</InfoBanner>
          ) : null}
          {result.api === 'ok' && result.websocket === 'ok' ? (
            <p className="muted">{c.allGood}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
