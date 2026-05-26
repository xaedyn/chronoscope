import type { CompanionProbeResponse } from '../companion/protocol';
import type { RemoteVantageProbeResponse, RemoteVantageResult } from '../remote-vantage/types';
import type { CompanionState, CompanionStatus } from '../stores/companion';
import type { RemoteVantageState, RemoteVantageStatus } from '../stores/remote-vantage';
import type { ShareLocalCompanionSnapshot } from '../types';
import type { DiagnosticReport, ReportEndpointRow } from './diagnostic-report';
import type { EvidenceTrailTone } from './evidence-trail';

export type ProofKind = 'remote' | 'local';
export type GuidedProofStepId = 'browser' | 'outside' | 'local' | 'report';
export type GuidedProofStepStatus =
  | 'captured'
  | 'recommended'
  | 'running'
  | 'failed'
  | 'stale'
  | 'optional'
  | 'ready'
  | 'draft'
  | 'blocked';
export type GuidedProofActionId = 'run-outside' | 'wait-outside' | 'open-report' | 'keep-collecting';

export interface ProofSummary {
  readonly status: string;
  readonly text: string;
  readonly tone: EvidenceTrailTone;
  readonly detail?: string;
}

export interface ProofActionState {
  readonly label: string;
  readonly tone: EvidenceTrailTone;
  readonly disabled: boolean;
}

export interface GuidedProofStep {
  readonly id: GuidedProofStepId;
  readonly label: string;
  readonly status: GuidedProofStepStatus;
  readonly tone: EvidenceTrailTone;
  readonly summary: string;
  readonly detail: string;
}

export interface GuidedProofPrimaryAction {
  readonly id: GuidedProofActionId;
  readonly label: string;
  readonly detail: string;
  readonly endpointId?: string;
  readonly disabled: boolean;
}

export interface GuidedProofFlow {
  readonly targetEndpointId?: string;
  readonly targetEndpointLabel: string;
  readonly measured: string;
  readonly suggests: string;
  readonly cannotProve: string;
  readonly next: string;
  readonly primaryAction: GuidedProofPrimaryAction;
  readonly steps: readonly GuidedProofStep[];
}

export function isProofStale(input: {
  readonly reportCreatedAt: number | null;
  readonly proofGeneratedAt: number | null;
}): boolean {
  return input.reportCreatedAt !== null &&
    input.proofGeneratedAt !== null &&
    input.proofGeneratedAt < input.reportCreatedAt;
}

