# Feature Board — agent instructions

Read `docs/AGENT_EXECUTION_POLICY.md` in `yangmin9704188-max/jakupan_os`
at the start of repository work, then this file and `REPOSITORY_MAP.md`.

## GPT: 기능을 대시보드에 올리는 방법

대표와 대화로 기획·개발계획이 정해지면, 이 저장소의 `features/` 폴더에 **기능 하나당 Markdown 파일 하나**를 커밋한다.
대시보드는 이 파일을 GitHub에서 읽기만 한다. 대시보드 API를 호출하거나 진행 상황을 따로 보고할 필요가 없다.

1. `features/_TEMPLATE.md`를 복사해 `features/<영문-슬러그>.md`로 만든다. 슬러그가 기능 ID다. **한 번 정하면 파일명을 바꾸지 않는다.**
2. 앞부분(front matter)
   - `title`: 기능 이름
   - `products`: 쉼표로 구분, 여러 개 가능 (Office, Worker, Works 등 새 이름도 가능)
   - `repo`: 개발 Step의 기본 `owner/repo`
3. `## 기획`: 왜, 누구를 위해, 어떤 의도로 만드는지 자유 텍스트. 칸을 나누지 않는다.
4. `## 개발 계획`: Step 하나당 목록 한 줄. 순서가 Step 번호다.
   - `- 제목 | branch: feat/x` — 브랜치로 PR을 정확히 찾는다 (유사 제목 매칭 없음)
   - `- 제목 | branch: feat/x | repo: owner/other` — 다른 저장소
   - `- 제목 | pr: 123` — 이미 PR 번호를 아는 경우
   - `- 제목` — 아직 브랜치 미정 (대시보드에 `브랜치 미연결`로 표시)
   - 실제 PR이 계획과 달라지면 이 목록을 고쳐서 커밋한다. 계획에 없는 PR은 대시보드에 나타나지 않는다.
5. `## 확인 항목`: 대표가 실제 화면에서 눌러볼 순서와 기대 결과를 한 줄씩. 예: `정산 화면 → 3월 선택 → 업체별 합계가 엑셀과 같은지`
   - 대표의 통과/문제 기록은 **문장 그대로** 연결된다. 이미 확인한 항목의 문장을 고치면 그 항목은 미확인으로 돌아간다.

대표는 대시보드의 **새로고침** 버튼으로 파일과 PR을 다시 읽는다. 자동 조회는 없다.

## Product constraints

- Single-user, local-only dashboard. Not an agent orchestration service.
- Plan content comes only from `features/*.md` in GitHub. The UI has no create/edit/delete for plans.
- PR state comes only from GitHub read-only calls, on manual refresh.
- Local state (`data/state.json`) holds only the owner's check results (`pending` / `pass` / `issue` + note) and completion.
- Feature status is just 미완료 / 완료, set by the owner. Never infer completion from merged PRs.
- Completed features are not looked up on refresh, so the dashboard stays fast as they accumulate.
- Store `GITHUB_TOKEN` in local `.env`; never in source, frontend, or repository.
- Keep the service bound to `127.0.0.1`.
- No ROVENTRA dependency and no ROVENTRA workflow gates.

## Repository scope

- `features/`: GPT-written feature files (`_`-prefixed files are ignored)
- `server.mjs`: HTTP routing, local-only guard, static serving, env config
- `lib/features.mjs`: feature Markdown parser
- `lib/github.mjs`: read-only GitHub folder reading and PR status
- `lib/board.mjs`: manual sync snapshot and active/done views
- `lib/state.mjs`: owner check/completion JSON store
- `public/`: dashboard UI
- `test/`: focused Node built-in tests

Record the loaded execution policy revision in any handoff; do not copy its active mode into this file.
