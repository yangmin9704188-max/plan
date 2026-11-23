# 작업판 개발 대시보드

**GPT가 써둔 기획·개발계획을 GitHub에서 읽고, PR 진행을 따라가며, 내가 화면에서 확인할 항목을 체크하는 개인용 대시보드.**

- 기획과 개발 계획은 GPT가 이 저장소의 `features/*.md`에 올립니다. 화면에서 등록·수정하지 않습니다.
- PR 상태는 GitHub에서 읽기만 합니다.
- 내가 입력하는 것은 확인 항목의 **통과 / 문제(+메모)**와 **완료 처리**뿐입니다. 이 값은 이 PC의 `data/state.json`에만 저장됩니다.

## 실행 (Windows PowerShell)

[Node.js 20 이상](https://nodejs.org/)이 필요합니다. 외부 패키지가 없어서 `npm install`은 필요 없습니다.

```powershell
npm start
```

브라우저에서 **http://127.0.0.1:4400** 을 엽니다.

### GitHub 연결 (비공개 저장소)

토큰을 따로 만들 필요가 없습니다. `.env`에 `GITHUB_TOKEN`이 없으면 서버가 시작할 때 **GitHub CLI 로그인(`gh auth token`)**을 가져와 메모리에서만 씁니다. 대시보드는 읽기만 합니다.

```powershell
gh auth status
```

로그인돼 있지 않다면 `gh auth login`을 한 번 실행하고 서버를 다시 켜세요. 서버 창에 `GitHub 연결: gh 로그인`이 보이면 됩니다.

권한을 좁히고 싶다면 GitHub **Fine-grained token**(Contents·Pull requests: Read-only)을 만들어 `.env`의 `GITHUB_TOKEN=`에 넣으세요. `.env` 토큰이 gh 로그인보다 우선합니다. gh 로그인을 쓰지 않으려면 `GITHUB_TOKEN_FROM_GH=0`을 넣으세요.

## 사용 흐름

1. GPT와 기획·개발 계획을 정합니다.
2. GPT가 `features/<슬러그>.md` 파일을 커밋합니다. 형식은 [`AGENTS.md`](AGENTS.md)와 [`features/_TEMPLATE.md`](features/_TEMPLATE.md)에 있습니다.
3. 대시보드에서 **새로고침**을 누르면 기능이 나타나고, Step마다 연결된 PR 상태가 보입니다.
4. 확인 항목을 보며 실제 화면을 눌러보고 **통과** 또는 **문제**를 고릅니다. 문제는 메모를 남길 수 있습니다.
5. 다 확인했으면 **완료 처리**를 누릅니다. 기능이 **완료** 메뉴로 옮겨지고, 이후 새로고침 때 PR을 다시 조회하지 않습니다.

자동 조회는 없습니다. 페이지를 처음 열 때 한 번, 그리고 새로고침 버튼을 누를 때만 GitHub를 읽습니다.

## 설정 (`.env`)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `GITHUB_TOKEN` | (없음) | 읽기 전용 토큰. 없으면 gh 로그인 사용 |
| `GITHUB_TOKEN_FROM_GH` | (켜짐) | `0`이면 gh 로그인을 쓰지 않음 |
| `FEATURES_REPO` | `yangmin9704188-max/plan` | 기능 파일이 있는 저장소 |
| `FEATURES_DIR` | `features` | 기능 파일 폴더 |
| `FEATURES_REF` | `main` | 읽을 브랜치 |
| `FEATURES_LOCAL_DIR` | (없음) | 지정하면 GitHub 대신 이 로컬 폴더를 읽음 (테스트용) |
| `PORT` | `4400` | 서버 포트 |

예시 데이터로 화면만 보려면 `FEATURES_LOCAL_DIR=examples/features`로 실행하면 됩니다.

## 주의

- **이 저장소가 공개(Public)이면 `features/`에 올린 기획도 공개됩니다.** 기획 내용을 숨기려면 저장소를 비공개로 바꾸고 토큰을 설정하세요.
- `.env`와 `data/state.json`은 Git에 올라가지 않습니다(`.gitignore`). 확인 기록을 백업하려면 `data/state.json`을 복사하세요.
- 서버는 `127.0.0.1`에만 열립니다. 단일 사용자용입니다.

## 테스트

```powershell
npm test
```

기능 파일 해석, 정확한 브랜치 연결, 변경 없는 파일 재다운로드 생략, 확인·완료 API 흐름을 Node 내장 테스트로 검증합니다.
