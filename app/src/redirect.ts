/**
 * The MSAL redirect bridge.
 *
 * MSAL v5 changed how a popup returns its result: instead of the opener polling the
 * popup's URL, the redirect page hands the authorization response back over the
 * BroadcastChannel API. A blank redirect page therefore never completes the handshake —
 * the popup simply sits there and the caller eventually fails with `timed_out`.
 *
 * This module is the entire contents of that page. It must stay that way: the
 * documented requirements are that the redirect page runs the bridge and nothing else,
 * carries no routing logic that could consume the hash, and has a real <title> so a
 * browser never displays a raw URL containing an authorization code.
 */
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

broadcastResponseToMainFrame();
