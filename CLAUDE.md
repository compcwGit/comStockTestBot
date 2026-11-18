# 작업 규칙 (Claude용)

이 저장소(주식노트 (StockNote))는 찬욱의 개인 프로젝트입니다. 대화는 한국어로 합니다.

## 작업 환경 구분 (집 / 외부) — 세션 시작 시 가장 먼저 판별
원본은 항상 GitHub이다. 브랜치는 `main`(최종본)과 `external`(외부 작업) 두 개를 쓴다. 외부에 있을 때 집 PC는 꺼져 있다.
(이 영역은 family-apps, household-ledger, comStockTestBot 세 저장소에서 똑같이 유지한다. 고칠 때는 세 곳 모두 고친다)

### 모드 판별 (위에서부터 먼저 맞는 것)
1. **찬욱이 직접 말하면 그게 우선**: "집이야" → 집 모드 / "회사야"·"밖이야"·"폰이야" → 외부 모드
2. 집 PC에 접근할 수 있으면 → 집 모드 (Claude 데스크톱 앱이 집 PC에 연결돼 `mcp__remote-devices__*` 도구가 있거나, 아래 집 PC 소스 경로에서 Claude Code를 실행한 경우)
3. 그 외 → 외부 모드
- 집 PC 소스 경로: `V:\WorkProject\<저장소 이름>` (예: `V:\WorkProject\family-apps`). 집 PC 에서 Claude 는 이 폴더를 연결해서 작업

### "집이야"라고 하면 — 집 모드 세팅
1. 위 집 PC 소스 경로가 비어 있으면 물어보고, 세 저장소의 이 파일에 모두 기록한다
2. 그 폴더가 이 저장소를 clone한 폴더인지, `origin`이 맞는지, 커밋 안 된 변경이 있는지 확인한다
3. 아래 "집 모드 — 시작할 때"를 실행하고, 외부에서 한 작업 요약과 "집에서 확인할 것" 목록(`git log main..origin/external`의 커밋 메시지)을 보여준다
4. 집 PC에 접근할 수 없으면(데스크톱 앱 미연결) 연결하라고 안내하거나 아래 명령을 직접 실행하게 한다. 클라우드에서 대신 `main`에 push하지 않는다

### 외부 모드 (회사·출퇴근길 폰)
1. `external`을 받고 최신 `main`을 합친다 (`external`이 없으면 `main`에서 새로 만든다)
2. 작업하고 커밋한 뒤 **`external`에만 push**한다. `main`에는 push하지 않는다
3. 실제 실행(Electron 창, 안드로이드 기기·에뮬레이터, 아이폰 등)으로 확인하지 못한 부분은 커밋 메시지에 `집에서 확인:` 줄로 남기고, 마지막 답변에도 따로 알린다

### 집 모드
- **시작할 때** (외부 작업 받아오기)
  ```
  git checkout main
  git pull
  git fetch origin
  git merge origin/external
  ```
- **끝날 때** (최종본 올리고 `external`도 맞추기)
  ```
  git push origin main
  git push origin main:external
  ```
- 집에서는 `main`에서 작업한다. `external`에 직접 커밋하지 않는다
- 집과 외부에서 같은 파일을 고쳐 충돌이 나면 집에서 해결한다
- 끝날 때 push를 안 했으면 찬욱에게 꼭 알린다 (안 하면 외부에서 옛날 코드로 작업하게 됨)
