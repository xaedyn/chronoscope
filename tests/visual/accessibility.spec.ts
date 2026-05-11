import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface AxeNodeSummary {
  readonly target: readonly string[];
  readonly html: string;
}

interface AxeViolationSummary {
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: readonly AxeNodeSummary[];
}

interface SampleSeedSpec {
  readonly endpointId: string;
  readonly count: number;
  readonly latencyMs: number;
  readonly jitterMs: number;
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const summary: AxeViolationSummary[] = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      html: node.html,
    })),
  }));

  expect(summary).toEqual([]);
}

async function visibleEndpointIds(page: Page): Promise<string[]> {
  await page.waitForSelector('[data-endpoint-id]', { state: 'attached', timeout: 3000 });
  return await page
    .locator('[data-endpoint-id]')
    .evaluateAll((els) => {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const el of els) {
        const id = el.getAttribute('data-endpoint-id');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      return ids;
    });
}

async function injectSampleSpecs(page: Page, specs: readonly SampleSeedSpec[]): Promise<void> {
  await page.waitForFunction(() => typeof window.__chronoscope_inject_samples === 'function');
  await page.evaluate((seedSpecs) => {
    const inject = window.__chronoscope_inject_samples;
    if (!inject) throw new Error('__chronoscope_inject_samples is unavailable');
    inject(seedSpecs);
  }, specs);
}

async function seedVisibleSamples(page: Page): Promise<void> {
  const ids = await visibleEndpointIds(page);
  await injectSampleSpecs(page, ids.map((endpointId, index) => ({
    endpointId,
    count: 24,
    latencyMs: 45 + index * 24,
    jitterMs: 4,
  })));
}

test.describe('Accessibility', () => {
  test('no axe violations on empty state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chronoscope-root');

    await expectNoAxeViolations(page);
  });

  test('no axe violations on populated primary views', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chronoscope-root');
    await seedVisibleSamples(page);

    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: /^Live/ }).click();
    await page.waitForSelector('section[aria-label="Live latency trace"]');
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: /^Investigate/ }).click();
    await page.waitForSelector('section[aria-label="Investigate"]');
    await expectNoAxeViolations(page);
  });

  test('skip link is keyboard-accessible', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeFocused();
  });

  test('all canvas elements have ARIA attributes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chronoscope-root');

    const canvases = page.locator('canvas[tabindex="0"]');
    const count = await canvases.count();

    for (let i = 0; i < count; i++) {
      const canvas = canvases.nth(i);
      await expect(canvas).toHaveAttribute('role', 'application');
      const desc = await canvas.getAttribute('aria-roledescription');
      expect(desc).toBeTruthy();
    }
  });
});
