// 추천받기: 한국어 요청을 영어 키워드로 넓히고, 프로젝트 파일에서 기술 스택을 읽는다. 모두 브라우저 안에서만 동작.

// 한국어 → 검색 키워드. 스킬 설명은 대부분 영어라서 필요하다.
const KO = [
  [/테스트|테스팅|단위 ?테스트|e2e/, ["test", "testing", "tdd", "playwright"]],
  [/리뷰|검토|코드 ?리뷰/, ["review", "code review"]],
  [/버그|디버그|디버깅|오류|에러|원인/, ["debug", "bug", "error", "root cause"]],
  [/배포|디플로이/, ["deploy", "deployment", "vercel", "ci"]],
  [/도커|컨테이너/, ["docker", "container"]],
  [/쿠버네티스/, ["kubernetes", "k8s"]],
  [/클라우드|aws|아마존/, ["aws", "cloud"]],
  [/디자인|ui|ux|화면|예쁘|세련/, ["design", "ui", "frontend", "css"]],
  [/랜딩|홈페이지|웹사이트|사이트/, ["landing page", "website", "web"]],
  [/프론트|리액트/, ["frontend", "react"]],
  [/백엔드|서버|api/, ["backend", "api", "server"]],
  [/데이터|분석|통계/, ["data", "analysis", "analytics"]],
  [/엑셀|스프레드시트|시트/, ["excel", "xlsx", "spreadsheet", "csv"]],
  [/차트|그래프|시각화|대시보드/, ["chart", "visualization", "dashboard"]],
  [/sql|쿼리|데이터베이스|db/, ["sql", "database", "query"]],
  [/pdf/, ["pdf"]],
  [/워드|docx|문서/, ["docx", "document", "word"]],
  [/ppt|파워포인트|발표|슬라이드|프레젠테이션/, ["pptx", "slides", "presentation"]],
  [/보고서|리포트/, ["report"]],
  [/회의록|회의|미팅/, ["meeting", "notes", "minutes"]],
  [/노션/, ["notion"]],
  [/옵시디언/, ["obsidian"]],
  [/메모|노트/, ["notes", "note"]],
  [/요약/, ["summarize", "summary"]],
  [/번역/, ["translate", "translation"]],
  [/글쓰기|글|블로그|아티클|기사/, ["writing", "blog", "article"]],
  [/교정|맞춤법|문장/, ["proofread", "editing", "grammar"]],
  [/마케팅|광고/, ["marketing", "ads"]],
  [/seo|검색 ?최적화/, ["seo"]],
  [/sns|소셜|인스타|트위터|링크드인/, ["social media", "twitter", "linkedin", "instagram"]],
  [/이메일|메일/, ["email", "gmail"]],
  [/슬랙/, ["slack"]],
  [/일정|캘린더/, ["calendar", "schedule"]],
  [/기획|prd|요구사항|스펙/, ["prd", "spec", "requirements", "product"]],
  [/계획|플랜/, ["plan", "planning"]],
  [/브레인스토밍|아이디어/, ["brainstorm", "ideas"]],
  [/커밋|깃|git|pr|풀 ?리퀘스트/, ["git", "commit", "pull request"]],
  [/리팩터|리팩토링/, ["refactor"]],
  [/문서화|readme|주석/, ["documentation", "readme", "docs"]],
  [/보안|취약점|해킹/, ["security", "vulnerability", "audit"]],
  [/이미지|사진|그림/, ["image", "photo"]],
  [/영상|비디오|동영상|유튜브/, ["video", "youtube"]],
  [/음성|오디오|음악|팟캐스트/, ["audio", "voice", "music", "podcast"]],
  [/크롤링|스크래핑|수집/, ["scrape", "crawl", "scraping"]],
  [/브라우저|웹 ?자동화/, ["browser", "automation", "playwright"]],
  [/자동화/, ["automation", "automate", "workflow"]],
  [/논문|연구|학술/, ["research", "paper", "academic"]],
  [/주식|투자|트레이딩/, ["stock", "trading", "investment"]],
  [/회계|세금|재무/, ["accounting", "tax", "finance"]],
  [/계약|법률|법/, ["legal", "contract", "law"]],
  [/의료|병원|임상/, ["medical", "clinical"]],
  [/채용|면접|이력서/, ["hiring", "interview", "resume"]],
  [/mcp/, ["mcp"]],
  [/스킬 ?만들|스킬 ?제작/, ["skill creator", "writing skills"]],
  [/에이전트|서브 ?에이전트/, ["agent", "subagent"]],
  [/프롬프트/, ["prompt"]],
  [/llm|rag|임베딩/, ["llm", "rag", "embedding"]],
  [/모바일|앱|ios|안드로이드/, ["mobile", "ios", "android"]],
  [/게임/, ["game"]],
  [/한글|hwp/, ["hwp", "hangul", "korean"]],
  [/한국|국내/, ["korean", "korea"]],
  [/카카오/, ["kakao"]],
  [/네이버/, ["naver"]],
  [/공공데이터/, ["data.go.kr", "공공데이터"]],
  [/공시|dart/, ["dart", "공시"]],
];
const STOP = new Set(["그리고", "하고", "싶어", "싶어요", "싶다", "해줘", "좀", "더", "있는", "하는", "으로", "에서", "the", "a", "to", "and", "i", "want", "my", "for", "with"]);

