# 스킬집

깃허브에 흩어진 AI 에이전트 스킬(SKILL.md)을 자동으로 모아 용도별로 나누고, 설치 전에 안전 검사를 하고, 같이 써보며 이야기 나누는 사이트입니다.

- 스킬 5만여 개, 카테고리 20개, 에이전트 15종(Claude Code, Codex, Copilot, Cursor 등)의 설치 방법
- 설치 전 자동 안전 검사 (근거가 된 파일의 줄까지 링크)
- 검증됨 표시: 안전 검사 통과 + 최근 90일 안에 관리 + 인기 또는 후기 충분
- 떠오르는 스킬, 새로 나온 스킬, RSS, 이번 주 같이 써볼 스킬
- 하고 싶은 일로 추천받기, 상황별 스타터팩 (한 줄 설치)
- 한국 사용자용 스킬 모음, 한국어 사용법
- 스킬별 후기·토론 (GitHub Discussions + giscus, 무료)

**기본 설정으로는 운영 비용이 0원입니다.** 정적 사이트 + GitHub Actions + GitHub Discussions만 씁니다. AI 기능은 아래 "AI 기능 켜기"에서 필요할 때 켭니다.

## 구조

```
site.json                 제목, 주소, 기능 스위치, giscus 설정
scripts/crawl.mjs         GitHub 수집 → data/crawled.json, safety.json, history/
scripts/safety.mjs        안전 검사 규칙
scripts/categorize.mjs    카테고리 분류 규칙
scripts/korea.mjs         한국 사용자용 판별 규칙
scripts/agents.mjs        에이전트 호환 판별
scripts/community.mjs     Discussions 후기 수, 최근 글 → data/community.json
scripts/enrich.mjs        (선택, 유료) AI로 한국어 설명·키워드·사용법 → data/ai/
build.mjs                 data/ → dist/ (네트워크 없이 동작)
api/recommend.js          (선택, 유료) AI 추천 서버 함수
data/curated/*.json       손으로 고른 항목 (추천 표시, 한마디, 분류 수정, 목록 밖 스킬 추가)
data/ko/<id>.json         사람이 쓴 한국어 사용법 (AI 생성보다 우선)
data/packs.json           스타터팩
data/agents.json          에이전트별 설치 경로 (공식 문서 기준)
data/excluded-repos.json  수집에서 뺄 저장소
data/extra-repos.json     검색에 안 걸려도 넣을 저장소
public/                   화면
```

## 로컬에서

```bash
node scripts/crawl.mjs        # 처음엔 30분 이상 걸림. gh 로그인 필요 (gh auth login)
node build.mjs
npx serve dist
```

## 배포

1. 이 폴더를 깃허브 새 **공개** 저장소로 올립니다.
2. Vercel → Add New → Project → 저장소 선택 → Deploy. (설정은 `vercel.json`에 있음)
3. `site.json`의 `url`(배포 주소)과 `github`(owner/repo)을 채웁니다.
4. Actions 탭에서 `weekly-crawl`이 켜져 있는지 확인합니다. 매주 월요일 다시 수집해 커밋하고, Vercel이 자동으로 다시 배포합니다.

## 커뮤니티 켜기 (무료)

1. 저장소 Settings → Features → Discussions 체크.
2. Discussions에 카테고리를 만듭니다. 이름은 영어로 해야 주소가 깔끔해요.
   - `Skill reviews` (형식: Announcement 말고 Open-ended) — 스킬별 토론이 여기에 쌓임
   - `Q&A` (기본 제공), `Ideas` (기본 제공), `General` (기본 제공)
   - `.github/DISCUSSION_TEMPLATE/`의 `skill-reviews.yml`, `ideas.yml` 양식이 자동으로 적용됩니다.
3. https://github.com/apps/giscus 설치 → 이 저장소 선택.
4. https://giscus.app/ko 에서 저장소를 입력하고, 카테고리 `Skill reviews`를 고르면 `repo-id`, `category-id`가 나옵니다. `site.json`의 `giscus`에 넣으세요.

```json
"giscus": { "repo": "owner/repo", "repoId": "R_...", "category": "Skill reviews", "categoryId": "DIC_..." }
```

## AI 기능 켜기 (유료, 선택)

### 1) 빌드 때 한국어 정리 생성 — 권장

스킬마다 한국어 설명, 한국어 검색 키워드, "이럴 때 쓰세요", 예시 요청을 만들어 `data/ai/`에 저장합니다. 방문자가 많아도 비용이 늘지 않습니다. Batch API(50% 할인) 사용.

```bash
export ANTHROPIC_API_KEY=...
node scripts/enrich.mjs --estimate            # 예상 비용만 계산
node scripts/enrich.mjs --limit 100           # 100개로 실제 비용 확인
node scripts/enrich.mjs --only-new            # 나머지 전부
```

기본 모델은 `claude-haiku-5-5`(가장 저렴). `--model claude-sonnet-5-5`로 품질을 올릴 수 있습니다.
매주 새 스킬에만 자동으로 돌리려면 저장소 Secrets에 `ANTHROPIC_API_KEY`, Variables에 `AI_ENRICH=true`.

### 2) 방문자 실시간 AI 추천 — 트래픽 따라 비용 증가

`site.json`의 `features.aiRecommend`를 `true`로 바꾸고 Vercel 환경변수에 `ANTHROPIC_API_KEY`를 넣습니다.
기본 모델은 Haiku 5.5, 하루 300회, IP당 분당 5회 제한(`RECOMMEND_DAILY_LIMIT`, `RECOMMEND_PER_IP_PER_MIN`, `RECOMMEND_MODEL`로 조정).
제한은 서버 메모리 기반이라 느슨하므로, Anthropic 콘솔에서 월 사용 한도도 함께 걸어 두세요.
꺼져 있으면 추천은 키워드 매칭(무료)으로 동작합니다.

## 손으로 다듬기

- 추천 표시/한마디: `data/curated/<아무이름>.json`에 `{ "repo": "owner/repo", "path": "skills/x", "featured": true, "note": "..." }`
- 분류가 틀렸으면 같은 파일에 `"category": "dev"`
- 한국어 사용법을 직접 쓰려면 `data/ko/<스킬id>.json` (`description`, `summary`, `when`, `examples`, `notes`)
- 스타터팩: `data/packs.json`
