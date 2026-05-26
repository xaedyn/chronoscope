import { describe, expect, it } from 'vitest';
import {
  buildGuidedProofFlow,
  buildProofActionState,
  isProofStale,
  proofFreshnessLabel,
  summarizeRemoteProof,
} from '../../../src/lib/utils/proof-flow';
import type { RemoteVantageProbeResponse } from '../../../src/lib/remote-vantage/types';
import type { CompanionState } from '../../../src/lib/stores/companion';
import type { RemoteVantageState } from '../../../src/lib/stores/remote-vantage';
import type { DiagnosticReport } from '../../../src/lib/utils/diagnostic-report';

const cleanProbe: RemoteVantageProbeResponse = {
  ok: true,
  generatedAt: 1778352005000,
  edge: { colo: 'IAD', city: 'Ashburn', country: 'US' },
  results: [{
    endpointId: 'api',
    label: 'API',
    url: 'https://api.example.com',
    ok: true,
    status: 200,
    statusText: 'OK',
    durationMs: 42,
    checkedAt: 1778352005000,
    verdict: 'reachable',
    headers: {},
  }],
};

const slowProbe: RemoteVantageProbeResponse = {
  ...cleanProbe,
  results: [{
    ...cleanProbe.results[0],
    durationMs: 310,
    verdict: 'slow',
  }],
};

const emptyRemote: RemoteVantageState = {
  status: 'idle',
  health: null,
  lastProbe: null,
  hostedReport: null,
  hostedReportFallback: null,
  error: null,
};

const emptyCompanion: CompanionState = {
  baseUrl: 'http://127.0.0.1:47317',
  hasSecret: false,
  status: 'idle',
  version: null,
  capabilities: null,
  lastProbe: null,
  history: [],
  error: null,
};

function diagnosticReport(kind: DiagnosticReport['diagnosis']['kind'] = 'isolated-endpoint'): DiagnosticReport {
  const isHealthy = kind === 'healthy';
  return {
    reportKind: 'support',
    modeKicker: 'Support report',
    modeLede: 'Measured browser run',
    copySummaryLabel: 'Copy summary',
    diagnosis: {
      verdict: {
        tone: isHealthy ? 'good' : 'bad',
        message: isHealthy ? 'All endpoints look healthy.' : 'API is slower than the others.',
        worstEpId: isHealthy ? undefined : 'api',
      },
      kind,
      severity: isHealthy ? 'healthy' : 'degraded',
      confidence: isHealthy ? 'high' : 'medium',
      confidenceLabel: isHealthy ? 'High confidence' : 'Medium confidence',
      confidenceReason: 'Based on mature samples across three endpoints.',
      primaryAnswer: {
        id: kind,
        kind: isHealthy ? 'measured' : 'inferred',
        strength: isHealthy ? 'high' : 'medium',
        text: isHealthy ? 'This browser run looks healthy.' : 'API is slower than the others in this test.',
        evidenceIds: ['ready-endpoints'],
        requiredEvidence: ['sample-actionable'],
      },
      claims: [],
      primaryValidation: {
        id: isHealthy ? 'share-snapshot' : 'run-remote-check',
        label: isHealthy ? 'Share snapshot' : 'Run outside check',
        reason: isHealthy ? 'Preserve the baseline.' : 'Compare with a second vantage.',
        claim: {
          id: 'run-outside-check-next',
          kind: 'next-validation',
          strength: 'medium',
          text: 'Run an outside check before naming a cause.',
          evidenceIds: [],
          requiredEvidence: ['remote-vantage'],
        },
        endpointId: isHealthy ? undefined : 'api',
      },
      safeSummary: isHealthy ? 'Clean browser baseline.' : 'Browser evidence points at API.',
      supportingSummary: isHealthy
        ? 'All enabled endpoints are inside threshold.'
        : 'API is above threshold while peers remain clean.',
      snapshotEligibility: { eligible: true, reason: 'Ready', facts: [] },
      explanation: isHealthy ? 'This test looks healthy.' : 'API is slower than the others in this test.',
      evidence: [],
      limitations: [{
        id: 'browser-sandbox',
        headline: 'Browser-only evidence',
        detail: 'The browser cannot see DNS, route, or Wi-Fi internals.',
      }],
      triageActions: [],
      nextSteps: [],
      timingVisibility: {
        level: 'total-only',
        headline: 'Total timing only',
        detail: 'The browser exposes total request time.',
        okSampleCount: 90,
        phaseSampleCount: 0,
      },
      highlightedEndpoint: isHealthy ? undefined : { id: 'api', label: 'API' },
    } as DiagnosticReport['diagnosis'],
    endpointRows: [
      {
        endpointId: 'api',
        label: 'API',
        url: 'https://api.example.com',
        color: '#67e8f9',
        enabled: true,
        sampleCount: 35,
        okCount: 35,
        p50: isHealthy ? 42 : 240,
        p95: isHealthy ? 60 : 310,
        p99: isHealthy ? 75 : 340,
        jitter: 8,
        lossPercent: 0,
        lastLatency: isHealthy ? 44 : 250,
        status: isHealthy ? 'ok' : 'slow',
        statusLabel: isHealthy ? 'ok' : 'inspect',
        implicated: !isHealthy,
      },
      {
        endpointId: 'google',
        label: 'Google',
        url: 'https://google.example.com',
        color: '#38bdf8',
        enabled: true,
        sampleCount: 35,
        okCount: 35,
        p50: 45,
        p95: 62,
        p99: 80,
        jitter: 6,
        lossPercent: 0,
        lastLatency: 47,
        status: 'ok',
        statusLabel: 'ok',
        implicated: false,
      },
    ],
    threshold: 120,
    thresholdSource: 'local-default',
    corsMode: 'no-cors',
    corsModeSource: 'local-default',
    roundCount: 35,
    totalSampleCount: 70,
    keptSampleCount: 70,
    truncated: false,
    createdAt: 1778352000000,
    createdLabel: 'May 9, 2026, 12:00 PM',
    timelineSummary: 'Mature sample window.',
    timelineEvents: [],
    copySummary: 'Diagnostic report.',
  };
}

