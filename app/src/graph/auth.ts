import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';

import { loginScopeNames, signInScopeNames } from './scopes';
import { hasAuthResponseInUrl, rememberConfig, redirectUri, type AuthConfig } from './session';

/**
 * Browser authentication.
 *
 * Authorization code flow with PKCE — no client secret, which is the only correct choice
 * for a static site with no backend to keep one in. Tokens live in session storage and
 * die with the tab; they are never written to an export, a session file, or localStorage.
 *
 * This module is imported dynamically so the ~250 KB MSAL bundle only loads for visitors
 * who actually choose to connect.
 */

export interface SignedInContext {
  account: AccountInfo;
  accessToken: string;
  /** Scopes the token actually carries, which can exceed or fall short of what we asked. */
  grantedScopes: string[];
  tenantId: string;
}

let instance: PublicClientApplication | null = null;
let activeConfig: AuthConfig | null = null;

async function client(config: AuthConfig): Promise<PublicClientApplication> {
  if (instance && activeConfig?.clientId === config.clientId && activeConfig.tenantId === config.tenantId) {
    return instance;
  }

  instance = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId || 'organizations'}`,
      redirectUri: redirectUri(),
    },
    cache: {
      // Session, not local: the token should not outlive the tab.
      cacheLocation: 'sessionStorage',
    },
  });

  await instance.initialize();

  // Exactly once per instance, immediately after initialize() and before any other API
  // call — that is MSAL's documented contract. Calling it per sign-in instead meant the
  // second attempt ran it against an already-completed flow and threw
  // no_token_request_cache_error, which is what a returning user hit.
  //
  // A leftover response with no matching request in the cache is a stale artefact of a
  // previous attempt, not a reason to block a fresh sign-in, so it is cleared rather
  // than surfaced.
  try {
    await instance.handleRedirectPromise();
  } catch {
    if (hasAuthResponseInUrl(window.location.hash, window.location.search)) {
      history.replaceState(null, '', window.location.pathname + window.location.search.replace(/[?&]?(code|state|session_state|error[^&]*)=[^&]*/g, ''));
    }
  }

  activeConfig = config;
  return instance;
}

/**
 * Distinguishes "the admin said no to a permission" from "the user closed the window".
 *
 * Only the first is worth retrying at a reduced scope set. Retrying a cancelled popup
 * would reopen it, which reads as the tool refusing to take no for an answer.
 */
export function isConsentDeclined(e: unknown): boolean {
  const code = (e as { errorCode?: string })?.errorCode ?? '';
  const message = (e as { errorMessage?: string })?.errorMessage ?? '';
  if (code === 'user_cancelled' || code === 'popup_window_error') return false;
  // AADSTS65004: user declined consent. AADSTS65005/900971 cover the app-config variants.
  return (
    code === 'access_denied' ||
    code === 'consent_required' ||
    /AADSTS65004|AADSTS65005|consent/i.test(message)
  );
}

export async function signIn(config: AuthConfig): Promise<SignedInContext> {
  // client() has already awaited handleRedirectPromise() for this instance.
  const msal = await client(config);

  let result: AuthenticationResult | null = null;

  // Reuse an existing session silently rather than prompting again.
  const account = msal.getAllAccounts()[0];
  if (account) {
    try {
      result = await msal.acquireTokenSilent({ scopes: signInScopeNames, account });
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError)) throw e;
    }
    // The session may predate a scope, or have been consented at the reduced set. Fall
    // back to what is definitely already granted rather than forcing a prompt.
    if (!result) {
      try {
        result = await msal.acquireTokenSilent({ scopes: loginScopeNames, account });
      } catch (e) {
        if (!(e instanceof InteractionRequiredAuthError)) throw e;
      }
    }
  }

  if (!result) {
    // A popup keeps the collection progress visible behind it, which matters when a
    // consultant is walking a customer through this on a shared screen.
    try {
      result = await msal.loginPopup({ scopes: signInScopeNames, prompt: 'select_account' });
    } catch (e) {
      // Entra consent is all-or-nothing, so a declined permission fails the whole
      // sign-in. Retry at the required set: a partial report beats no report, and the
      // sections that needed the declined scope will say so themselves.
      if (!isConsentDeclined(e)) throw e;
      result = await msal.loginPopup({ scopes: loginScopeNames, prompt: 'select_account' });
    }
  }

  if (!result.account) throw new Error('Sign-in completed without returning an account.');

  msal.setActiveAccount(result.account);
  rememberConfig(config);

  return {
    account: result.account,
    accessToken: result.accessToken,
    grantedScopes: result.scopes ?? [],
    tenantId: result.account.tenantId || config.tenantId,
  };
}

/**
 * Asks for an entitlement-gated scope at the moment the feature needing it is used.
 *
 * Returns null rather than throwing when the tenant cannot grant it: a tenant without
 * Entra ID P1 should still get every section that does not depend on sign-in activity,
 * with the rest reported as not measured.
 */
export async function requestAdditionalScope(
  config: AuthConfig,
  scopes: string[],
  /**
   * Silent-only by default. Interrupting a running collection with an unexpected popup
   * is worse than degrading the section that needed the scope — the report already
   * knows how to say "not measured, and here is why".
   */
  options: { interactive?: boolean } = {},
): Promise<SignedInContext | null> {
  const msal = await client(config);
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) return null;

  try {
    let result: AuthenticationResult;
    try {
      result = await msal.acquireTokenSilent({ scopes, account });
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError)) throw e;
      if (!options.interactive) return null;
      result = await msal.acquireTokenPopup({ scopes, account });
    }

    return {
      account: result.account ?? account,
      accessToken: result.accessToken,
      grantedScopes: result.scopes ?? [],
      tenantId: (result.account ?? account).tenantId || config.tenantId,
    };
  } catch {
    return null;
  }
}

/**
 * Runs the tenant-wide admin consent flow.
 *
 * Entra creates the enterprise application in the administrator's tenant as a side
 * effect of consent — no app registration is created by this tool, which is what keeps
 * the read-only guarantee intact.
 */
export async function grantAdminConsent(
  config: AuthConfig,
  // Everything, so one trip through the consent screen leaves nothing to ask for later.
  scopes: string[] = signInScopeNames,
): Promise<void> {
  const msal = await client(config);
  await msal.loginPopup({ scopes, prompt: 'admin_consent' });
}

export async function signOut(): Promise<void> {
  if (!instance) return;
  const account = instance.getActiveAccount();
  await instance.clearCache(account ? { account } : undefined);
  instance = null;
  activeConfig = null;
}
