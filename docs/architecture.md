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

## Filter semantics

The filter panel exposes two related but distinct controls that are easy to confuse:

- **Plan filter** decides which *rows* are shown. Picking `E5` hides any feature that is not covered by E5; picking `All` shows every feature in the matrix regardless of plan. **Plan diff** is a stricter variant: `E5 additions over E3` shows only the features that E5 covers but E3 does not — the headline list when discussing an upgrade.
- **Show plans in table** decides which plan *columns* are visible. It does not change which rows are listed, only how wide the table is. Hide E7 here if a customer is only weighing E3 vs E5 and you want a less noisy table.

Coverage values come in three families and the filter panel lets you opt into the last two so they don't muddy the conversation by default:

| Family | Examples | Default in plan filter / diff |
| --- | --- | --- |
| Included | `Included`, `Plan 2`, `1.5 TB`, `Unknown` | Always counted as covered |
| Add-on | `Add-on`, `Available add-on`, `Package only` | Excluded — toggle "Include add-ons" to count them |
| Azure consumption | `Azure consumption` | Excluded — toggle "Include Azure consumption" to count them |

`Add-on` rows are licensable on top of the suite (SharePoint Premium, Defender for Office 365 Plan 2 on E3, etc.). `Azure consumption` rows (Microsoft Sentinel, Defender for Cloud, Defender for Servers) are billed through an Azure subscription, not per-user M365 licences, so they don't really belong in a per-seat comparison until you ask the customer about it.

## Suggested consolidation workflow

A typical "what can I consolidate on E5?" meeting flows like this:

1. Reset browser data and select **Plan diff → E5 additions over E3**. The table now lists everything the customer would *gain* by upgrading, sorted by business capability.
2. Walk through the rows in business-value view and confirm what the customer already has from a third-party vendor — those are the consolidation candidates.
3. Toggle **Include add-ons** on. New rows appear (e.g. SharePoint Advanced Management, SharePoint Premium, Copilot capabilities). For each one, ask whether they have those add-on licences yet — these often unlock value the customer paid for but isn't using.
4. Toggle **Include Azure consumption** on. Microsoft Sentinel (SIEM/SOAR), Defender for Cloud, Defender for Servers etc. appear. These are conversation starters for: "What runs on your servers today?" and "Do you have a separate SIEM?".
5. Optionally narrow with the **Category tabs** (e.g. Security, Compliance) and use **Export visible rows to CSV** to leave the customer with a tailored handout.

The two toggles are designed to be flipped during the meeting — they do not persist across reloads so every meeting starts from the same clean baseline.
