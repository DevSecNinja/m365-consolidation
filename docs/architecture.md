# Architecture

The MVP is a static web application with no server-side database.

## Files

- `index.html` defines the application shell and accessible landmarks.
- `src/styles.css` contains the light/dark responsive UI styling.
- `src/app.js` loads feature data at runtime, renders the UI, and wires browser events.
- `src/logic.js` contains pure functions for filtering, vendor matching, summaries, CSV export, and persistence adapters.
- `data/features.json` is the version-controlled Microsoft 365 feature matrix used by the app.
- `service-worker.js` caches the app shell and loads feature data with a network-first strategy.
- `.github/workflows/pages.yml` builds `version.json` with the commit SHA and deploys to GitHub Pages.

## Data flow

1. The app fetches `data/features.json` at startup.
2. User-entered vendors are matched against each feature's `commonVendors` values.
3. Filters are applied in memory and the visible feature list is rendered into the matrix.
4. Vendors, feature status annotations, theme, category, and active plan filter are persisted to `localStorage`.
5. CSV export uses the current filtered rows only.

## Privacy

All user-entered data stays in the browser. The static app does not send vendors or annotations to a backend service.
