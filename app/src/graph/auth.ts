import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-browser';

import { scopeNames } from './scopes';
import { rememberConfig, redirectUri, type AuthConfig } from './session';

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
  activeConfig = config;
  return instance;
}

export async function signIn(config: AuthConfig): Promise<SignedInContext> {
  const msal = await client(config);

  // A redirect may have just completed; adopt its result rather than prompting again.
  let result: AuthenticationResult | null = await msal.handleRedirectPromise();

  if (!result) {
    const existing = msal.getAllAccounts();
    const account = existing[0];
    if (account) {
      try {
        result = await msal.acquireTokenSilent({ scopes: scopeNames, account });
      } catch (e) {
        if (!(e instanceof InteractionRequiredAuthError)) throw e;
      }
    }
  }

  if (!result) {
    // A popup keeps the collection progress visible behind it, which matters when a
    // consultant is walking a customer through this on a shared screen.
    result = await msal.loginPopup({ scopes: scopeNames, prompt: 'select_account' });
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

export async function signOut(): Promise<void> {
  if (!instance) return;
  const account = instance.getActiveAccount();
  await instance.clearCache(account ? { account } : undefined);
  instance = null;
  activeConfig = null;
}
