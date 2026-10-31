/**
 * The tenant logo, against a stubbed Graph.
 *
 * A logo is decoration, so what is guarded is that it can never cost the report anything:
 * an unset logo, an odd answer or a refusal all leave tenant identity collected, and only
 * a raster image is ever kept.
 */
import { describe, expect, it, vi } from 'vitest';

import { collectOrganization } from './collect';
import { GraphError } from './client';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const DARK = 'data:image/png;base64,ZGFyaw==';

const graph = vi.hoisted(() => ({
  images: {} as Record<string, string | null | Error>,
  paths: [] as string[],
}));
vi.mock('./client', async (original) => {
  const real = await original<typeof import('./client')>();
  return {
    ...real,
    graphGet: async () => ({
      value: [
        {
          id: '8f4b2c19-6d3a-4e57-9b81-2a7c5d0e3f64',
          displayName: 'Contoso Ltd',
          verifiedDomains: [{ name: 'contoso.com', isDefault: true, isInitial: false }],
        },
      ],
    }),
    graphGetImage: async (path: string) => {
      graph.paths.push(path);
      const name = path.split('/').pop()!;
      const answer = graph.images[name] ?? null;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
});

describe('the tenant logo', () => {
  it('reads both square logos from the default company branding', async () => {
    graph.paths = [];
    graph.images = { squareLogo: PNG, squareLogoDark: DARK };
    const org = await collectOrganization('token');
    expect(org.Data?.Logo).toEqual({ Light: PNG, Dark: DARK });
    expect(graph.paths.sort()).toEqual([
      '/v1.0/organization/8f4b2c19-6d3a-4e57-9b81-2a7c5d0e3f64/branding/localizations/default/squareLogo',
      '/v1.0/organization/8f4b2c19-6d3a-4e57-9b81-2a7c5d0e3f64/branding/localizations/default/squareLogoDark',
    ]);
  });

  it('is null when the tenant set no branding', async () => {
    graph.images = {};
    const org = await collectOrganization('token');
    expect(org.Available).toBe(true);
    expect(org.Data?.Logo).toBeNull();
    expect(org.Notes).toEqual([]);
  });

  it('leaves tenant identity collected when the logo is refused, and says so', async () => {
    graph.images = {
      squareLogo: new GraphError('Graph GET failed with HTTP 403: denied', 403, 'Authorization_RequestDenied', '/x'),
      squareLogoDark: DARK,
    };
    const org = await collectOrganization('token');
    expect(org.Available).toBe(true);
    expect(org.Degraded).toBe(false);
    expect(org.Data?.DisplayName).toBe('Contoso Ltd');
    expect(org.Data?.Logo).toEqual({ Light: null, Dark: DARK });
    expect(org.Notes.join(' ')).toMatch(/company logo was not read: Access denied \(403/);
  });
});
