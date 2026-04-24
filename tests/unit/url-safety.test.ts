import { describe, it, expect } from 'vitest';
import { isSafeProbeUrl, isSafeSharedUrl } from '../../src/lib/utils/url-safety';

describe('isSafeProbeUrl — user-typed URLs', () => {
  it('accepts http and https', () => {
    expect(isSafeProbeUrl('http://example.com/')).toBe(true);
    expect(isSafeProbeUrl('https://example.com/')).toBe(true);
  });

  it('accepts private IPs (user probing own LAN is a valid use case)', () => {
    expect(isSafeProbeUrl('http://127.0.0.1/')).toBe(true);
    expect(isSafeProbeUrl('http://192.168.1.1/')).toBe(true);
    expect(isSafeProbeUrl('http://localhost:8080/')).toBe(true);
  });

  it('rejects non-string / empty / oversized input', () => {
    expect(isSafeProbeUrl(undefined)).toBe(false);
    expect(isSafeProbeUrl(null)).toBe(false);
    expect(isSafeProbeUrl(42)).toBe(false);
    expect(isSafeProbeUrl('')).toBe(false);
    expect(isSafeProbeUrl('http://example.com/' + 'a'.repeat(2048))).toBe(false);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isSafeProbeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeProbeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeProbeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeProbeUrl('ftp://example.com/')).toBe(false);
    expect(isSafeProbeUrl('ws://example.com/')).toBe(false);
  });

  it('rejects URLs carrying userinfo (exfil vector)', () => {
    expect(isSafeProbeUrl('http://user:pass@example.com/')).toBe(false);
    expect(isSafeProbeUrl('http://user@example.com/')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isSafeProbeUrl('not a url')).toBe(false);
    expect(isSafeProbeUrl('http://')).toBe(false);
    expect(isSafeProbeUrl('//example.com/')).toBe(false);
  });

  it('is protocol-case-insensitive', () => {
    expect(isSafeProbeUrl('HTTP://example.com/')).toBe(true);
    expect(isSafeProbeUrl('HtTpS://example.com/')).toBe(true);
  });
});

describe('isSafeSharedUrl — URLs from share-link or localStorage', () => {
  it('accepts public http and https', () => {
    expect(isSafeSharedUrl('https://example.com/')).toBe(true);
    expect(isSafeSharedUrl('http://8.8.8.8/')).toBe(true);
  });

  it('inherits every isSafeProbeUrl rejection', () => {
    expect(isSafeSharedUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeSharedUrl('http://user:pass@example.com/')).toBe(false);
    expect(isSafeSharedUrl('')).toBe(false);
    expect(isSafeSharedUrl('http://example.com/' + 'a'.repeat(2048))).toBe(false);
  });

  it('rejects loopback (127.0.0.0/8, localhost, ::1)', () => {
    expect(isSafeSharedUrl('http://127.0.0.1/')).toBe(false);
    expect(isSafeSharedUrl('http://127.53.1.9/')).toBe(false);
    expect(isSafeSharedUrl('http://localhost/')).toBe(false);
    expect(isSafeSharedUrl('http://LOCALHOST/')).toBe(false);
    expect(isSafeSharedUrl('http://api.localhost/')).toBe(false);
    expect(isSafeSharedUrl('http://[::1]/')).toBe(false);
    expect(isSafeSharedUrl('http://[0:0:0:0:0:0:0:1]/')).toBe(false);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(isSafeSharedUrl('http://10.0.0.1/')).toBe(false);
    expect(isSafeSharedUrl('http://10.255.255.255/')).toBe(false);
    expect(isSafeSharedUrl('http://192.168.1.1/')).toBe(false);
    expect(isSafeSharedUrl('http://172.16.0.1/')).toBe(false);
    expect(isSafeSharedUrl('http://172.31.255.255/')).toBe(false);
    // Boundary: 172.15.x.x and 172.32.x.x are NOT private
    expect(isSafeSharedUrl('http://172.15.0.1/')).toBe(true);
    expect(isSafeSharedUrl('http://172.32.0.1/')).toBe(true);
  });

  it('rejects link-local / cloud metadata (169.254.0.0/16)', () => {
    expect(isSafeSharedUrl('http://169.254.169.254/')).toBe(false); // AWS/Azure IMDS
    expect(isSafeSharedUrl('http://169.254.0.1/')).toBe(false);
  });

  it('rejects 0.0.0.0/8 (current-network)', () => {
    expect(isSafeSharedUrl('http://0.0.0.0/')).toBe(false);
    expect(isSafeSharedUrl('http://0.1.2.3/')).toBe(false);
  });

  it('rejects IPv6 private / link-local / ULA', () => {
    expect(isSafeSharedUrl('http://[fc00::1]/')).toBe(false);
    expect(isSafeSharedUrl('http://[fd00::1]/')).toBe(false);
    expect(isSafeSharedUrl('http://[fe80::1]/')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 pointing at private ranges', () => {
    expect(isSafeSharedUrl('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isSafeSharedUrl('http://[::ffff:192.168.1.1]/')).toBe(false);
    expect(isSafeSharedUrl('http://[::ffff:169.254.169.254]/')).toBe(false);
  });

  it('rejects mDNS / internal TLDs', () => {
    expect(isSafeSharedUrl('http://printer.local/')).toBe(false);
    expect(isSafeSharedUrl('http://wiki.internal/')).toBe(false);
  });

  it('ignores trailing dot on hostname (normalization)', () => {
    expect(isSafeSharedUrl('http://127.0.0.1./')).toBe(false);
    expect(isSafeSharedUrl('http://localhost./')).toBe(false);
  });
});
