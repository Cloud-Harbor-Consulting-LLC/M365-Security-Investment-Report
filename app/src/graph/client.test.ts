/**
 * Reading an image from Graph.
 *
 * Graph answers an unset branding logo with an empty JSON body, so the guard is that only
 * a raster image of a sane size ever becomes a data URI. An SVG is refused outright,
 * because it can carry script.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GraphError, graphGetImage } from './client';

const respond = (body: BodyInit | null, init: ResponseInit) => {
  const fake = vi.fn(async () => new Response(body, init));
  vi.stubGlobal('fetch', fake);
  return fake;
};

afterEach(() => vi.unstubAllGlobals());

describe('graphGetImage', () => {
  it('returns a PNG as a data URI, asked for with a GET', async () => {
    const fake = respond(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBe('data:image/png;base64,iVBORw==');
    expect(fake).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/x/squareLogo',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads the empty answer for an unset logo as no logo', async () => {
    respond('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBeNull();
  });

  it('refuses an SVG', async () => {
    respond('<svg onload="alert(1)"/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBeNull();
  });

  it('refuses an image too large to be a logo', async () => {
    respond(new Uint8Array(300_000), { status: 200, headers: { 'Content-Type': 'image/png' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBeNull();
  });

  it('reads a 404 as no logo, and throws on a refusal', async () => {
    respond(null, { status: 404 });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBeNull();
    respond('{"error":{"code":"Authorization_RequestDenied","message":"denied"}}', { status: 403 });
    await expect(graphGetImage('/v1.0/x/squareLogo', 'token')).rejects.toBeInstanceOf(GraphError);
  });

  it('will not send the token anywhere but Graph', async () => {
    respond(null, { status: 200 });
    await expect(graphGetImage('https://example.com/logo.png', 'token')).rejects.toBeInstanceOf(GraphError);
  });
});
