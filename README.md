# M365 vendor consolidation

A static, browser-only planning tool for identifying third-party security and productivity tools that may be replaced or reduced when moving to Microsoft 365 E3, E5, or E7.

## What it does

- Lets users enter current vendors such as Okta, CrowdStrike, Proofpoint, Zscaler, Slack, or Box.
- Highlights matching Microsoft 365 features by category and plan.
- Compares E1 baseline coverage with E3, E5, and E7 consolidation targets.
- Filters by category, plan, feature search, E5 uplift, or only rows matched to entered vendors.
- Stores entered vendors, feature statuses, and active plan filter in `localStorage` only.
- Exports the currently visible rows to CSV with attribution and a timestamp.
- Works offline through a service worker that caches the app shell and feature data.

## Data source and attribution

Feature data is sourced from [M365 Maps](https://m365maps.com/matrix.htm#00000000000010011000000) by Aaron Dinnage and used with attribution. The data lives in [`data/features.json`](data/features.json) so it can be reviewed, version-controlled, and updated without changing application code.

This project is not an official Microsoft tool. Licensing and feature availability can change; validate important decisions with Microsoft licensing guidance before acting.

## Run locally

This is a plain HTML, CSS, and JavaScript app. Use any static server from the repository root:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Validate

```bash
npm test
npm run build
```

`npm run build` writes `version.json`, which is used by the GitHub Pages deployment and service worker cache refresh flow.
