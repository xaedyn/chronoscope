import type {
  SharePayload,
  ShareRemoteVantageEdge,
  ShareRemoteVantageResult,
  ShareRemoteVantageSnapshot,
  ShareRemoteVantageVerdict,
} from '../types';

export interface RemoteVantageTarget {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export interface RemoteVantageProbeRequest {
  readonly targets: readonly RemoteVantageTarget[];
}

export type RemoteVantageEdge = ShareRemoteVantageEdge;

export type RemoteVantageVerdict = ShareRemoteVantageVerdict;

export type RemoteVantageResult = ShareRemoteVantageResult;

export interface RemoteVantageProbeResponse extends ShareRemoteVantageSnapshot {
  readonly ok: boolean;
}

export interface HostedReportSuccess {
  readonly ok: true;
  readonly id: string;
  readonly url: string;
  readonly expiresAt: number;
}

export interface HostedReportFallback {
  readonly ok: false;
  readonly fallback: 'hash';
  readonly error: string;
}

export type HostedReportCreateResponse = HostedReportSuccess | HostedReportFallback;

export interface HostedReportLoadResponse {
  readonly ok: true;
  readonly payload: SharePayload;
}

// ── Transit fanout (Phase D) ────────────────────────────────────────────────
// One target, N probes from a single Cloudflare edge colo. The TransitView
// surface combines this with a local browser probe loop to populate the
// "Your browser" + "Cloudflare edge" cards. Multi-region IAD/LHR/NRT is a
// later step that requires three separate Worker deployments.
export interface TransitProbeRequest {
  readonly target: string;
  readonly probeCount?: number;
}

export interface TransitProbeSuccess {
  readonly ok: true;
  readonly vantage: 'cf-edge';
  readonly region: string;
  readonly edge: RemoteVantageEdge;
  readonly last: number;
  readonly p50: number;
  readonly p95: number;
  readonly sigma: number;
  readonly raw: readonly number[];
  readonly failures: number;
  readonly checkedAt: number;
}

export interface TransitProbeFailure {
  readonly ok: false;
  readonly error: string;
}

export type TransitProbeResponse = TransitProbeSuccess | TransitProbeFailure;
