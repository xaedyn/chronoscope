import { test, expect, type Page } from '@playwright/test';

// AC5 — fail-closed sweep: no raw URL string appears as the textContent of
// a primary-identifier element on Status, Live, or Investigate views.
//
// "Primary identifier" means the name/label slot for an endpoint — the element
// the user scans to identify which endpoint is being described.  Subtitle
// elements that intentionally display URLs (`.rail-row-url`, `.diagnose-title-url`)
// are excluded.
//
// Class mapping (verified against component source — updated in PR 5 of the
// synthesis arc after EndpointRail and EventFeed were deleted):
//   Investigate    →  .diagnose-title-name  (primary)  /  .diagnose-title-url (subtitle — excluded)
//
// The sentinel test injects a synthetic .diagnose-title-name with a raw URL
// into the live DOM and asserts the sweep catches it, proving fail-closed
// behaviour. New primary-identifier surfaces added by future PRs (e.g.
// EndpointDetail in PR 7) must register their selector here.
//
// Coverage gap: ConfigStagingBanner is reachable only via a staged share URL and is excluded from this Playwright sweep — its `.endpoint-url` subtitle is the only URL surface it renders, and that's a permitted exception per AC5.

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'mobile',  width: 375,  height: 812 },
] as const;

// Selectors for primary identifier elements.  Subtitle / secondary elements
// that intentionally carry URLs are NOT listed here.
const PRIMARY_SELECTORS = [
  '.diagnose-title-name',
] as const;

// Patterns that unambiguously identify a raw URL string.
// Serialised as RegExp sources so they can cross the page.evaluate() boundary.
const URL_PATTERNS = [
  /^https?:\/\//i,
  /^\/\//,
  /^www\./i,
];

interface RawUrlLeak {
  readonly selector: string;
  readonly text: string;
}

/**
 * Walk every visible primary-identifier element in the page and return any
 * whose textContent looks like a raw URL.
 */
const findRawUrlLeaks = async (page: Page): Promise<readonly RawUrlLeak[]> => {
  return await page.evaluate(
    ({ selectors, urlPatternStrings }: { selectors: readonly string[]; urlPatternStrings: readonly string[] }) => {
      const patterns = urlPatternStrings.map((s) => new RegExp(s, 'i'));

      function looksLikeUrl(text: string): boolean {
        return patterns.some((re) => re.test(text.trim()));
      }

      const leaks: RawUrlLeak[] = [];
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
        for (const el of elements) {
          // Visibility filter: must have non-zero dimensions and not be display:none.
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            cs.opacity !== '0';
          if (!visible) continue;

          const text = (el.textContent ?? '').trim();
          if (looksLikeUrl(text)) {
            leaks.push({ selector, text });
          }
        }
      }
      return leaks;
    },
    {
      selectors: PRIMARY_SELECTORS as readonly string[],
      // Serialise RegExp sources so they cross the evaluate boundary.
      urlPatternStrings: URL_PATTERNS.map((re) => re.source),
    },
  );
};

// ── Real-view sweeps ──────────────────────────────────────────────────────────

test.describe('AC5 — no raw URL in primary identifiers', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`@ ${vp.name} (${vp.width}×${vp.height})`, () => {
      // Note: Status and Live views were protected by the now-deleted
      // EndpointRail / EventFeed selectors. After PR 5 of the synthesis
      // arc, those surfaces' primary-identifier sweeps will need new
      // selectors registered in PRIMARY_SELECTORS (likely .endpoint-row
      // strong for Overview and .live-footer-chip for Live, once those
      // are confirmed safe-by-design in PR 6/7). For now this spec
      // covers the Investigate view only, which retains
      // .diagnose-title-name as its primary-identifier selector.

      test('Investigate view', async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.waitForSelector('#chronoscope-root');
        // Navigate to the Investigate view via the ViewSwitcher button.
        await page.getByRole('button', { name: /^Investigate/ }).click();
        // Assert the Investigate view section is mounted before sweeping.
        await page.waitForSelector('section[aria-label="Investigate"]');
        // Deterministic wait: sweep runs only after primary-identifier content mounts.
        await page.waitForSelector('.diagnose-title-name', { state: 'attached' });

        const leaks = await findRawUrlLeaks(page);
        expect(
          leaks,
          `Raw URL(s) found in primary identifier elements on Investigate: ${JSON.stringify(leaks)}`,
        ).toEqual([]);
      });
    });
  }
});

// ── Sentinel test — fail-closed verification ──────────────────────────────────
//
// Injects a synthetic .diagnose-title-name element containing a raw URL
// into the live DOM, then asserts the sweep detects it. If the sweep
// returns empty here, the detection logic is broken and would silently
// miss real regressions.

test.describe('AC5 sentinel — sweep is fail-closed', () => {
  test('detects injected raw URL in .diagnose-title-name', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/');
    await page.waitForSelector('#chronoscope-root');
    await page.waitForTimeout(400);

    // Inject a visible span with the primary-identifier class and a raw URL.
    await page.evaluate(() => {
      const sentinel = document.createElement('span');
      sentinel.className = 'diagnose-title-name';
      sentinel.textContent = 'https://sentinel.example.com/test';
      sentinel.style.cssText = 'display:inline-block;width:200px;height:20px;position:fixed;top:10px;left:10px;z-index:9999;visibility:visible';
      document.body.appendChild(sentinel);
    });

    const leaks = await findRawUrlLeaks(page);
    expect(
      leaks.length,
      'Sentinel: sweep must detect the injected raw URL — if this fails the sweep logic is broken',
    ).toBeGreaterThan(0);
    // Exact-equality match (not substring) — sentinel content is fully test-controlled.
    // Avoids CodeQL "incomplete URL substring sanitization" false positive without suppression.
    expect(leaks.some(l => l.text === 'https://sentinel.example.com/test')).toBe(true);
  });
});
