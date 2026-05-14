import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Layout bottom chrome', () => {
  const source = readFileSync(resolve(__dirname, '../../../src/lib/components/Layout.svelte'), 'utf-8');

  it('does not render the legacy permanent footer bar', () => {
    expect(source).not.toContain("import FooterBar from './FooterBar.svelte'");
    expect(source).not.toContain('<FooterBar');
  });
});
