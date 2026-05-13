import { describe, expect, it } from 'vitest';

import { describeDohInsight } from '../../../src/lib/dns/doh-insight';

describe('describeDohInsight', () => {
  it('labels DNS-over-HTTPS as outside resolver evidence', () => {
    expect(describeDohInsight({
      hostname: 'api.example.com',
      resolver: 'cloudflare-doh',
      records: ['203.0.113.10'],
      durationMs: 35,
    })).toMatchObject({
      vantage: 'outside-resolver',
      headline: 'Cloudflare DNS-over-HTTPS resolved api.example.com',
      detail: '1 DNS record returned in 35 ms. This is outside resolver evidence, not your local DNS path.',
    });
  });

  it('keeps empty answers evidence-scoped', () => {
    const insight = describeDohInsight({
      hostname: 'missing.example.com',
      resolver: 'cloudflare-doh',
      records: [],
      durationMs: 22,
    });

    expect(insight).toMatchObject({
      vantage: 'outside-resolver',
      headline: 'Cloudflare DNS-over-HTTPS found no records for missing.example.com',
    });
    expect(insight.detail).toContain('outside resolver evidence');
    expect(insight.detail).not.toMatch(/your DNS|local resolver failed|ISP/i);
  });
});
