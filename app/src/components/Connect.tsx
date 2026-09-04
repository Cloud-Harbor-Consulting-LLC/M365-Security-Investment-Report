import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { graphScopes, loginScopeNames } from '@/graph/scopes';
import { COLLECTION_STEPS, collectSnapshot, type StepProgress, type StepState } from '@/graph/collect';
import {
  DEFAULT_CLIENT_ID,
  explainAuthError,
  hasPublishedApp,
  recallConfig,
  redirectUri,
} from '@/graph/session';
import type { Snapshot } from '@/model/snapshot';

interface Props {
  onSnapshot: (snapshot: Snapshot, sourceLabel: string) => void;
  onCancel: () => void;
}

type Phase = 'preflight' | 'connecting' | 'collecting';

export function Connect({ onSnapshot, onCancel }: Props): JSX.Element {
  const remembered = recallConfig();
  const [clientId, setClientId] = useState(remembered.clientId ?? DEFAULT_CLIENT_ID);
  const [tenantId, setTenantId] = useState(remembered.tenantId ?? '');
  const [advanced, setAdvanced] = useState(!hasPublishedApp);
  const [phase, setPhase] = useState<Phase>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [needsAdminConsent, setNeedsAdminConsent] = useState(false);
  const [steps, setSteps] = useState<Record<string, StepProgress>>({});

  const config = () => ({
    clientId: (clientId || DEFAULT_CLIENT_ID).trim(),
    tenantId: tenantId.trim() || 'organizations',
  });

  const start = async (e: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setNeedsAdminConsent(false);
    setPhase('connecting');

    try {
      // Loaded on demand: MSAL is ~245 KB and most visitors never sign in.
      const { signIn } = await import('@/graph/auth');
      const context = await signIn(config());
      setPhase('collecting');

      const snapshot = await collectSnapshot(context, {
        onProgress: (p: StepProgress) => setSteps((prev) => ({ ...prev, [p.key]: p })),
      });

      const skus = snapshot.Collectors.subscribedSkus;
      if (!skus.Available) {
        setError(skus.Reason ?? 'The licence inventory could not be read, so there is nothing to analyse.');
        setPhase('preflight');
        return;
      }

      onSnapshot(snapshot, snapshot.Collectors.organization.Data?.DefaultDomain ?? 'connected tenant');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNeedsAdminConsent(/AADSTS65001|AADSTS90094|consent_required|admin_consent|Need admin approval/i.test(message));
      setError(explainAuthError(e));
      setPhase('preflight');
    }
  };

  const consent = async () => {
    setError(null);
    setPhase('connecting');
    try {
      const { grantAdminConsent } = await import('@/graph/auth');
      await grantAdminConsent(config());
      setNeedsAdminConsent(false);
      setPhase('preflight');
      setError(null);
    } catch (e) {
      setError(explainAuthError(e));
      setPhase('preflight');
    }
  };

  if (phase !== 'preflight') {
    return (
      <div class="landing">
        <h2>{phase === 'connecting' ? 'Waiting for sign-in' : 'Reading your tenant'}</h2>
        <p class="lede">
          {phase === 'connecting'
            ? 'Complete sign-in in the pop-up window. Nothing has been read yet.'
            : 'Every call below is a GET. Nothing is written, and nothing leaves this browser.'}
        </p>

        <ol class="steps">
          {COLLECTION_STEPS.map((step) => {
            const state: StepState = steps[step.key]?.state ?? 'pending';
            const detail = steps[step.key]?.detail;
            return (
              <li key={step.key} class={`step step--${state}`}>
                <span class="step-mark" aria-hidden="true" />
                <span class="step-body">
                  <span class="step-label">{step.label}</span>
                  <code class="step-endpoint">GET {step.endpoint}</code>
                  {detail && <span class="step-detail">{detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        <button class="btn" onClick={onCancel} style="margin-top:20px">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div class="landing">
      <h2>Connect to a tenant</h2>
      <p class="lede">
        Sign in and this reads your tenant directly. <strong>There is nothing to install and nothing to
        register</strong> — an administrator approves the permissions below once, and Microsoft adds the app to
        your directory. It cannot write to your tenant, and there is no server for your data to travel to.
      </p>

      <form onSubmit={start}>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn btn--primary" type="submit" disabled={!hasPublishedApp && !clientId.trim()}>
            Sign in and collect
          </button>
          <button class="btn" type="button" onClick={onCancel}>
            Back
          </button>
        </div>

        {error && (
          <div class="error" role="alert">
            <strong>Sign-in did not complete</strong>
            {error}
            {needsAdminConsent && (
              <div style="margin-top:12px">
                <button class="btn btn--primary" type="button" onClick={consent}>
                  Grant admin consent
                </button>
                <span style="margin-left:10px;font-size:12.5px;color:var(--ink-2)">
                  Only works if you hold one of the four roles below.
                </span>
              </div>
            )}
          </div>
        )}

        <div class="panel">
          <h3>What an administrator is approving</h3>
          <div class="tw">
            <table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Why it is needed</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {graphScopes.map((s) => (
                  <tr key={s.scope}>
                    <td>
                      <code class="sku">{s.scope}</code>
                    </td>
                    <td>{s.purpose}</td>
                    <td>
                      {loginScopeNames.includes(s.scope) ? (
                        <span class="pill">at sign-in</span>
                      ) : (
                        <span class="pill attention">only if used</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="note">
            <strong>Only the first three are requested at sign-in</strong>
            The other two depend on tenant entitlements — sign-in activity needs Entra ID P1, Secure Score needs
            Security Reader — so asking for them up front would fail sign-in in tenants that cannot grant them,
            taking the licence and spend analysis down with it. They are requested later, only if you use the
            sections that need them.
          </div>
          <div class="note">
            <strong>Consent does not require a Global Administrator</strong>
            These are delegated permissions, so Privileged Role Administrator, Cloud Application Administrator and
            Application Administrator can each grant tenant-wide consent as well.
          </div>
        </div>

        <div class="panel">
          <h3>
            <button
              type="button"
              class="disclosure"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced ? '▾' : '▸'} Use your own app registration
            </button>
          </h3>

          {advanced && (
            <>
              <p style="margin:0 0 14px;font-size:13.5px;color:var(--ink-2);line-height:1.55">
                {hasPublishedApp
                  ? 'For organisations that will not accept a third-party application in their directory. Register a '
                  : 'No published application is configured in this build, so supply your own. Register a '}
                <strong>Single-page application</strong> with redirect URI <code>{redirectUri()}</code>, add the
                delegated Microsoft Graph permissions above, and grant admin consent.
              </p>

              <div class="formrow">
                <label for="clientId">
                  Application (client) ID
                  <span>From the app registration overview</span>
                </label>
                <input
                  id="clientId"
                  type="text"
                  required={!hasPublishedApp}
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={clientId}
                  onInput={(e) => setClientId(e.currentTarget.value)}
                />
              </div>

              <div class="formrow">
                <label for="tenantId">
                  Tenant ID or domain <span>Optional — leave blank to choose at sign-in</span>
                </label>
                <input
                  id="tenantId"
                  type="text"
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="contoso.onmicrosoft.com"
                  value={tenantId}
                  onInput={(e) => setTenantId(e.currentTarget.value)}
                />
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
