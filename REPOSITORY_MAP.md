# Repository map

| Area | Owned paths | Contract |
| --- | --- | --- |
| Feature files | `features/`, `lib/features.mjs` | One Markdown file per feature, written by GPT. Sections `## 기획`, `## 개발 계획`, `## 확인 항목`. File name = feature ID. Check ID = hash of its text. |
| Read-only GitHub | `lib/github.mjs` | Reads the features folder (skips unchanged blobs by sha) and PRs by exact `owner/repo` + PR number or exact head branch. A failed lookup is `unavailable`, not `planned`. |
| Sync + views | `lib/board.mjs` | Manual refresh only. Completed features are not looked up. Active / done views. |
| Owner state | `lib/state.mjs`, `data/` | Check result + note + completion only. Local JSON, not committed. |
| HTTP API + runtime | `server.mjs` | Localhost-only, no GitHub mutation, no CORS. |
| UI | `public/` | 대시보드 / 완료. Read-only plan and steps, owner 통과/문제 checks, 완료 처리. |
| Tests | `test/` | Parser, exact PR association, folder caching, API flow. |

Read only the relevant row and owning files for bounded changes.
