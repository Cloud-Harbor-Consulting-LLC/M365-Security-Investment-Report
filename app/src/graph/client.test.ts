/**
 * Reading an image from Graph.
 *
 * Graph answers an unset branding logo with an empty JSON body, so the guard is that only
 * a raster image of a sane size ever becomes a data URI. The format is read from the file's
 * own bytes. An SVG is refused outright, because it can carry script.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GraphError, graphGetImage } from './client';

/** The 8-byte PNG signature, enough to be read as a PNG. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const respond =(body: BodyInit | null, init: ResponseInit) => {
  const fake = vi.fn(async () => new Response(body, init));
  vi.stubGlobal('fetch', fake);
  return fake;
};

afterEach(() => vi.unstubAllGlobals());

describe('graphGetImage', () => {
  it('returns a PNG as a data URI, asked for with a GET', async () => {
    const fake = respond(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(fake).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/x/squareLogo',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  // Graph's own docs show its logo answers as `image/*`, which names no format.
  it('reads the format from the file itself, not the header', async () => {
    respond(PNG, { status: 200, headers: { 'Content-Type': 'image/*' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBe('data:image/png;base64,iVBORw0KGgo=');
    respond(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBe('data:image/jpeg;base64,/9j/4A==');
  });

  it('refuses a file whose bytes are not an image, whatever the header says', async () => {
    respond('<html></html>', { status: 200, headers: { 'Content-Type': 'image/png' } });
    expect(await graphGetImage('/v1.0/x/squareLogo', 'token')).toBeNull();
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
