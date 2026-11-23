# Repository map

| Area | Owned paths | Contract |
| --- | --- | --- |
| Read-only GitHub state | `lib/github.mjs` | Exact `owner/repo` + PR number or exact head branch. A failed lookup is `unavailable`, not `planned`. |
| Plan and owner check storage | `lib/store.mjs`, `data/` | Markdown/text and PR slots registered once; only checklist endpoint changes existing verification values. Local JSON is not committed. |
| HTTP API + runtime | `server.mjs` | Localhost-only API, no GitHub mutation, no CORS. |
| UI | `public/index.html`, `public/app.js`, `public/styles.css` | Feature overview, detailed plan, read-only PR timeline, owner checkboxes. |
| Regression tests | `test/` | Data persistence, exact PR association, error classification and API flow. |

Read only the relevant row and owning files for bounded changes.