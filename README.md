# 작업판 개발 진행표 (JAKUPAN Feature Board)

**기획을 한 번 등록하고, PR은 GitHub에서 읽고, 사용자가 실제 화면을 확인하는 작은 내부 웹 도구.**

ROVENTRA, 실행 에이전트, 추가 상태 보고, GitHub 쓰기 권한, 별도 DB 서버가 필요 없습니다.

## 1분 실행 (Windows PowerShell)

1. [Node.js 20 이상](https://nodejs.org/)이 설치되어 있어야 합니다.
2. ZIP 압축을 풀고 PowerShell에서 폴더로 이동합니다.
3. 아래 명령을 실행합니다.

```powershell
npm start
```

4. 웹브라우저에서 **http://127.0.0.1:4400** 를 엽니다.

`npm install`은 필요 없습니다. 외부 패키지 의존성이 없습니다.

### 비공개 GitHub 저장소의 PR 자동 조회

기본 설정은 공개 저장소만 조회합니다. 비공개 저장소를 읽으려면 GitHub **Fine-grained personal access token**을 한 번 설정합니다.

- GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- 조회할 저장소만 선택하고 **Pull requests: Read-only** 권한을 부여합니다. GitHub의 저장소 메타데이터 기본 읽기 권한은 자동 포함됩니다.
- 프로젝트 폴더에서 `.env.example`을 `.env`로 복사하고 `GITHUB_TOKEN=발급한토큰`을 입력합니다.

```powershell
Copy-Item .env.example .env
notepad .env
npm start
```

`.env`와 직접 확인한 데이터(`data/features.json`)는 `.gitignore`로 제외됩니다. **토큰은 서버에서만 사용하며 브라우저로 전달하지 않습니다.**

GitHub 연동에 ChatGPT의 기존 GitHub 연결 토큰을 자동으로 넘겨받지는 않습니다. 로컬 서버에서 비공개 저장소를 조회할 때는 위 읽기 전용 토큰이 별도로 필요합니다.

## 사용 순서

1. GPT와 확정한 **최종 기획서·개발계획서**를 GitHub 문서 링크 또는 본문으로 기능 등록 화면에 한 번 입력합니다.
2. 계획된 PR마다 `owner/repo`와 **정확한 브랜치 이름**을 입력합니다. 이미 존재하는 PR이라면 `PR 번호`를 적는 편이 더 확실합니다.
3. 개발/병합/검증은 평소처럼 GitHub와 에이전트에서 진행합니다. **이 사이트에 별도 작업 보고를 할 필요가 없습니다.**
4. 사이트에서 GitHub PR 상태를 자동 조회합니다. 열려 있는 동안 약 2분 간격으로 확인하고, 'PR 새로고침'으로 즉시 조회할 수 있습니다.
5. 실제 화면에서 확인할 때만 '미확인 / 통과 / 문제'를 고르고 필요하면 메모를 남깁니다.

**주의:** 병합은 배포 또는 검증 완료를 뜻하지 않습니다. 화면에는 GitHub 사실과 사용자의 확인 결과를 각각 보여줍니다.

## 기획 등록 API (선택)

대표님이 직접 입력하는 대신 **같은 PC의 로컬 에이전트**가 처음 한 번 등록할 수 있습니다.

```powershell
$body = Get-Content .\examples\feature.json -Raw -Encoding UTF8
Invoke-RestMethod -Uri 'http://127.0.0.1:4400/api/features' -Method Post -ContentType 'application/json; charset=utf-8' -Body $body
```

`examples/feature.json`의 예시는 실제 기능이 아니므로 필요한 내용을 입력한 다음 호출하세요. 웹 ChatGPT 같은 클라우드 에이전트는 사용자의 localhost에 직접 접근하지 못할 수 있습니다. 이 경우 기획서를 GitHub에 작성하고 대표님이 웹 화면에서 문서 링크만 등록하면 됩니다.

### API

| 요청 | 설명 |
| --- | --- |
| `GET /api/features` | 등록된 기능/계획/확인 목록 |
| `POST /api/features` | 새 기능 처음 등록 |
| `PATCH /api/features/:id` | 문서 링크, PR 계획, 체크 항목 수정 |
| `DELETE /api/features/:id` | 해당 로컬 등록 삭제. GitHub 원문/PR은 그대로 둠 |
| `GET /api/progress` | GitHub PR 상태 조회(2분 캐시) |
| `GET /api/progress?refresh=1` | 캐시 무시하고 GitHub PR 재조회 |
| `PATCH /api/features/:id/checks/:checkId` | 실제 확인 결과 `{ "result": "pass", "note": "..." }` 저장 |
| `GET /api/health` | 서버 상태와 읽기 전용 토큰 설정 여부 |

사용자 확인값(`result`)은 `pending`, `pass`, `issue` 중 하나입니다. 체크 항목 상태 수정은 기능 편집 API가 아니라 **확인 전용 API**를 통해서만 할 수 있습니다.

## GitHub 저장소에서 실행하기

이 소스의 원격 저장소는 **`yangmin9704188-max/plan`** 입니다. 처음 설치할 때는 아래처럼 내려받습니다.

```powershell
git clone https://github.com/yangmin9704188-max/plan.git
cd plan
npm start
```

Git 설치가 필요합니다. GitHub가 아니라 로컬 PC에서 실행하는 도구이며, 저장소가 공개(`Public`)여도 토큰이나 사용자가 입력한 기획·체크리스트 데이터가 자동으로 공개되지는 않습니다. `.env`와 `data/features.json`은 Git에 올리지 마세요.

## 로컬 데이터 / 주의사항

- 기능·기획·사용자 확인 결과: `data/features.json` (로컬 저장, GitHub에 자동 업로드되지 않음)
- GitHub PR: GitHub API를 호출해 **읽기만** 함. API 오류 시 '조회 불가' 표시
- 기획 원문: GitHub 주소 연결 가능. 원문을 API로 복제하거나 GitHub에서 수정하지 않음
- 서버 주소: **127.0.0.1:4400**, 네트워크 외부에 노출되지 않음
- 이 앱은 **개인 PC용 단일 사용자** 설계입니다. 외부에 공개하려면 로그인, 권한, HTTPS, 배포 설정이 별도로 필요합니다.
- 데이터 백업은 `data/features.json`을 안전한 위치에 복사하면 됩니다. 파일을 저장소에 커밋하면 안 됩니다.

## 테스트

```powershell
npm test
```

데이터 저장·동시 갱신·PR의 정확한 연결·GitHub 오류 분류·HTTP API 흐름을 Node 내장 테스트로 검증합니다.