function guidedStep(
  flow: ReturnType<typeof buildGuidedProofFlow>,
  id: ReturnType<typeof buildGuidedProofFlow>['steps'][number]['id'],
) {
  return flow.steps.find((step) => step.id === id);
}

describe('proof-flow', () => {
  it('marks proof as stale when a report is newer than the captured proof', () => {
    expect(isProofStale({ reportCreatedAt: 2000, proofGeneratedAt: 1000 })).toBe(true);
    expect(isProofStale({ reportCreatedAt: 1000, proofGeneratedAt: 2000 })).toBe(false);
  });

  it('uses compact freshness labels', () => {
    expect(proofFreshnessLabel({ reportCreatedAt: 2000, proofGeneratedAt: 1000 })).toBe('Stale');
    expect(proofFreshnessLabel({ reportCreatedAt: 1000, proofGeneratedAt: 2000 })).toBe('Fresh');
    expect(proofFreshnessLabel({ reportCreatedAt: 1000, proofGeneratedAt: null })).toBe('Not run');
  });

  it('summarizes outside proof without causal overclaiming', () => {
    expect(summarizeRemoteProof(cleanProbe)).toMatchObject({
      tone: 'good',
      status: 'Captured',
      text: 'Cloudflare reached 1 endpoint without slow or failed results',
    });
    expect(summarizeRemoteProof(slowProbe)).toMatchObject({
      tone: 'bad',
      status: 'Captured',
      text: '1/1 endpoint was slow or failed from Cloudflare',
    });
  });

  it('maps running and failed actions to visible card states', () => {
    expect(buildProofActionState({
      kind: 'remote',
      status: 'probing',
      hasProof: false,
      hasError: false,
    })).toMatchObject({
      label: 'Running',
      disabled: true,
      tone: 'watch',
    });
    expect(buildProofActionState({
      kind: 'remote',
      status: 'error',
      hasProof: false,
      hasError: true,
    })).toMatchObject({
      label: 'Failed',
      disabled: false,
      tone: 'watch',
    });
    expect(buildProofActionState({
      kind: 'local',
      status: 'error',
      hasProof: false,
      hasError: true,
      hasSecret: false,
    })).toMatchObject({
      label: 'Needs setup',
      disabled: false,
      tone: 'watch',
    });
    expect(buildProofActionState({
      kind: 'local',
      status: 'error',
      hasProof: false,
      hasError: true,
      hasSecret: true,
    })).toMatchObject({
      label: 'Needs check',
      disabled: false,
      tone: 'watch',
    });
  });

  it('marks captured proof actions as stale when the proof predates the report', () => {
    expect(buildProofActionState({
      kind: 'remote',
      status: 'connected',
      hasProof: true,
      hasError: false,
      isStale: true,
    })).toMatchObject({
      label: 'Stale',
      disabled: false,
      tone: 'watch',
    });
  });

  it('recommends an outside check for browser-only isolated endpoint evidence', () => {
    const flow = buildGuidedProofFlow({
      report: diagnosticReport('isolated-endpoint'),
      remoteVantage: emptyRemote,
      companion: emptyCompanion,
    });

    expect(flow.targetEndpointId).toBe('api');
    expect(flow.measured).toContain('API');
    expect(flow.cannotProve).toMatch(/outside vantage/i);
    expect(flow.primaryAction).toMatchObject({
      id: 'run-outside',
      label: 'Run outside check',
      endpointId: 'api',
      disabled: false,
    });
    expect(guidedStep(flow, 'outside')).toMatchObject({
      status: 'recommended',
      tone: 'watch',
    });
  });

  it('shows outside proof in progress and disables duplicate outside actions', () => {
    const flow = buildGuidedProofFlow({
      report: diagnosticReport('isolated-endpoint'),
      remoteVantage: { ...emptyRemote, status: 'probing' },
      companion: emptyCompanion,
    });

    expect(flow.primaryAction).toMatchObject({
      id: 'wait-outside',
      disabled: true,
    });
    expect(guidedStep(flow, 'outside')).toMatchObject({
      status: 'running',
      summary: 'Cloudflare edge check is running for API.',
    });
  });

  it('keeps the diagnosis bounded when outside evidence is clean', () => {
    const flow = buildGuidedProofFlow({
      report: diagnosticReport('isolated-endpoint'),
      remoteVantage: { ...emptyRemote, status: 'connected', lastProbe: cleanProbe },
      companion: emptyCompanion,
    });

    expect(guidedStep(flow, 'outside')).toMatchObject({
      status: 'captured',
      summary: 'Cloudflare reached API cleanly in 42 ms.',
    });
    expect(flow.suggests).toMatch(/browser path|local network/i);
    expect(`${flow.suggests} ${flow.next}`).not.toMatch(/root cause|router|ISP|blame/i);
    expect(flow.primaryAction).toMatchObject({
      id: 'open-report',
      label: 'Open report',
    });
  });

  it('strengthens the report when outside evidence sees the same endpoint slow', () => {
    const flow = buildGuidedProofFlow({
      report: diagnosticReport('isolated-endpoint'),
      remoteVantage: { ...emptyRemote, status: 'connected', lastProbe: slowProbe },
      companion: emptyCompanion,
    });

    expect(guidedStep(flow, 'outside')).toMatchObject({
      status: 'captured',
      tone: 'bad',
      summary: 'Cloudflare also saw API slow in 310 ms.',
    });
    expect(guidedStep(flow, 'report')).toMatchObject({
      status: 'ready',
      summary: 'Report can include browser evidence plus the outside check.',
    });
    expect(flow.primaryAction).toMatchObject({
      id: 'open-report',
      label: 'Open strengthened report',
    });
  });

  it('keeps outside proof optional for a healthy browser baseline', () => {
    const flow = buildGuidedProofFlow({
      report: diagnosticReport('healthy'),
      remoteVantage: emptyRemote,
      companion: emptyCompanion,
    });

    expect(guidedStep(flow, 'outside')).toMatchObject({
      status: 'optional',
      tone: 'neutral',
    });
    expect(flow.primaryAction).toMatchObject({
      id: 'open-report',
      label: 'Capture baseline report',
    });
  });
});
