import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { graphScopes, loginScopeNames } from '@/graph/scopes';
import { COLLECTION_STEPS, collectSnapshot, type StepProgress, type StepState } from '@/graph/collect';
import {
  DEFAULT_CLIENT_ID,
  explainAuthError,
  forgetDeclined,
  hasPublishedApp,
  recallConfig,
  redirectUri,
  rememberDeclined,
  wasDeclined,
} from '@/graph/session';
import type { SignedInContext } from '@/graph/auth';
import type { Snapshot } from '@/model/snapshot';

interface Props {
  /** Returns an error message if analysis failed, so this screen can show it in place. */
  onSnapshot: (snapshot: Snapshot, sourceLabel: string) => string | null;
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
  /** Signed in, but the tenant has not approved everything this version asks for. */
  const [outstanding, setOutstanding] = useState<SignedInContext | null>(null);
  const [steps, setSteps] = useState<Record<string, StepProgress>>({});

  const config = () => ({
    clientId: (clientId || DEFAULT_CLIENT_ID).trim(),
    tenantId: tenantId.trim() || 'organizations',
  });

  const start = async (e: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setNeedsAdminConsent(false);
    setOutstanding(null);
    setPhase('connecting');

    try {
      // Loaded on demand: MSAL is ~245 KB and most visitors never sign in.
      const { signIn } = await import('@/graph/auth');
      const context = await signIn(config());

      // A tenant that approved an earlier version signs in fine on what it approved, so
      // nothing would otherwise tell its administrator that this version asks for more.
      // Stop before reading anything and say so. Opening Microsoft's consent screen from
      // here would be blocked as a pop-up nobody clicked for, so it waits for the button.
      // Once someone has chosen to go on without, this browser does not ask again until a
      // permission it has not seen goes missing.
      if (context.missingScopes.length > 0 && !wasDeclined(context.tenantId, context.missingScopes)) {
        setOutstanding(context);
        setPhase('preflight');
        return;
      }

      await collect(context);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNeedsAdminConsent(/AADSTS65001|AADSTS90094|consent_required|admin_consent|Need admin approval/i.test(message));
      setError(explainAuthError(e));
      setPhase('preflight');
    }
  };

  const collect = async (context: SignedInContext) => {
    setOutstanding(null);
    setPhase('collecting');
    try {
      const snapshot = await collectSnapshot(context, {
        onProgress: (p: StepProgress) => setSteps((prev) => ({ ...prev, [p.key]: p })),
      });

      const skus = snapshot.Collectors.subscribedSkus;
      if (!skus.Available) {
        setError(skus.Reason ?? 'The licence inventory could not be read, so there is nothing to analyse.');
        setPhase('preflight');
        return;
      }

      const failure = onSnapshot(
        snapshot,
        snapshot.Collectors.organization.Data?.DefaultDomain ?? 'connected tenant',
      );
      if (failure) {
        setError(failure);
        setPhase('preflight');
      }
    } catch (e) {
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

  /** Approves what is outstanding, then collects straight away on the new sign-in. */
  const consentAndCollect = async () => {
    const before = outstanding;
    setError(null);
    setPhase('connecting');
    try {
      const { grantAdminConsent } = await import('@/graph/auth');
      const context = await grantAdminConsent(config());
      forgetDeclined(context.tenantId);
      await collect(context);
    } catch (e) {
      // Keep the prompt, so "Continue without it" is still there for someone who turns
      // out not to hold one of the roles.
      setOutstanding(before);
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
        register</strong>. An administrator approves the permissions below once, and Microsoft adds the app to
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

        {outstanding && (
          <OutstandingConsent
            missing={outstanding.missingScopes}
            onGrant={consentAndCollect}
            onContinue={() => {
              rememberDeclined(outstanding.tenantId, outstanding.missingScopes);
              void collect(outstanding);
            }}
          />
        )}

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
              <caption>Permissions this sign-in requests, why each is needed and when</caption>
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  <th scope="col">Why it is needed</th>
                  <th scope="col">When</th>
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
                        <span class="pill">required</span>
                      ) : (
                        <span class="pill attention">degrades if absent</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="note">
            <strong>
              All {graphScopes.length} are requested at sign-in, and {loginScopeNames.length} of them are enough
            </strong>
            The others depend on the tenant. Sign-in activity needs Entra ID P1, Secure Score needs the Security
            Reader role, and per-account app usage needs the Reports Reader role. That affects whether the data
            comes back, not whether the permission can be granted. If your tenant cannot supply them, or you decline
            them, the report still builds from the first {loginScopeNames.length} and the sections that needed the
            others say so rather than guessing.
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
                delegated Microsoft Graph permissions above, and grant admin consent.{' '}
                {/* The one place someone is stuck mid-task and wants the long version. */}
                <a
                  href="https://github.com/Cloud-Harbor-Consulting-LLC/M365-Security-Investment-Report/blob/main/docs/APP-REGISTRATION.md"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Step-by-step guide
                </a>
                , including a script that creates it for you.
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
                  Tenant ID or domain <span>Optional, leave blank to choose at sign-in</span>
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

interface OutstandingConsentProps {
  missing: string[];
  onGrant: () => void;
  onContinue: () => void;
}

/**
 * Shown after sign-in when the tenant approved an earlier version and this one asks for
 * more. The administrator should never have to work out which permission to add: the
 * button opens Microsoft's own consent screen with the full list.
 */
export function OutstandingConsent({ missing, onGrant, onContinue }: OutstandingConsentProps): JSX.Element {
  const scopes = missing.map((name) => graphScopes.find((s) => s.scope === name) ?? { scope: name, purpose: '' });
  const one = scopes.length === 1;
  return (
    <div class="note warn" role="status">
      <strong>
        This version needs {one ? '1 permission' : `${scopes.length} permissions`} your tenant has not approved
        yet
      </strong>
      Your tenant approved an earlier version of this tool. Nothing has been read yet.
      <ul>
        {scopes.map((s) => (
          <li key={s.scope}>
            <code class="sku">{s.scope}</code>
            {s.purpose && <>: {s.purpose}</>}
          </li>
        ))}
      </ul>
      An administrator holding Global Administrator, Privileged Role Administrator, Cloud Application
      Administrator or Application Administrator can approve {one ? 'it' : 'them'} now. Microsoft's consent
      screen lists every permission this tool uses, and the ones already approved stay as they are. Nothing needs
      adding by hand.
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn--primary" type="button" onClick={onGrant}>
          Grant admin consent and collect
        </button>
        <button class="btn" type="button" onClick={onContinue}>
          Continue without {one ? 'it' : 'them'}
        </button>
      </div>
      <p style="margin:10px 0 0;font-size:12.5px;color:var(--ink-2)">
        Without {one ? 'it' : 'them'}, the sections that need {one ? 'it' : 'them'} are reported as not measured.
        This browser will not ask again about {one ? 'this permission' : 'these permissions'}.
      </p>
    </div>
  );
}
