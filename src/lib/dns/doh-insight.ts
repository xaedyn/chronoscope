export interface DohInsightInput {
  readonly hostname: string;
  readonly resolver: 'cloudflare-doh';
  readonly records: readonly string[];
  readonly durationMs: number;
}

export interface DohInsight {
  readonly vantage: 'outside-resolver';
  readonly headline: string;
  readonly detail: string;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function describeDohInsight(input: DohInsightInput): DohInsight {
  const duration = Math.round(input.durationMs);
  if (input.records.length === 0) {
    return {
      vantage: 'outside-resolver',
      headline: `Cloudflare DNS-over-HTTPS found no records for ${input.hostname}`,
      detail: `No DNS records were returned in ${duration} ms. This is outside resolver evidence, not your local DNS path.`,
    };
  }

  return {
    vantage: 'outside-resolver',
    headline: `Cloudflare DNS-over-HTTPS resolved ${input.hostname}`,
    detail: `${input.records.length} DNS ${plural(input.records.length, 'record')} returned in ${duration} ms. This is outside resolver evidence, not your local DNS path.`,
  };
}
