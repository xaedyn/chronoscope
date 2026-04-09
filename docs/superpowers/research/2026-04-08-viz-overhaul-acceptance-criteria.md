---
date: 2026-04-08
feature: viz-overhaul
type: acceptance-criteria
---

# Acceptance Criteria — Phase 1 Visualization Overhaul

AC1: When a user runs a test against endpoints with latencies in the 20-150ms range, the scatter plot Y-axis auto-fits to display data using at least 60% of the vertical canvas area, with gridlines labeled at intervals meaningful to the actual data range.

AC2: When a new measurement arrives during an active test, a visible sonar ping animation (expanding ring) appears at the data point's position on the canvas within the same render frame, with ring color and expansion speed corresponding to the latency tier (fast/medium/slow/timeout).

AC3: When at least 20 samples have been collected for an endpoint, a semi-transparent trace ribbon (P25-P75 band) with a P50 median line renders on the timeline for that endpoint, updating with each new sample, making latency trend and variance visually distinguishable without reading summary card numbers.

AC4: When the timeline view is active, the X-axis displays labeled tick marks (round numbers) along the bottom edge of the canvas, with adaptive tick density that avoids overlapping labels regardless of total round count.

AC5: When no measurement data exists (fresh load or after clearing results), the timeline canvas displays an animated sonar sweep effect with instructional text, and the sweep stops within one render frame of the first measurement arriving.
