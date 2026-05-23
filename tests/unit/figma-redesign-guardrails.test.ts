import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('Figma redesign guardrails', () => {
  it('does not add prototype framework dependencies to production package manifests', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(deps).not.toHaveProperty('react');
    expect(deps).not.toHaveProperty('react-dom');
    expect(deps).not.toHaveProperty('@mui/material');
    expect(deps).not.toHaveProperty('@radix-ui/react-dialog');
    expect(deps).not.toHaveProperty('recharts');
    expect(deps).not.toHaveProperty('tailwindcss');
  });

  it('keeps shell files free of prototype data and unsupported cause claims', () => {
    const shellSource = [
      'src/lib/components/Layout.svelte',
      'src/lib/components/Masthead.svelte',
    ].map(readRepoFile).join('\n');

    expect(shellSource).not.toMatch(/Math\.random\(/);
    expect(shellSource).not.toMatch(/your local Wi-Fi and core ISP connection are likely fine/i);
    expect(shellSource).not.toMatch(/affects everyone globally/i);
    expect(shellSource).not.toMatch(/\bprove\b/i);
  });

  it('uses the aligned Overview shell instead of the old permanent endpoint rail', () => {
    const layoutSource = readRepoFile('src/lib/components/Layout.svelte');

    // PR 5 of synthesis arc: FigmaOverviewView was renamed to OverviewView
    // (the original dial-era OverviewView was deleted alongside the other
    // orphans). The assertion still locks in the contract that Layout mounts
    // the canonical Overview surface and does not regress to the retired
    // EndpointRail.
    expect(layoutSource).toContain('OverviewView');
    expect(layoutSource).not.toContain('EndpointRail');
  });

  it('exposes the Vessel v4 primary shell navigation', () => {
    const mastheadSource = readRepoFile('src/lib/components/Masthead.svelte');

    expect(mastheadSource).toContain("label: 'Overview'");
    expect(mastheadSource).toContain("label: 'Live'");
    expect(mastheadSource).toContain("label: 'Investigate'");
    expect(mastheadSource).toContain("label: 'Report'");
    expect(mastheadSource).not.toMatch(/label:\s*['"]Status['"]/);
  });
});
