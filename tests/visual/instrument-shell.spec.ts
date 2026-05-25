import { expect, test, type Page } from '@playwright/test';
import { statSync } from 'node:fs';

async function openInstrument(page: Page, path = '/'): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('chronoscope-onboarded', 'true');
    localStorage.setItem('chronoscope-orbital-tour-seen', '1');
  });
  await page.goto(path);
  await page.waitForSelector('#chronoscope-root');
}

async function seedRunningSession(
  page: Page,
  options: { roundCount?: number; stopped?: boolean; spikeRound?: number } = {},
): Promise<void> {
  const roundCount = options.roundCount ?? 48;
  const stopped = options.stopped ?? false;
  const spikeRound = options.spikeRound ?? null;

  await page.evaluate(({ count, isStopped, spikeAt }) => {
    return Promise.all([
      import('/src/lib/stores/endpoints.ts'),
      import('/src/lib/stores/measurements.ts'),
      import('/src/lib/stores/ui.ts'),
    ]).then(([{ endpointStore }, { measurementStore }, { uiStore }]) => {
      let endpoints = [];
      const unsubscribe = endpointStore.subscribe((value) => {
        endpoints = value.filter((endpoint) => endpoint.enabled).slice(0, 4);
      });
      unsubscribe();

      const now = Date.now();
      const startedAt = now - Math.max(1, count) * 1000;
      const samplesFor = (endpointIndex) => Array.from({ length: count }, (_, sampleIndex) => {
        const round = sampleIndex + 1;
        if (spikeAt !== null && round === spikeAt) {
          if (endpointIndex === 0) {
            return {
              round,
              latency: 180,
              status: 'ok',
              timestamp: startedAt + sampleIndex * 1000,
            };
          }
          if (endpointIndex === 1) {
            return {
              round,
              latency: 164,
              status: 'ok',
              timestamp: startedAt + sampleIndex * 1000,
            };
          }
          if (endpointIndex === 2) {
            return {
              round,
              latency: 0,
              status: 'timeout',
              timestamp: startedAt + sampleIndex * 1000,
            };
          }
        }
        const latency = 30 + endpointIndex * 6 + (sampleIndex % 5 === 0 ? 8 : 0);
        return {
          round,
          latency,
          status: 'ok',
          timestamp: startedAt + sampleIndex * 1000,
        };
      });

      measurementStore.loadSnapshot({
        lifecycle: isStopped ? 'stopped' : 'running',
        epoch: 12_000,
        roundCounter: count,
        startedAt,
        stoppedAt: isStopped ? now : null,
        freezeEvents: [],
        errorCount: 0,
        timeoutCount: 0,
        endpoints: Object.fromEntries(endpoints.map((endpoint, index) => {
          const samples = samplesFor(index);
          const last = samples.at(-1) ?? null;
          return [endpoint.id, {
            endpointId: endpoint.id,
            tierLevel: 1,
            lastLatency: last?.latency ?? null,
            lastStatus: last?.status ?? null,
            lastErrorMessage: null,
            samples,
          }];
        })),
      });

      uiStore.setFocusedEndpoint(null);
      uiStore.setSharedView(false);
      uiStore.setSharedReportMode(false);
    });
  }, { count: roundCount, isStopped: stopped, spikeAt: spikeRound });
}

function boxesOverlap(page: Page, aSelector: string, bSelector: string): Promise<boolean> {
  return page.evaluate(({ a, b }) => {
    const first = document.querySelector(a);
    const second = document.querySelector(b);
    if (!first || !second) return false;
    const ar = first.getBoundingClientRect();
    const br = second.getBoundingClientRect();
    return ar.left < br.right && ar.right > br.left && ar.top < br.bottom && ar.bottom > br.top;
  }, { a: aSelector, b: bSelector });
}

