import { useState } from 'preact/hooks';
import type { JSX } from 'preact';

import { graphScopes } from '@/graph/scopes';
import { COLLECTION_STEPS, collectSnapshot, type StepProgress, type StepState } from '@/graph/collect';
import { explainAuthError, recallConfig, redirectUri } from '@/graph/session';
import type { Snapshot } from '@/model/snapshot';

interface Props {
  onSnapshot: (snapshot: Snapshot, sourceLabel: string) => void;
  onCancel: () => void;
}

type Phase = 'preflight' | 'connecting' | 'collecting';

export function Connect({ onSnapshot, onCancel }: Props): JSX.Element {
  const remembered = recallConfig();
  const [clientId, setClientId] = useState(remembered.clientId ?? '');
  const [tenantId, setTenantId] = useState(remembered.tenantId ?? '');
  const [phase, setPhase] = useState<Phase>('preflight');
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, StepProgress>>({});

  const start = async (e: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setPhase('connecting');

    try {
      // Loaded on demand: MSAL is ~250 KB and most visitors never sign in.
      const { signIn } = await import('@/graph/auth');
      const context = await signIn({ clientId: clientId.trim(), tenantId: tenantId.trim() || 'organizations' });
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
        You will be asked to consent to the five read-only permissions below and nothing else. This tool cannot
        write to your tenant, and there is no server for your data to travel to.
      </p>

      <div class="panel" style="margin-top:0">
        <h3>What you are about to grant</h3>
        <div class="tw">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                <th>Why it is needed</th>
                <th>Least-privilege role</th>
              </tr>
            </thead>
            <tbody>
              {graphScopes.map((s) => (
                <tr key={s.scope}>
                  <td>
                    <code class="sku">{s.scope}</code>
                    {!s.required && <span class="pill" style="margin-left:6px">optional</span>}
                  </td>
                  <td>{s.purpose}</td>
                  <td>{s.leastPrivilegeRole}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="note">
          <strong>Consent does not require a Global Administrator</strong>
          These are delegated permissions, so Privileged Role Administrator, Cloud Application Administrator and
          Application Administrator can each grant tenant-wide consent as well.
        </div>
      </div>

      <form class="panel" onSubmit={start}>
        <h3>App registration</h3>
        <p style="margin:0 0 14px;font-size:13.5px;color:var(--ink-2);line-height:1.55">
          Supply an app registration in the tenant you are assessing. Register it as a{' '}
          <strong>Single-page application</strong> with redirect URI <code>{redirectUri()}</code>, add the five
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
            required
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

        {error && (
          <div class="error" role="alert">
            <strong>Sign-in did not complete</strong>
            {error}
          </div>
        )}

        <div style="display:flex;gap:10px;margin-top:18px">
          <button class="btn btn--primary" type="submit">
            Sign in and collect
          </button>
          <button class="btn" type="button" onClick={onCancel}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
