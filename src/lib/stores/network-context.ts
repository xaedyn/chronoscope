import { writable } from 'svelte/store';
import { describeDohInsight, type DohInsight } from '../dns/doh-insight';
import { describeTopologyContext } from '../topology/asn-context';
import type { Endpoint } from '../types';

export type NetworkContextStatus = 'idle' | 'running' | 'complete' | 'error';

export interface NetworkContextState {
  readonly status: NetworkContextStatus;
  readonly hostname: string | null;
  readonly dnsInsight: DohInsight | null;
  readonly topologyInsight: string | null;
  readonly dnsError: string | null;
  readonly topologyError: string | null;
  readonly error: string | null;
}

export interface NetworkContextStoreOptions {
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface NetworkContextStore {
  subscribe: ReturnType<typeof writable<NetworkContextState>>['subscribe'];
  run(endpoint: Endpoint): Promise<NetworkContextState>;
  reset(): void;
}

interface DnsContextResponse {
  readonly ok: true;
  readonly resolver: 'cloudflare-doh';
  readonly hostname: string;
  readonly records: readonly string[];
  readonly durationMs: number;
}

interface TopologyContextResponse {
  readonly ok: true;
  readonly hostname: string;
  readonly asn: number | null;
  readonly organization: string | null;
}

const initialState: NetworkContextState = {
  status: 'idle',
  hostname: null,
  dnsInsight: null,
  topologyInsight: null,
  dnsError: null,
  topologyError: null,
  error: null,
};

const DEFAULT_TIMEOUT_MS = 8_000;

interface InFlightRun {
  readonly controllers: Set<AbortController>;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostnameFromEndpoint(endpoint: Endpoint): string {
  try {
    return new URL(endpoint.url).hostname;
  } catch {
    throw new Error('Network context requires a valid endpoint URL.');
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) as unknown : null;
  } catch {
    if (!response.ok) {
      throw new Error(`Network context request failed with HTTP ${response.status}`);
    }
    throw new Error('Network context response was not valid JSON.');
  }
  if (!response.ok || typeof payload !== 'object' || payload === null || !('ok' in payload) || payload.ok !== true) {
    const error = typeof payload === 'object' && payload !== null && 'error' in payload
      ? String((payload as { readonly error: unknown }).error)
      : `Network context request failed with HTTP ${response.status}`;
    throw new Error(error);
  }
  return payload as T;
}

function abortReason(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Network context request was cancelled.');
}

export function createNetworkContextStore(options: NetworkContextStoreOptions = {}): NetworkContextStore {
  const { subscribe, set } = writable<NetworkContextState>(initialState);
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let runSerial = 0;
  let inFlightRun: InFlightRun | null = null;

  function abortInFlight(reason = new Error('Network context request was cancelled.')): void {
    for (const controller of inFlightRun?.controllers ?? []) {
      controller.abort(reason);
    }
    inFlightRun = null;
  }

  async function fetchContextJson<T>(
    run: InFlightRun,
    input: RequestInfo | URL,
    init: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    run.controllers.add(controller);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error('Network context request timed out.');
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const abortPromise = new Promise<never>((_, reject) => {
      abortHandler = () => reject(abortReason(controller.signal.reason));
      controller.signal.addEventListener('abort', abortHandler, { once: true });
    });

    try {
      const response = await Promise.race([
        fetcher(input, { ...init, signal: controller.signal }),
        timeoutPromise,
        abortPromise,
      ]);
      return await Promise.race([
        parseJsonResponse<T>(response),
        timeoutPromise,
        abortPromise,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortHandler) controller.signal.removeEventListener('abort', abortHandler);
      run.controllers.delete(controller);
    }
  }

  async function run(endpoint: Endpoint): Promise<NetworkContextState> {
    const serial = runSerial + 1;
    runSerial = serial;
    abortInFlight();

    let hostname: string;
    try {
      hostname = hostnameFromEndpoint(endpoint);
    } catch (error) {
      const next = {
        ...initialState,
        status: 'error' as const,
        error: messageFrom(error),
      };
      set(next);
      return next;
    }

    set({
      ...initialState,
      status: 'running',
      hostname,
    });

    const encodedHostname = encodeURIComponent(hostname);
    const currentRun: InFlightRun = { controllers: new Set() };
    inFlightRun = currentRun;
    const dns = fetchContextJson<DnsContextResponse>(currentRun, `/api/vantage/dns?hostname=${encodedHostname}&type=A`, {
      method: 'GET',
      cache: 'no-store',
    })
      .then((payload) => describeDohInsight({
        hostname: payload.hostname,
        resolver: payload.resolver,
        records: payload.records,
        durationMs: payload.durationMs,
      }));

    const topology = fetchContextJson<TopologyContextResponse>(currentRun, `/api/vantage/topology?hostname=${encodedHostname}`, {
      method: 'GET',
      cache: 'no-store',
    })
      .then((payload) => describeTopologyContext({
        hostname: payload.hostname,
        asn: payload.asn,
        organization: payload.organization,
      }));

    const [dnsResult, topologyResult] = await Promise.allSettled([dns, topology]);
    const next: NetworkContextState = {
      status: dnsResult.status === 'fulfilled' || topologyResult.status === 'fulfilled' ? 'complete' : 'error',
      hostname,
      dnsInsight: dnsResult.status === 'fulfilled' ? dnsResult.value : null,
      topologyInsight: topologyResult.status === 'fulfilled' ? topologyResult.value : null,
      dnsError: dnsResult.status === 'rejected' ? messageFrom(dnsResult.reason) : null,
      topologyError: topologyResult.status === 'rejected' ? messageFrom(topologyResult.reason) : null,
      error: dnsResult.status === 'rejected' && topologyResult.status === 'rejected'
        ? 'Network context did not complete.'
        : null,
    };

    if (serial === runSerial) set(next);
    if (inFlightRun === currentRun) inFlightRun = null;
    return next;
  }

  function reset(): void {
    runSerial += 1;
    abortInFlight();
    set(initialState);
  }

  return {
    subscribe,
    run,
    reset,
  };
}

export const networkContextStore = createNetworkContextStore();
