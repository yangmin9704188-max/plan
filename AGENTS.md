# Feature Board — agent instructions

Read `docs/AGENT_EXECUTION_POLICY.md` in `yangmin9704188-max/jakupan_os`
at the start of repository work, then this file and `REPOSITORY_MAP.md`.

## Product constraints

- This is a **single-user, local-only internal dashboard**, not an agent orchestration service.
- Agents do **not** have to report activity, update a task state or call this dashboard during PR implementation.
- The owner/LLM registers the plan once. Subsequently, PR state must come **only from GitHub** by read-only API calls.
- Never infer deploy, runtime verification, or owner acceptance from a merged PR.
- Only direct owner checklist input can set owner verification to `pass` or `issue`.
- Keep the UI compact and legible at 1920 px; avoid recurring progress-report workflows or hierarchy proliferation.
- Store `GITHUB_TOKEN` in local `.env`; do not add token to source, frontend, or repository.
- Keep the service bound to `127.0.0.1` until authentication is deliberately added.
- Use focused tests for changed behavior; no mandatory full-gate loops.
- No ROVENTRA dependency and no ROVENTRA workflow gates.

## Repository scope

- `server.mjs`: Node HTTP routing, local-only guard, static serving
- `lib/store.mjs`: JSON persistence, plan input and owner check state
- `lib/github.mjs`: GitHub read-only PR status resolution
- `public/`: interface and client-side interaction
- `test/`: focused Node built-in tests
- `docs/`: product spec and development plan

Record the loaded execution policy revision in any handoff; do not copy its active mode into this file.