/**
 * The usage collector, against a stubbed Graph.
 *
 * What is guarded is what the report would get wrong without it: an empty answer read as
 * nobody using the desktop apps, a concealed report read as names, and a refusal that
 * does not say which permission and which role would fix it.
 */
import { describe, expect, it, vi } from 'vitest';

import { collectAppUsage } from './collect';
import { GraphError } from './client';

const answer = vi.hoisted(() => ({ rows: [] as unknown[], error: null as unknown }));
vi.mock('./client', async (original) => {
  const real = await original<typeof import('./client')>();
  return {
    ...real,
    graphGet: async () => {
      if (answer.error) throw answer.error;
      return answer.rows;
    },
  };
});

describe('Microsoft 365 apps usage', () => {
  const row = (upn: string, platforms: Partial<Record<'windows' | 'mac' | 'mobile' | 'web', boolean>>) => ({
    reportRefreshDate: '2026-10-28',
    userPrincipalName: upn,
    details: [{ reportPeriod: 90, windows: false, mac: false, mobile: false, web: false, ...platforms, wordWindows: true }],
  });

  it('keeps the 4 platform flags and nothing else', async () => {
    answer.error = null;
    answer.rows = [row('ada@contoso.com', { windows: true, web: true }), row('alan@contoso.com', { mobile: true })];
    const result = await collectAppUsage('token');
    expect(result.Available).toBe(true);
    expect(result.Data).toEqual({
      PeriodDays: 90,
      ReportRefreshDate: '2026-10-28',
      Concealed: false,
      Users: [
        { UserPrincipalName: 'ada@contoso.com', Windows: true, Mac: false, Mobile: false, Web: true },
        { UserPrincipalName: 'alan@contoso.com', Windows: false, Mac: false, Mobile: true, Web: false },
      ],
    });
  });

  it('records that the tenant conceals names, rather than working around it', async () => {
    answer.error = null;
    answer.rows = [row('3F8A1C0E9B7D2A4C6E1F0B3D5A7C9E2F', { windows: true })];
    const result = await collectAppUsage('token');
    expect(result.Data?.Concealed).toBe(true);
  });

  it('treats an empty report as not collected, never as nobody using the apps', async () => {
    // Global Reader gets a successful, empty answer. Read as data, it would flag every
    // licensed account in the tenant.
    answer.error = null;
    answer.rows = [];
    const result = await collectAppUsage('token');
    expect(result.Available).toBe(false);
    expect(result.Reason).toMatch(/Global Reader sees only tenant totals/);
  });

  it('names the permission and the role when Graph refuses', async () => {
    answer.error = new GraphError('Forbidden', 403, 'UnknownError', '/v1.0/reports');
    const result = await collectAppUsage('token');
    expect(result.Available).toBe(false);
    expect(result.Reason).toMatch(/Reports\.Read\.All and a reports role such as Reports Reader/);
  });
});
