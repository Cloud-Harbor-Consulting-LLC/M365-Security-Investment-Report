/**
 * Session identifiers and error explanation.
 *
 * Deliberately free of any MSAL import so the landing page does not pay for a ~250 KB
 * auth library that most visitors never use. The MSAL-dependent half lives in auth.ts
 * and is loaded on demand when someone actually chooses to connect.
 */

const CLIENT_ID_KEY = 'chsi.clientId';
const TENANT_KEY = 'chsi.tenantId';

/**
 * The published multi-tenant app registration.
 *
 * Nobody signing in has to create anything: this registration exists once, in the
 * project's own tenant, and Entra creates the enterprise application in the visitor's
 * tenant automatically when an administrator consents. Supplying your own client ID is
 * an option for organisations that will not accept a third-party app in their
 * directory, not a prerequisite.
 *
 * Not a secret. A single-page application cannot hold one, and this value ships in the
 * bundle by design — the security boundary is the redirect URI and the tenant's consent,
 * not the client ID.
 *
 * Forking and self-hosting requires your own registration, because the redirect URI must
 * match the site serving the app. Create one with scripts/New-AppRegistration.ps1 and
 * set VITE_MSAL_CLIENT_ID at build time.
 */
const PUBLISHED_CLIENT_ID = 'ea075feb-b36d-4305-93b5-50768e521196';

export const DEFAULT_CLIENT_ID: string = import.meta.env['VITE_MSAL_CLIENT_ID'] ?? PUBLISHED_CLIENT_ID;

export const hasPublishedApp = DEFAULT_CLIENT_ID.length > 0;

export interface AuthConfig {
  /** Application (client) ID of an app registration with a SPA redirect URI. */
  clientId: string;
  /** Tenant id or domain, or 'organizations' to let the sign-in choose. */
  tenantId: string;
}

/**
 * Clears a stale authorization response out of the URL.
 *
 * An unconsumed response makes MSAL's isInPopup() preflight true, after which every
 * acquireTokenSilent in the session fails with block_nested_popups. MSAL supports a
 * hybrid response format, so both the hash and the query string have to be checked.
 */
export function hasAuthResponseInUrl(hash: string, search: string): boolean {
  if (new URLSearchParams(hash.replace(/^#/, '')).has('state')) return true;
  return new URLSearchParams(search.replace(/^\?/, '')).has('state');
}

/**
 * The sign-in redirect target.
 *
 * Points at a blank page rather than the app itself. With the app as the redirect URI,
 * the popup boots the entire single-page application a second time, which is wasteful
 * and interferes with the opener/popup handshake — the observed symptom was the main
 * window losing its state and returning to the landing screen mid-sign-in.
 *
 * Derived from the page rather than hardcoded, so the same build works on the Pages URL,
 * on a custom domain, and on localhost. Each origin needs registering once.
 */
export function redirectUri(): string {
  return new URL(`${import.meta.env.BASE_URL}blank.html`, window.location.origin).href;
}

/** The app's own address, shown in setup instructions. */
export function appUri(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** Remembers only the identifiers needed to reconnect. Never a token. */
export function rememberConfig(config: AuthConfig): void {
  try {
    sessionStorage.setItem(CLIENT_ID_KEY, config.clientId);
    sessionStorage.setItem(TENANT_KEY, config.tenantId);
  } catch {
    // Private browsing can refuse storage. Not being able to prefill a field next time
    // is not worth interrupting anyone over.
  }
}

export function recallConfig(): Partial<AuthConfig> {
  try {
    return {
      clientId: sessionStorage.getItem(CLIENT_ID_KEY) ?? undefined,
      tenantId: sessionStorage.getItem(TENANT_KEY) ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Turns MSAL's failure modes into something a person can act on. The default messages
 * name OAuth concepts rather than what the reader should do next, and every one of these
 * is a real setup mistake someone will make on their first attempt.
 */
export function explainAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/AADSTS650053|invalid_scope/i.test(message)) {
    return 'The app registration does not expose one of the required Microsoft Graph permissions. Add all five delegated permissions to it, then grant admin consent.';
  }
  if (/AADSTS65001|consent_required|interaction_required/i.test(message)) {
    return 'An administrator has not consented to these permissions yet. Someone with Global Administrator, Privileged Role Administrator, Cloud Application Administrator or Application Administrator can grant it.';
  }
  if (/AADSTS50011|redirect_uri/i.test(message)) {
    return `The redirect URI does not match the app registration. Add ${redirectUri()} as a Single-page application redirect URI.`;
  }
  if (/AADSTS700016|unauthorized_client/i.test(message)) {
    return 'That client ID was not found in this tenant. Check the Application (client) ID, and that the registration allows accounts in this directory.';
  }
  if (/AADSTS90094|admin_consent_required|Need admin approval/i.test(message)) {
    return 'This tenant requires an administrator to approve these permissions before anyone can use them. Ask someone holding Global Administrator, Privileged Role Administrator, Cloud Application Administrator or Application Administrator to sign in here once and consent.';
  }
  if (/block_nested_popups/i.test(message)) {
    return 'A previous sign-in left this page in an inconsistent state. Reload the page and try again.';
  }
  if (/popup_window_error|user_cancelled|popup/i.test(message)) {
    return 'The sign-in window was closed or blocked. Allow pop-ups for this site and try again.';
  }
  return message;
}