function firstMonitoredEndpointId(page: Page): Promise<string> {
  return page.evaluate(() => {
    return import('/src/lib/stores/endpoints.ts').then(({ endpointStore }) => {
      let firstId = '';
      const unsubscribe = endpointStore.subscribe((endpoints) => {
        firstId = endpoints.find((endpoint) => endpoint.enabled)?.id ?? '';
      });
      unsubscribe();
      return firstId;
    });
  });
}

async function navigateToEndpoint(page: Page, endpointId: string): Promise<void> {
  await page.evaluate((id) => {
    return import('/src/lib/router.ts').then(({ navigateTo }) => {
      navigateTo({ name: 'endpoint', endpointId: id });
    });
  }, endpointId);
}

function pinPulseEvidence(page: Page): Promise<string> {
  return page.evaluate(() => {
    return Promise.all([
      import('/src/lib/stores/endpoints.ts'),
      import('/src/lib/stores/ui.ts'),
    ]).then(([{ endpointStore }, { uiStore }]) => {
      let first = null;
      const unsubscribe = endpointStore.subscribe((endpoints) => {
        first = endpoints.find((endpoint) => endpoint.enabled) ?? null;
      });
      unsubscribe();
      if (first === null) throw new Error('No enabled endpoint');

      uiStore.setPinnedPulse({
        source: 'live',
        stationId: 'A',
        endpointId: first.id,
        endpointLabel: first.label,
        slot: 59,
        roundNumber: 72,
        latency: 38,
        drift: -4,
        thresholdMs: 120,
        thresholdDelta: -82,
        timeLabel: 'now',
        capturedAt: Date.now(),
      });
      return first.id;
    });
  });
}