export function proofFreshnessLabel(input: {
  readonly reportCreatedAt: number | null;
  readonly proofGeneratedAt: number | null;
}): string {
  if (input.proofGeneratedAt === null) return 'Not run';
  return isProofStale(input) ? 'Stale' : 'Fresh';
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function countPhrase(count: number, total: number, singular: string): string {
  return total === 1
    ? `${count}/${total} ${singular}`
    : `${count} of ${total} ${plural(total, singular)}`;
}

export function summarizeRemoteProof(probe: RemoteVantageProbeResponse | null): ProofSummary {
  if (!probe) {
    return {
      status: 'Not run',
      text: 'No Cloudflare outside check captured.',
      tone: 'neutral',
    };
  }

  const problemCount = probe.results.filter((result) => (
    result.verdict === 'slow' ||
    result.verdict === 'http-error' ||
    result.verdict === 'unreachable'
  )).length;
  const endpointLabel = plural(probe.results.length, 'endpoint');

  if (problemCount > 0) {
    const verb = problemCount === 1 ? 'was' : 'were';
    return {
      status: 'Captured',
      text: `${countPhrase(problemCount, probe.results.length, 'endpoint')} ${verb} slow or failed from Cloudflare`,
      tone: 'bad',
    };
  }

  return {
    status: 'Captured',
    text: `Cloudflare reached ${probe.results.length} ${endpointLabel} without slow or failed results`,
    tone: 'good',
  };
}

export function summarizeLocalProof(probe: CompanionProbeResponse | null): ProofSummary {
  if (!probe) {
    return {
      status: 'Not run',
      text: 'No local agent probe captured.',
      tone: 'neutral',
    };
  }

  return {
    status: 'Captured',
    text: `${probe.targetHost}: ${probe.summary}`,
    tone: probe.ok ? 'good' : 'watch',
  };
}

export function summarizeSharedLocalProof(probe: ShareLocalCompanionSnapshot | null): ProofSummary {
  if (!probe) {
    return {
      status: 'Not run',
      text: 'No local agent probe captured.',
      tone: 'neutral',
    };
  }

  const hasProblem = probe.sections.some((section) => section.status !== 'captured');
  return {
    status: 'Captured',
    text: `${probe.targetHost}: ${probe.summary}`,
    tone: hasProblem ? 'watch' : 'good',
    detail: 'Shared report includes sanitized local-agent evidence only.',
  };
}

export function buildProofActionState(input: {
  readonly kind: ProofKind;
  readonly status: RemoteVantageStatus | CompanionStatus;
  readonly hasProof: boolean;
  readonly hasError: boolean;
  readonly hasSecret?: boolean;
  readonly isStale?: boolean;
}): ProofActionState {
  if (input.status === 'checking' || input.status === 'probing') {
    return { label: 'Running', tone: 'watch', disabled: true };
  }
  if (input.hasProof && input.isStale) {
    return { label: 'Stale', tone: 'watch', disabled: false };
  }
  if (input.hasProof) return { label: 'Captured', tone: 'good', disabled: false };
  if (input.hasError) {
    return {
      label: input.kind === 'local'
        ? (input.hasSecret ? 'Needs check' : 'Needs setup')
        : 'Failed',
      tone: 'watch',
      disabled: false,
    };
  }
  return { label: 'Not run', tone: 'neutral', disabled: false };
}

function fmtMs(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : 'unknown latency';
}

function hasBrowserFinding(report: DiagnosticReport): boolean {
  return report.diagnosis.kind !== 'healthy' && report.diagnosis.kind !== 'collecting';
}

function toneForDiagnosis(report: DiagnosticReport): EvidenceTrailTone {
  switch (report.diagnosis.severity) {
    case 'healthy':
      return 'good';
    case 'degraded':
      return 'bad';
    case 'watch':
      return 'watch';
  }
}

function targetRowFor(report: DiagnosticReport): ReportEndpointRow | null {
  const highlightedId = report.diagnosis.highlightedEndpoint?.id;
  const validationId = report.diagnosis.primaryValidation.endpointId;
  const candidates = [highlightedId, validationId].filter((id): id is string => typeof id === 'string');
  for (const id of candidates) {
    const row = report.endpointRows.find((candidate) => candidate.endpointId === id);
    if (row) return row;
  }
  return report.endpointRows.find((row) => row.implicated) ??
    report.endpointRows.find((row) => row.status === 'slow' || row.status === 'loss') ??
    report.endpointRows.find((row) => row.enabled) ??
    null;
}

function isRemoteResultProblem(result: RemoteVantageResult): boolean {
  return result.verdict === 'slow' ||
    result.verdict === 'http-error' ||
    result.verdict === 'unreachable' ||
    !result.ok;
}

function resultForTarget(
  probe: RemoteVantageProbeResponse,
  target: ReportEndpointRow | null,
): RemoteVantageResult | null {
  if (!target) return probe.results[0] ?? null;
  return probe.results.find((result) => result.endpointId === target.endpointId) ??
    probe.results.find((result) => result.url === target.url) ??
    null;
}

function remoteProblemCount(probe: RemoteVantageProbeResponse): number {
  return probe.results.filter(isRemoteResultProblem).length;
}

function targetLabel(target: ReportEndpointRow | null): string {
  return target?.label ?? 'this endpoint';
}

function buildBrowserStep(report: DiagnosticReport, target: ReportEndpointRow | null): GuidedProofStep {
  const browserFinding = hasBrowserFinding(report);
  const samplePhrase = `${report.keptSampleCount} browser ${plural(report.keptSampleCount, 'sample')}`;
  return {
    id: 'browser',
    label: 'Browser measurement',
    status: report.keptSampleCount > 0 ? 'captured' : 'recommended',
    tone: toneForDiagnosis(report),
    summary: report.diagnosis.primaryAnswer.text,
    detail: browserFinding
      ? `${samplePhrase} point at ${targetLabel(target)} from this browser run.`
      : `${samplePhrase} form a browser baseline.`,
  };
}

function buildOutsideStep(input: {
  readonly report: DiagnosticReport;
  readonly remoteVantage: Pick<RemoteVantageState, 'status' | 'lastProbe' | 'error'>;
  readonly target: ReportEndpointRow | null;
}): GuidedProofStep {
  const { report, remoteVantage, target } = input;
  const browserFinding = hasBrowserFinding(report);
  const probe = remoteVantage.lastProbe;
  const stale = isProofStale({
    reportCreatedAt: report.createdAt,
    proofGeneratedAt: probe?.generatedAt ?? null,
  });
  const action = buildProofActionState({
    kind: 'remote',
    status: remoteVantage.status,
    hasProof: probe !== null,
    hasError: remoteVantage.error !== null,
    isStale: stale,
  });

  if (action.label === 'Running') {
    return {
      id: 'outside',
      label: 'Outside check',
      status: 'running',
      tone: 'watch',
      summary: `Cloudflare edge check is running for ${targetLabel(target)}.`,
      detail: 'This compares the browser result with a second vantage.',
    };
  }

  if (probe && stale) {
    return {
      id: 'outside',
      label: 'Outside check',
      status: 'stale',
      tone: 'watch',
      summary: 'Outside check is older than this report.',
      detail: `Rerun Cloudflare before using it to compare against ${targetLabel(target)}.`,
    };
  }

  if (probe) {
    const result = resultForTarget(probe, target);
    const problem = result ? isRemoteResultProblem(result) : remoteProblemCount(probe) > 0;
    if (result && problem) {
      const predicate = result.verdict === 'slow' ? 'slow' : 'slow or failed';
      return {
        id: 'outside',
        label: 'Outside check',
        status: 'captured',
        tone: 'bad',
        summary: `Cloudflare also saw ${targetLabel(target)} ${predicate} in ${fmtMs(result.durationMs)}.`,
        detail: 'Browser and outside evidence now agree on the endpoint shape.',
      };
    }
    if (result) {
      return {
        id: 'outside',
        label: 'Outside check',
        status: 'captured',
        tone: browserFinding ? 'watch' : 'good',
        summary: `Cloudflare reached ${targetLabel(target)} cleanly in ${fmtMs(result.durationMs)}.`,
        detail: browserFinding
          ? 'The browser finding did not reproduce from the outside vantage.'
          : 'The outside vantage agrees with the clean browser baseline.',
      };
    }
    const problems = remoteProblemCount(probe);
    return {
      id: 'outside',
      label: 'Outside check',
      status: 'captured',
      tone: problems > 0 ? 'bad' : 'good',
      summary: summarizeRemoteProof(probe).text,
      detail: `Captured from ${probe.edge.colo ?? 'Cloudflare edge'}.`,
    };
  }

  if (action.label === 'Failed') {
    return {
      id: 'outside',
      label: 'Outside check',
      status: 'failed',
      tone: 'watch',
      summary: 'Outside check did not complete.',
      detail: remoteVantage.error ?? 'Run it again before sharing this as second-vantage evidence.',
    };
  }

  return {
    id: 'outside',
    label: 'Outside check',
    status: browserFinding ? 'recommended' : 'optional',
    tone: browserFinding ? 'watch' : 'neutral',
    summary: browserFinding
      ? `Compare ${targetLabel(target)} from Cloudflare before naming a cause.`
      : 'Baseline looks clean; outside evidence is optional.',
    detail: browserFinding
      ? 'This separates browser-path evidence from endpoint-wide evidence.'
      : 'Use it when a shared baseline needs a second vantage.',
  };
}

function buildLocalStep(input: {
  readonly report: DiagnosticReport;
  readonly companion: Pick<CompanionState, 'status' | 'lastProbe' | 'error' | 'hasSecret'>;
  readonly target: ReportEndpointRow | null;
}): GuidedProofStep {
  const { report, companion, target } = input;
  const probe = companion.lastProbe;
  const stale = isProofStale({
    reportCreatedAt: report.createdAt,
    proofGeneratedAt: probe?.createdAt ?? null,
  });
  const action = buildProofActionState({
    kind: 'local',
    status: companion.status,
    hasProof: probe !== null,
    hasError: companion.error !== null,
    hasSecret: companion.hasSecret,
    isStale: stale,
  });

  if (action.label === 'Running') {
    return {
      id: 'local',
      label: 'Local agent',
      status: 'running',
      tone: 'watch',
      summary: 'Local agent is checking DNS, TLS, route, and Wi-Fi.',
      detail: 'This is optional deep evidence for the browser path.',
    };
  }

  if (probe && stale) {
    return {
      id: 'local',
      label: 'Local agent',
      status: 'stale',
      tone: 'watch',
      summary: 'Local agent evidence is older than this report.',
      detail: 'Rerun it only if local-path proof matters for this handoff.',
    };
  }

  if (probe) {
    return {
      id: 'local',
      label: 'Local agent',
      status: 'captured',
      tone: probe.ok ? 'good' : 'watch',
      summary: `${probe.targetHost}: ${probe.summary}`,
      detail: 'This adds local-path context without exposing private raw route details.',
    };
  }

  if (action.label === 'Needs setup' || action.label === 'Needs check') {
    return {
      id: 'local',
      label: 'Local agent',
      status: action.label === 'Needs setup' ? 'blocked' : 'failed',
      tone: 'watch',
      summary: action.label === 'Needs setup'
        ? 'Local agent is optional and not paired.'
        : 'Local agent needs another check.',
      detail: companion.error ?? `Use this only when ${targetLabel(target)} needs DNS, TLS, route, or Wi-Fi context.`,
    };
  }

  return {
    id: 'local',
    label: 'Local agent',
    status: 'optional',
    tone: 'neutral',
    summary: 'Optional deep proof for the local path.',
    detail: `Not required for the first outside comparison on ${targetLabel(target)}.`,
  };
}

function buildReportStep(input: {
  readonly report: DiagnosticReport;
  readonly outsideStep: GuidedProofStep;
}): GuidedProofStep {
  const { report, outsideStep } = input;
  if (report.diagnosis.kind === 'collecting') {
    return {
      id: 'report',
      label: 'Report',
      status: 'blocked',
      tone: 'watch',
      summary: 'Report waits for enough browser samples.',
      detail: 'Keep the run going until the answer is actionable.',
    };
  }

  if (outsideStep.status === 'captured') {
    return {
      id: 'report',
      label: 'Report',
      status: 'ready',
      tone: 'good',
      summary: 'Report can include browser evidence plus the outside check.',
      detail: 'The handoff now has both the in-browser result and second-vantage comparison.',
    };
  }

  if (hasBrowserFinding(report)) {
    return {
      id: 'report',
      label: 'Report',
      status: 'draft',
      tone: 'watch',
      summary: 'Report is browser-only until outside check runs.',
      detail: 'Shareable, but the handoff should name the missing second vantage.',
    };
  }

  return {
    id: 'report',
    label: 'Report',
    status: 'ready',
    tone: 'good',
    summary: 'Baseline report is ready from browser evidence.',
    detail: 'Outside proof can be added later if the baseline needs stronger corroboration.',
  };
}

function flowCopy(input: {
  readonly report: DiagnosticReport;
  readonly target: ReportEndpointRow | null;
  readonly outsideStep: GuidedProofStep;
}): Pick<GuidedProofFlow, 'measured' | 'suggests' | 'cannotProve' | 'next'> {
  const { report, target, outsideStep } = input;
  const label = targetLabel(target);
  const browserFinding = hasBrowserFinding(report);

  if (report.diagnosis.kind === 'collecting') {
    return {
      measured: 'The browser is still collecting enough samples to call the run.',
      suggests: 'Early movement can be noise until the least-sampled endpoint matures.',
      cannotProve: 'Chronoscope cannot compare vantages before the browser answer is ready.',
      next: 'Keep the session running until each enabled endpoint has actionable samples.',
    };
  }

  if (!browserFinding) {
    return {
      measured: report.diagnosis.primaryAnswer.text,
      suggests: 'This is a clean browser baseline for the current endpoint set.',
      cannotProve: 'A clean baseline does not guarantee the issue will stay absent later.',
      next: 'Capture the baseline report, or add outside evidence if the handoff needs a second vantage.',
    };
  }

  if (outsideStep.status === 'captured' && outsideStep.tone === 'bad') {
    return {
      measured: report.diagnosis.primaryAnswer.text,
      suggests: `The browser and Cloudflare both observed ${label} as the endpoint to inspect.`,
      cannotProve: 'This still does not expose private routing, DNS, Wi-Fi, or server internals.',
      next: 'Open the strengthened report and keep causal wording tied to the measured evidence.',
    };
  }

  if (outsideStep.status === 'captured') {
    return {
      measured: report.diagnosis.primaryAnswer.text,
      suggests: `The browser path or local network remains in scope because Cloudflare did not reproduce ${label} slowness.`,
      cannotProve: 'The browser alone cannot show whether the local path, network policy, or a transient window created the difference.',
      next: 'Open the report with the outside comparison, then add local-agent evidence only if local-path detail matters.',
    };
  }

  return {
    measured: report.diagnosis.primaryAnswer.text,
    suggests: `${label} is the next endpoint to compare outside this browser.`,
    cannotProve: `Without an outside vantage, Chronoscope cannot say whether ${label} is slow for everyone or only from this browser path.`,
    next: 'Run the outside check, then capture the report once the comparison is attached.',
  };
}

function primaryActionFor(input: {
  readonly report: DiagnosticReport;
  readonly outsideStep: GuidedProofStep;
  readonly target: ReportEndpointRow | null;
}): GuidedProofPrimaryAction {
  const { report, outsideStep, target } = input;
  if (report.diagnosis.kind === 'collecting') {
    return {
      id: 'keep-collecting',
      label: 'Keep collecting',
      detail: 'Wait for actionable browser samples before adding proof.',
      endpointId: target?.endpointId,
      disabled: false,
    };
  }
  if (outsideStep.status === 'running') {
    return {
      id: 'wait-outside',
      label: 'Outside check running',
      detail: 'Cloudflare is comparing the browser result now.',
      endpointId: target?.endpointId,
      disabled: true,
    };
  }
  if (
    hasBrowserFinding(report) &&
    (outsideStep.status === 'recommended' || outsideStep.status === 'stale' || outsideStep.status === 'failed')
  ) {
    return {
      id: 'run-outside',
      label: 'Run outside check',
      detail: `Compare ${targetLabel(target)} from a Cloudflare edge.`,
      endpointId: target?.endpointId,
      disabled: false,
    };
  }
  if (!hasBrowserFinding(report)) {
    return {
      id: 'open-report',
      label: 'Capture baseline report',
      detail: 'Save this clean browser window as a baseline.',
      endpointId: target?.endpointId,
      disabled: false,
    };
  }
  return {
    id: 'open-report',
    label: outsideStep.tone === 'bad' ? 'Open strengthened report' : 'Open report',
    detail: outsideStep.tone === 'bad'
      ? 'Show the browser result and outside agreement together.'
      : 'Show the browser result with the outside comparison caveat.',
    endpointId: target?.endpointId,
    disabled: false,
  };
}

export function buildGuidedProofFlow(input: {
  readonly report: DiagnosticReport;
  readonly remoteVantage: Pick<RemoteVantageState, 'status' | 'lastProbe' | 'error'>;
  readonly companion: Pick<CompanionState, 'status' | 'lastProbe' | 'error' | 'hasSecret'>;
}): GuidedProofFlow {
  const target = targetRowFor(input.report);
  const browserStep = buildBrowserStep(input.report, target);
  const outsideStep = buildOutsideStep({
    report: input.report,
    remoteVantage: input.remoteVantage,
    target,
  });
  const localStep = buildLocalStep({
    report: input.report,
    companion: input.companion,
    target,
  });
  const reportStep = buildReportStep({
    report: input.report,
    outsideStep,
  });
  const copy = flowCopy({
    report: input.report,
    target,
    outsideStep,
  });

  return {
    targetEndpointId: target?.endpointId,
    targetEndpointLabel: targetLabel(target),
    ...copy,
    primaryAction: primaryActionFor({
      report: input.report,
      outsideStep,
      target,
    }),
    steps: [browserStep, outsideStep, localStep, reportStep],
  };
}
