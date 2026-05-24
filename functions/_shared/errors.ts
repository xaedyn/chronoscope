// Edge-function error handling. Two primitives:
//
//   ValidationError    — marker class for deliberate, user-facing messages
//                        thrown by our own parsing/validation code. Catches
//                        check `instanceof ValidationError` to decide whether
//                        the message is safe to surface to the client.
//
//   classifyProbeError — categorises raw fetch failures (DNS, TLS, timeout,
//                        connection-refused, etc.) into safe labels. Hides the
//                        specific hostname / IP / cert details that the
//                        Workers runtime tends to put into raw Error.message
//                        strings — those would otherwise leak through the
//                        per-probe `error` field in responses.
//
// Background: CodeQL flags `error.message` exposures under
// `js/stack-trace-exposure`. The risk is real for runtime errors (fetch
// failures during probing, KV write failures during report storage), and
// rule-flagged-but-low-risk for deliberate validation throws. This module
// lets catch blocks distinguish the two cleanly.

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(message: string) {
    super(message);
  }
}

// Safe category labels for raw fetch / network failures. Picked to be
// actionable to a user troubleshooting a probe without leaking infrastructure
// detail. Order matters in classifyProbeError — more specific patterns first.
export type ProbeErrorCategory =
  | 'request timed out'
  | 'tls / certificate error'
  | 'dns resolution failed'
  | 'connection refused'
  | 'connection reset'
  | 'network error'
  | 'probe failed';

// Map a raw fetch / network error to a safe category label. AbortError from
// our own AbortController timeout is the only error we recognise structurally;
// everything else is string-matched against the Workers runtime's error
// surface. The fallback ('probe failed') keeps us safe when the runtime emits
// a message we don't know how to classify.
export function classifyProbeError(err: unknown): ProbeErrorCategory {
  if (err instanceof Error && err.name === 'AbortError') return 'request timed out';
  if (!(err instanceof Error)) return 'probe failed';
  const msg = err.message.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'request timed out';
  if (
    msg.includes('certificate') ||
    msg.includes('cert ') ||
    msg.includes('tls') ||
    msg.includes('ssl') ||
    msg.includes('altname')
  ) {
    return 'tls / certificate error';
  }
  if (
    msg.includes('enotfound') ||
    msg.includes('getaddrinfo') ||
    msg.includes('dns')
  ) {
    return 'dns resolution failed';
  }
  if (msg.includes('econnrefused') || msg.includes('connection refused')) return 'connection refused';
  if (msg.includes('econnreset') || msg.includes('connection reset')) return 'connection reset';
  if (msg.includes('network')) return 'network error';
  return 'probe failed';
}

// Catch-block helper. Returns the message verbatim when the caught error is a
// known-safe ValidationError; otherwise returns the fallback string. Use this
// in top-level handler catches so deliberate validation messages stay
// user-facing without ever leaking the message of a runtime exception.
export function safeErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ValidationError ? err.message : fallback;
}