// 메인 검색용: 한국어 단어 하나를 영어 키워드까지 넓힌다 (영어 단어는 그대로)
export function expandWord(w) {
  if (!/[가-힣]/.test(w)) return [w];
  const out = new Set([w]);
  for (const [re, kws] of KO) if (re.test(w)) kws.forEach((k) => out.add(k));
  return [...out];
}

export function buildQueryTerms(text, extra = []) {
  const lc = text.toLowerCase();
  const out = new Set(extra);
  for (const [re, kws] of KO) if (re.test(lc)) kws.forEach((k) => out.add(k));
  // 영어 단어/기술 이름은 그대로 사용
  for (const w of lc.match(/[a-z][a-z0-9.+#-]{1,}/g) || []) if (!STOP.has(w)) out.add(w);
  // 한국어 원문 단어도(한국어로 쓴 스킬 매칭용) 조사 떼고 2글자 이상
  for (const w of lc.match(/[가-힣]{2,}/g) || []) { const b = w.replace(/(을|를|이|가|은|는|에|의|로|으로|하고|해서|하는|으로|에서|이랑|랑)$/, ""); if (b.length >= 2 && !STOP.has(w)) out.add(b); }
  return [...out].filter(Boolean);
}

// 의존성 이름 → (보여줄 이름, 검색 키워드)
const DEPS = [
  [/^next$/, "Next.js", ["nextjs", "next.js", "react"]], [/^react$/, "React", ["react"]], [/^vue$/, "Vue", ["vue"]], [/^svelte|@sveltejs\/kit/, "Svelte", ["svelte"]],
  [/^nuxt/, "Nuxt", ["nuxt", "vue"]], [/^astro$/, "Astro", ["astro"]], [/^tailwindcss$/, "Tailwind", ["tailwind"]], [/shadcn|@radix-ui/, "shadcn/Radix", ["shadcn"]],
  [/^typescript$/, "TypeScript", ["typescript"]], [/^express$|^fastify$|^hono$|^koa$/, "Node.js 서버", ["api", "backend", "node"]], [/^@nestjs\/core$/, "NestJS", ["nestjs"]],
  [/^prisma$|^@prisma\/client$/, "Prisma", ["prisma", "database"]], [/^drizzle-orm$/, "Drizzle", ["drizzle", "database"]], [/supabase/, "Supabase", ["supabase"]], [/firebase/, "Firebase", ["firebase"]],
  [/^playwright$|^@playwright\/test$/, "Playwright", ["playwright", "e2e"]], [/^jest$|^vitest$|^mocha$/, "테스트", ["test", "testing"]], [/^cypress$/, "Cypress", ["cypress", "e2e"]],
  [/^stripe$/, "Stripe", ["stripe", "payment"]], [/^@anthropic-ai\/sdk$|^anthropic$/, "Claude API", ["claude api", "anthropic"]], [/^openai$/, "OpenAI", ["openai", "llm"]], [/langchain/, "LangChain", ["langchain", "llm", "rag"]],
  [/^electron$/, "Electron", ["electron"]], [/^react-native$|^expo$/, "React Native", ["react native", "mobile"]], [/^three$/, "Three.js", ["three.js", "3d"]], [/^remotion$/, "Remotion", ["remotion", "video"]],
  [/^django$/, "Django", ["django"]], [/^fastapi$/, "FastAPI", ["fastapi", "api"]], [/^flask$/, "Flask", ["flask"]], [/^pandas$|^polars$/, "pandas", ["pandas", "data"]],
  [/^numpy$|^scipy$/, "NumPy", ["data", "scientific"]], [/^torch$|^pytorch$|^tensorflow$|^jax$/, "딥러닝", ["pytorch", "machine learning"]], [/^transformers$/, "Transformers", ["hugging face", "llm"]],
  [/^streamlit$/, "Streamlit", ["streamlit", "dashboard"]], [/^matplotlib$|^plotly$|^seaborn$/, "시각화", ["visualization", "chart"]], [/^scrapy$|^beautifulsoup4$|^selenium$/, "크롤링", ["scraping"]],
  [/^rails$/, "Rails", ["rails", "ruby"]], [/^gin-gonic|^github\.com\/gin-gonic/, "Gin", ["go", "api"]], [/^tokio$|^axum$|^actix/, "Rust 서버", ["rust", "api"]],
];

export function detectStack(text) {
  const names = new Set(), terms = new Set(), deps = new Set();
  try {
    const j = JSON.parse(text);
    for (const k of ["dependencies", "devDependencies", "peerDependencies"]) Object.keys(j[k] || {}).forEach((d) => deps.add(d));
    if (deps.size) { names.add("JavaScript/Node"); terms.add("javascript"); }
  } catch {
    // requirements.txt / pyproject / go.mod / Cargo.toml / Gemfile 은 줄 단위로 대충 읽는다
    for (const line of text.split("\n")) {
      const m = line.trim().match(/^["']?([A-Za-z0-9_.@/\-]+)/);
      if (m && !/^(#|\[|module|go|require|\)|source|ruby)$/.test(m[1])) deps.add(m[1].toLowerCase());
      const gem = line.match(/gem\s+["']([\w-]+)/); if (gem) deps.add(gem[1]);
    }
    if (/^\s*module\s+\S+/m.test(text)) { names.add("Go"); terms.add("go"); }
    if (/\[package\]|\[dependencies\]/.test(text)) { names.add("Rust"); terms.add("rust"); }
    if (/\[project\]|\[tool\.poetry\]|==|>=/.test(text)) { names.add("Python"); terms.add("python"); }
    if (/^\s*gem\s/m.test(text)) { names.add("Ruby"); terms.add("ruby"); }
  }
  for (const d of deps) for (const [re, name, kws] of DEPS) if (re.test(d)) { names.add(name); kws.forEach((k) => terms.add(k)); }
  return { names: [...names], terms: [...terms] };
}

export async function readStackFromRepo(url) {
  const m = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/);
  if (!m) return { names: [], terms: [] };
  const repo = `${m[1]}/${m[2].replace(/\.git$/, "")}`;
  const files = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"];
  const texts = await Promise.all(files.map((f) => fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${f}`).then((r) => (r.ok ? r.text() : "")).catch(() => "")));
  const names = new Set(), terms = new Set();
  for (const t of texts.filter(Boolean)) { const r = detectStack(t); r.names.forEach((n) => names.add(n)); r.terms.forEach((x) => terms.add(x)); }
  return { names: [...names], terms: [...terms] };
}
