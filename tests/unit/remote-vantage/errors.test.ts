// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { ValidationError, classifyProbeError, safeErrorMessage } from '../../../functions/_shared/errors';

describe('ValidationError', () => {
  it('preserves the message and uses the correct name', () => {
    const err = new ValidationError('Target URL must be a public http(s) URL.');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Target URL must be a public http(s) URL.');
  });
});

describe('classifyProbeError', () => {
  it('recognises AbortError by name as a timeout', () => {
    const err = new Error('whatever');
    err.name = 'AbortError';
    expect(classifyProbeError(err)).toBe('request timed out');
  });

  it('classifies timeout-message errors', () => {
    expect(classifyProbeError(new Error('Request timed out after 4500ms'))).toBe('request timed out');
    expect(classifyProbeError(new Error('TIMEOUT'))).toBe('request timed out');
  });

  it('classifies TLS / certificate errors', () => {
    expect(classifyProbeError(new Error('certificate has expired'))).toBe('tls / certificate error');
    expect(classifyProbeError(new Error("Hostname/IP doesn't match certificate's altnames"))).toBe('tls / certificate error');
    expect(classifyProbeError(new Error('TLS handshake failed'))).toBe('tls / certificate error');
    expect(classifyProbeError(new Error('SSL: unknown protocol'))).toBe('tls / certificate error');
  });

  it('classifies DNS resolution failures', () => {
    expect(classifyProbeError(new Error('getaddrinfo ENOTFOUND foo.example.com'))).toBe('dns resolution failed');
    expect(classifyProbeError(new Error('ENOTFOUND'))).toBe('dns resolution failed');
    expect(classifyProbeError(new Error('DNS lookup failed'))).toBe('dns resolution failed');
  });

  it('classifies connection-refused / reset', () => {
    expect(classifyProbeError(new Error('connect ECONNREFUSED 192.0.2.5:443'))).toBe('connection refused');
    expect(classifyProbeError(new Error('connection refused by peer'))).toBe('connection refused');
    expect(classifyProbeError(new Error('connect ECONNRESET'))).toBe('connection reset');
    expect(classifyProbeError(new Error('connection reset by peer'))).toBe('connection reset');
  });

  it('classifies generic network errors', () => {
    expect(classifyProbeError(new Error('network error'))).toBe('network error');
  });

  it('falls back to "probe failed" for unrecognised errors', () => {
    expect(classifyProbeError(new Error('something exotic'))).toBe('probe failed');
    expect(classifyProbeError(new Error(''))).toBe('probe failed');
  });

  it('falls back to "probe failed" for non-Error inputs', () => {
    expect(classifyProbeError('a string')).toBe('probe failed');
    expect(classifyProbeError(null)).toBe('probe failed');
    expect(classifyProbeError(undefined)).toBe('probe failed');
    expect(classifyProbeError({ message: 'looks like an error but isn\'t' })).toBe('probe failed');
  });

  it('never returns the raw runtime message verbatim', () => {
    // Regression guard against the original `js/stack-trace-exposure` issue.
    // No matter what the runtime threw, the output must be one of the safe
    // category strings.
    const safe = new Set([
      'request timed out',
      'tls / certificate error',
      'dns resolution failed',
      'connection refused',
      'connection reset',
      'network error',
      'probe failed',
    ]);
    const samples = [
      new Error('getaddrinfo failed for foo.internal.corp'),
      new Error('Hostname/IP doesn\'t match certificate\'s altnames: 10.0.0.5'),
      new Error('connect ECONNREFUSED 10.42.0.7:443'),
      new Error('mystery'),
    ];
    for (const err of samples) expect(safe.has(classifyProbeError(err))).toBe(true);
  });
});

describe('safeErrorMessage', () => {
  it('returns the message verbatim for ValidationError', () => {
    expect(safeErrorMessage(new ValidationError('Target must be https.'), 'fallback')).toBe('Target must be https.');
  });

  it('returns the fallback for plain Error instances', () => {
    expect(safeErrorMessage(new Error('mystery internal'), 'fallback')).toBe('fallback');
  });

  it('returns the fallback for non-Error inputs', () => {
    expect(safeErrorMessage('mystery string', 'fallback')).toBe('fallback');
    expect(safeErrorMessage(null, 'fallback')).toBe('fallback');
    expect(safeErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('does not surface runtime detail even when a subclass extends Error', () => {
    class FetchError extends Error {
      constructor(public hostname: string) {
        super(`getaddrinfo failed for ${hostname}`);
      }
    }
    const err = new FetchError('internal.corp');
    expect(safeErrorMessage(err, 'fallback')).toBe('fallback');
  });
});
