import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Layout code splitting', () => {
  const layout = readFileSync(resolve(process.cwd(), 'src/lib/components/Layout.svelte'), 'utf-8');

  it('does not statically import heavyweight route surfaces into the app shell', () => {
    for (const view of [
      'OverviewView',
      'LiveView',
      'DiagnoseView',
      'EndpointView',
      'ReportView',
      'TransitView',
    ]) {
      expect(layout).not.toContain(`import ${view} from './${view}.svelte'`);
    }
  });

  it('keeps route surfaces behind dynamic imports', () => {
    for (const view of [
      'OverviewView',
      'LiveView',
      'DiagnoseView',
      'EndpointView',
      'ReportView',
      'TransitView',
    ]) {
      expect(layout).toContain(`import('./${view}.svelte')`);
    }
  });

  it('renders a retryable error state if a route surface chunk fails', () => {
    expect(layout).toContain('surfaceLoadError');
    expect(layout).toContain('Instrument surface failed to load.');
    expect(layout).toContain('onclick={retrySurfaceLoad}');
  });
});