test.describe('Instrument shell hardening', () => {
  test('mobile shell keeps primary routes reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page);
    await seedRunningSession(page);

    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Investigate', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page).toHaveURL(/\/live$/);
    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(page).toHaveURL(/\/report$/);
  });

  test('top-level navigation resets the main scroll position', async ({ page }) => {
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 90 });

    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await expect(page).toHaveURL(/\/investigate$/);
    await expect(page.locator('.investigate-surface')).toBeVisible();
    await page.locator('main#main-content').evaluate((main) => { main.scrollTop = 900; });
    await expect.poll(() => page.locator('main#main-content').evaluate((main) => main.scrollTop)).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(page).toHaveURL(/\/report$/);
    await expect.poll(() => page.locator('main#main-content').evaluate((main) => main.scrollTop)).toBe(0);
  });

  test('running report uses draft language instead of completed-session language', async ({ page }) => {
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: false });

    await expect(page.locator('.report-surface')).toBeVisible();
    await expect(page.locator('.report-surface')).toContainText(/Live session draft|Recording in progress/i);
    await expect(page.locator('.report-surface')).not.toContainText(/Session ended|Recording paused/i);
    await expect(page.locator('.report-surface .pulse-evidence')).toContainText('Replay sample');
    await expect(page.locator('.report-instrument-lens')).toContainText('Replay moment selected by the scrubber.');
    await expect(page.locator('.report-instrument-lens')).not.toContainText('most significant detected moment');
  });

  test('overview event log does not ask users to start a running session', async ({ page }) => {
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 48 });

    await expect(page.locator('.log-section')).toContainText('No notable events in the current window yet.');
    await expect(page.locator('.log-section')).not.toContainText('Run a session to populate the log.');
  });

  test('mobile overview title and coordinates do not overlap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 36 });

    await expect(page.locator('.titlestrip h2')).toBeVisible();
    await expect(page.locator('.titlestrip .coords')).toBeVisible();
    expect(await boxesOverlap(page, '.titlestrip h2', '.titlestrip .coords')).toBe(false);
  });

  test('mobile live controls do not overlap the verdict band', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page, '/live');
    await seedRunningSession(page, { roundCount: 64 });

    await expect(page.locator('.live-stage')).toBeVisible();
    await expect(page.locator('.verdict-band')).toBeVisible();
    await expect(page.locator('.trigger')).toBeVisible();
    await expect(page.locator('.audio-toggle')).toBeVisible();
    await expect(page.locator('.hero-num .caption')).toBeHidden();

    expect(await boxesOverlap(page, '.verdict-band', '.trigger')).toBe(false);
    expect(await boxesOverlap(page, '.verdict-band', '.audio-toggle')).toBe(false);
  });

  test('mobile live keeps pinned pulse evidence inspectable without covering controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page, '/live');
    await seedRunningSession(page, { roundCount: 72 });
    await pinPulseEvidence(page);

    const evidence = page.locator('.live-stage .pulse-evidence');
    await expect(evidence).toBeVisible();
    await expect(page.locator('.trigger')).toBeVisible();
    await expect(page.locator('.audio-toggle')).toBeVisible();
    await expect(evidence).toContainText('Pinned pulse');
    await expect(evidence).toContainText('Round #72');
    await expect(evidence).toContainText('38 ms');
    await expect(evidence).toContainText('82 ms under trigger');

    expect(await boxesOverlap(page, '.live-stage .pulse-evidence', '.trigger')).toBe(false);
    expect(await boxesOverlap(page, '.live-stage .pulse-evidence', '.audio-toggle')).toBe(false);
  });

  test('keyboard focus can pin orbital pulse evidence', async ({ page }) => {
    await openInstrument(page, '/live');
    await seedRunningSession(page, { roundCount: 72 });

    const orbital = page.locator('.live-stage .orbital-scene');
    await expect(orbital).toBeVisible();
    await expect(orbital).toHaveAttribute('role', 'button');
    await orbital.focus();
    await page.keyboard.press('Enter');

    const evidence = page.locator('.live-stage .pulse-evidence');
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText('Pinned pulse');
  });

  test('orbital views expose a calibration key instead of relying on spectacle alone', async ({ page }) => {
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 72 });

    const overviewCalibration = page.locator('.overview-surface .instrument-calibration');
    await expect(overviewCalibration).toBeVisible();
    await expect(page.locator('.overview-surface .field-console .instrument-calibration')).toHaveCount(0);
    await expect(page.locator('.overview-surface .field-legend')).toContainText('Angle time');
    await expect(overviewCalibration).toContainText('Instrument key');
    await expect(overviewCalibration).toContainText('Angle');
    await expect(overviewCalibration).toContainText('Radius');
    await expect(overviewCalibration).toContainText('Gap');
    await expect(overviewCalibration).toContainText('Threshold');
    await expect(overviewCalibration).toContainText('120 ms');
    await expect(page.getByRole('img', { name: 'Orbital tracker', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Orbital tracker. Click a pulse to pin evidence.', exact: true })).toBeVisible();
    const liveCalibration = page.locator('.live-stage .instrument-calibration');
    await expect(liveCalibration).toBeVisible();
    await expect(liveCalibration).toContainText('Live tracker');
    await expect(liveCalibration).toContainText('Window');
    await expect(liveCalibration).toContainText('60 s / 60 slots');

    const endpointId = await firstMonitoredEndpointId(page);
    await navigateToEndpoint(page, endpointId);
    const endpointCalibration = page.locator('.endpoint-surface .instrument-calibration');
    await expect(endpointCalibration).toBeVisible();
    await expect(endpointCalibration).toContainText('Station drill-down');
    await expect(endpointCalibration).toContainText('Drift');

    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Orbital tracker. Click a pulse to pin evidence.', exact: true })).toBeVisible();
    const reportCalibration = page.locator('.report-surface .instrument-calibration');
    await expect(reportCalibration).toBeVisible();
    await expect(reportCalibration).toContainText('Live report draft');
    await expect(reportCalibration).toContainText('360 s / 360 slots');
  });

  test('diagnostic contract gives pages distinct jobs for the same event', async ({ page }) => {
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 72, stopped: true, spikeRound: 36 });

    await expect(page.locator('.overview-surface h1')).toContainText('Currently healthy; notable');
    await expect(page.locator('.command-center')).toBeVisible();
    await expect(page.locator('.field-console')).toContainText('Field map');
    await expect(page.locator('.field-console')).toContainText('Trigger');
    await expect(page.locator('.field-console')).not.toContainText('Instrument key');
    const overviewContract = page.locator('.diagnostic-contract-strip');
    await expect(overviewContract).toBeVisible();
    await expect(overviewContract).toContainText('Current status: healthy');
    await expect(overviewContract).toContainText('Notable event:');
    await expect(overviewContract).toContainText('Peer behavior');
    await expect(overviewContract).toContainText('Confidence');
    await expect(overviewContract).toContainText('Limit');
    await expect(overviewContract).toContainText('Next validation:');
    const commandActions = page.locator('.action-rail button');
    await expect(commandActions).toHaveCount(3);
    await expect(commandActions.nth(0)).toContainText('Inspect');
    await expect(commandActions.nth(1)).toContainText('Watch recurrence');
    await expect(commandActions.nth(2)).toContainText('Share proof');
    await expect(page.locator('.next-command')).toHaveCount(0);

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    const liveContract = page.locator('.live-contract-strip');
    await expect(liveContract).toBeVisible();
    await expect(liveContract).toContainText('Current status: healthy');
    await expect(liveContract).toContainText('Notable event:');
    await expect(liveContract).toContainText('Live stays anchored to the current round');

    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    const hypothesis = page.locator('.investigate-hypothesis');
    await expect(hypothesis).toBeVisible();
    await expect(hypothesis).toContainText('Working hypothesis');
    await expect(hypothesis).toContainText('crossed the configured trigger');

    await page.getByRole('button', { name: 'Report', exact: true }).click();
    await expect(page.locator('.hud-title h1')).toContainText('Currently healthy');
    await expect(page.locator('.hud-title h1')).toContainText('spiked during the recording');
    await expect(page.locator('.hud-title .body')).toContainText('separates the current verdict');
  });

  test('overview command actions stay visible on mobile and drill into the event endpoint', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page);
    await seedRunningSession(page, { roundCount: 72, stopped: true, spikeRound: 36 });

    const actionRail = page.locator('.action-rail');
    const evidenceGrid = page.locator('.diagnostic-contract-strip');
    const lede = page.locator('.verdict-console .lede');
    await expect(actionRail).toBeVisible();
    await expect(actionRail).toContainText('Inspect');
    await expect(actionRail).toBeInViewport({ ratio: 0.95 });
    await expect(evidenceGrid).toBeVisible();

    const railBox = await actionRail.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
    const evidenceBox = await evidenceGrid.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top };
    });
    const ledeBox = await lede.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top };
    });
    expect(railBox.bottom).toBeLessThanOrEqual(844);
    expect(railBox.top).toBeLessThan(evidenceBox.top);
    expect(evidenceBox.top - railBox.bottom).toBeGreaterThanOrEqual(8);
    expect(evidenceBox.top).toBeLessThan(ledeBox.top);

    await page.locator('.action-rail button').first().click();
    await expect(page).toHaveURL(/\/endpoint\//);
    await expect(page.locator('.endpoint-surface')).toBeVisible();
  });

  test('pinned pulse evidence follows the station from live inspection into report output', async ({ page }) => {
    await openInstrument(page, '/live');
    await seedRunningSession(page, { roundCount: 72 });
    const endpointId = await pinPulseEvidence(page);

    const liveEvidence = page.locator('.live-stage .pulse-evidence');
    await expect(liveEvidence).toBeVisible();
    await expect(liveEvidence).toContainText('Pinned pulse');
    await expect(liveEvidence).toContainText('Round #72');
    await expect(liveEvidence).toContainText('38 ms');
    await expect(liveEvidence).toContainText('82 ms under trigger');
    await expect(page.locator(`.station-row[data-endpoint-id="${endpointId}"]`)).toHaveAttribute('data-inspected', 'true');

    await navigateToEndpoint(page, endpointId);
    const endpointEvidence = page.locator('.endpoint-surface .pulse-evidence');
    await expect(endpointEvidence).toBeVisible();
    await expect(endpointEvidence).toContainText('Selected sample');
    await expect(endpointEvidence).toContainText('Round #72');

    await page.getByRole('button', { name: 'Report', exact: true }).click();
    const reportEvidence = page.locator('.report-surface .pulse-evidence');
    await expect(reportEvidence).toBeVisible();
    await expect(reportEvidence).toContainText('Pinned pulse evidence');
    await expect(reportEvidence).toContainText('Round #72');
    await expect(reportEvidence).toContainText('38 ms');
  });

  test('report image export downloads a composed artifact', async ({ page }) => {
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: true });
    await expect(page.locator('.report-surface .pulse-evidence')).toContainText('Significant sample');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save as image' }).click(),
    ]);
    const path = await download.path();

    expect(download.suggestedFilename()).toMatch(/^chronoscope-signature-.*\.png$/);
    expect(path).not.toBeNull();
    expect(statSync(path as string).size).toBeGreaterThan(10_000);
  });

  test('completed report opens on the most significant replay moment', async ({ page }) => {
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: true, spikeRound: 36 });

    const lens = page.locator('.report-instrument-lens');
    await expect(lens).toBeVisible();
    await expect(lens).toContainText('Replay lens');
    await expect(lens).toContainText('Round #36');
    await expect(lens).toContainText('most significant detected moment');
    await expect(lens).toContainText('Multiple stations');
    await expect(page.locator('.scrub-read')).toContainText('36 / 72');
    await expect(page.locator('.selected-pulse-marker')).toBeVisible();
    await expect(page.locator('.peer-pulse-marker').first()).toBeVisible();
    await expect(page.locator('.selected-angle-guide')).toBeVisible();
    await expect(page.locator('.station-card[data-selected="true"]')).toBeVisible();
    await expect(page.locator('.hud-title h1')).toContainText('Currently healthy');
    await expect(page.locator('.hud-title h1')).toContainText('spiked during the recording');
  });

  test('report replay scrub updates the evidence sample and inspector', async ({ page }) => {
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: true });

    const rail = page.locator('.scrub .rail');
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    await rail.click({ position: { x: (box?.width ?? 0) * 0.5, y: (box?.height ?? 0) * 0.5 } });

    await expect(page.locator('.scrub-read')).toContainText('36 / 72');
    await expect(page.locator('.report-surface .pulse-evidence')).toContainText('Round #36');
    await expect(page.locator('.report-instrument-lens')).toContainText('Replay moment selected by the scrubber.');
    await expect(page.locator('.report-instrument-lens')).toContainText('Round #36');
    await expect(page.locator('.selected-pulse-marker')).toBeVisible();
    await expect(page.locator('.selected-angle-guide')).toBeVisible();
    await expect(page.locator('.sample-inspector')).toBeVisible();
    await expect(page.locator('.sample-inspector')).toContainText('Round #36');
  });

  test('report lens distinguishes pinned pulse and can return to replay', async ({ page }) => {
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: true });
    await pinPulseEvidence(page);

    const lens = page.locator('.report-instrument-lens');
    await expect(lens).toBeVisible();
    await expect(lens).toContainText('pinned');
    await expect(lens).toContainText('Pinned pulse carried into the report.');
    await expect(page.locator('.station-card[data-selected="true"]')).toBeVisible();

    await page.getByRole('button', { name: 'Return to replay' }).click();
    await expect(lens).not.toContainText('Pinned pulse carried into the report.');
    await expect(lens).toContainText('Replay moment selected by the scrubber.');
  });

  test('mobile report keeps replay lens readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstrument(page, '/report');
    await seedRunningSession(page, { roundCount: 72, stopped: true, spikeRound: 36 });

    await expect(page.locator('.report-instrument-lens')).toBeVisible();
    await expect(page.locator('.report-instrument-lens .peer-row').first()).toBeVisible();
    expect(await boxesOverlap(page, '.report-instrument-lens', '.scrub')).toBe(false);
  });
});
