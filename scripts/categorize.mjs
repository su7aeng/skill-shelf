// 이름/설명/경로로 카테고리를 추정한다. 키워드 점수가 가장 높은 카테고리, 동점이면 목록 앞쪽 우선.
// 손으로 고치고 싶으면 data/overrides/*.json 의 category 로 덮어쓰면 된다.
const RULES = [
  ["security", 3, /\b(security|secur(e|ity)|vulnerab\w*|pentest\w*|penetration|exploit\w*|malware|threat\w*|cve|owasp|forensic\w*|siem|red[- ]team|blue[- ]team|ctf|phishing|incident response|soc\b|xss|sqli|secrets? scan\w*|osint|reverse engineer\w*)\b/g],
  ["medical", 3, /\b(medical|clinical|clinic|patient\w*|health\w*|biolog\w*|bioinformatic\w*|genom\w*|protein\w*|drug\w*|pharma\w*|dna|rna|single[- ]cell|disease\w*|hospital|fhir|molecul\w*|chem\w*|neuro\w*|radiolog\w*|ehr|medicine)\b/g],
  ["legal", 3, /\b(legal|law|laws|lawyer\w*|attorney|contract\w*|compliance|gdpr|regulat\w*|court|litigation|recht\w*|statute\w*|patent\w*|trademark\w*|nda|privacy policy)\b/g],
  ["finance", 3, /\b(financ\w*|stock\w*|trading|trader|invest\w*|portfolio|accounting|bookkeep\w*|tax(es)?|crypto\w*|defi|blockchain|web3|solidity|wallet\w*|bank\w*|invoice\w*|budget\w*|equity|valuation|fintech|payment\w*)\b/g],
  ["research", 2, /\b(research\w*|paper\w*|academic\w*|journal\w*|citation\w*|literature|arxiv|scientific|science|thesis|empirical|econometric\w*|scholar\w*|latex|peer review|hypothes\w*|experiment\w*|statistic\w*)\b/g],
  ["docs", 2, /\b(pdf\w*|docx|word document\w*|excel|xlsx|pptx|powerpoint|slides?|slide deck|presentation\w*|spreadsheet\w*|google docs|notion|obsidian|documentation|readme\w*|office)\b/g],
  ["media", 2, /\b(image\w*|video\w*|audio|music\w*|voice\w*|speech|podcast\w*|photo\w*|midjourney|stable diffusion|ffmpeg|remotion|3d|blender|game\w*|unity|unreal|gif\w*|tts|transcri\w*|youtube|illustrat\w*|art|artwork|sora|comic\w*)\b/g],
  ["design", 2, /\b(ui|ux|design\w*|frontend|front-end|css|tailwind|figma|web design|landing page\w*|animation\w*|svg|icon\w*|typograph\w*|brand\w*|visual\w*|layout\w*|style guide|shadcn|accessib\w*|a11y|theme\w*)\b/g],
  ["marketing", 2, /\b(marketing|seo|ads?|advertis\w*|campaign\w*|growth|sales|crm|outreach|lead\w*|social media|tiktok|instagram|twitter|linkedin|x\.com|customer\w*|e-?commerce|shopify|copywrit\w*|newsletter\w*|conversion|funnel\w*|brand voice)\b/g],
  ["product", 2, /\b(product manag\w*|product manager|pm|prd\w*|roadmap\w*|strategy|strateg\w*|business|startup\w*|okr\w*|user stor\w*|requirement\w*|stakeholder\w*|meeting\w*|pitch\w*|hr|hiring|recruit\w*|interview\w*|resume\w*|job\w*|career\w*|competitive analysis|market research|okrs|sprint\w*|jira|linear)\b/g],
  ["devops", 2, /\b(docker\w*|kubernetes|k8s|terraform|aws|gcp|azure|cloud\w*|deploy\w*|ci\/cd|cicd|github actions|infra\w*|devops|monitor\w*|observab\w*|helm|serverless|linux|nginx|vercel|cloudflare|ansible|sre|incident\w*|logging|prometheus|grafana)\b/g],
  ["testing", 2, /\b(test\w*|debug\w*|code review\w*|review\w*|lint\w*|qa|bug\w*|playwright|e2e|tdd|regression\w*|verif\w*|quality assurance|coverage)\b/g],
  ["data", 2, /\b(data\w*|analytics?|analy[sz]\w*|sql|postgres\w*|mysql|sqlite|csv|pandas|dashboard\w*|chart\w*|visuali[sz]\w*|etl|bigquery|snowflake|dbt|metric\w*|duckdb|mongo\w*|redis|supabase)\b/g],
  ["ai", 2, /\b(llm\w*|machine learning|ml|model training|fine-?tun\w*|pytorch|tensorflow|hugging ?face|embedding\w*|rag|retrieval|inference|neural|transformer\w*|openai|gemini|claude api|anthropic api|vector\w*|eval\w*|benchmark\w*|diffusion|dataset\w*)\b/g],
  ["automation", 2, /\b(browser\w*|scrap\w*|crawl\w*|automat\w*|n8n|zapier|integrat\w*|slack|gmail|email\w*|calendar|webhook\w*|rpa|selenium|puppeteer|telegram|discord|whatsapp|feishu|lark|dingtalk|wechat)\b/g],
  ["meta", 3, /\b(skill\w*|agent\w*|subagent\w*|sub-agent\w*|claude code|codex|cursor|hook\w*|plugin\w*|mcp|prompt\w*|context engineering|claude\.md|agents\.md|orchestrat\w*|multi-agent)\b/g],
  ["workflow", 2, /\b(plan\w*|brainstorm\w*|task\w*|todo\w*|productiv\w*|memory|note\w*|git|commit\w*|worktree\w*|pull request\w*|pr|changelog\w*|session\w*|handoff|standup|journal\w*|habit\w*|time management|focus)\b/g],
  ["writing", 2, /\b(writ\w*|blog\w*|article\w*|essay\w*|story|stories|novel\w*|fiction|translat\w*|proofread\w*|editing|editor\w*|tone|grammar|summar\w*|copy ?edit\w*|content\w*|script\w*writ\w*|screenplay\w*|poem\w*|poetry)\b/g],
  ["dev", 1, /\b(code|coding|program\w*|api\w*|backend|back-end|python|typescript|javascript|rust|golang|go|java|kotlin|swift|ios|android|flutter|react\w*|vue|svelte|next\.?js|node\w*|django|fastapi|rails|laravel|php|ruby|c\+\+|c#|\.net|architect\w*|refactor\w*|framework\w*|library|sdk|cli|mobile|web ?app\w*|database schema|migration\w*|graphql|rest)\b/g],
];

export const CATEGORIES = [
  { id: "dev", name: "개발", desc: "언어, 프레임워크, 백엔드, 모바일" },
  { id: "testing", name: "테스트·디버깅", desc: "테스트, 버그 수정, 코드 리뷰" },
  { id: "design", name: "디자인·프론트엔드", desc: "UI, CSS, 컴포넌트, 브랜딩" },
  { id: "devops", name: "배포·인프라", desc: "클라우드, 컨테이너, CI/CD, 모니터링" },
  { id: "data", name: "데이터 분석", desc: "SQL, 데이터 처리, 대시보드, 시각화" },
  { id: "ai", name: "AI·머신러닝", desc: "LLM, RAG, 모델 학습, 평가" },
  { id: "meta", name: "스킬·MCP 제작", desc: "스킬, 서브에이전트, MCP, 프롬프트" },
  { id: "workflow", name: "계획·작업 관리", desc: "계획, 브레인스토밍, git, 메모" },
  { id: "automation", name: "자동화·연동", desc: "브라우저 조작, 크롤링, 메신저·메일 연동" },
  { id: "docs", name: "오피스 문서", desc: "PDF, 엑셀, 워드, PPT, 노션" },
  { id: "writing", name: "글쓰기·번역", desc: "블로그, 번역, 교정, 스토리" },
  { id: "media", name: "이미지·영상", desc: "이미지 생성, 영상 편집, 음성, 게임" },
  { id: "marketing", name: "마케팅·세일즈", desc: "SEO, 광고, SNS, 고객 관리" },
  { id: "product", name: "기획·전략", desc: "PM, 전략, 회의, 채용, 커리어" },
  { id: "research", name: "연구·논문", desc: "논문, 문헌 조사, 통계, 실험" },
  { id: "finance", name: "금융·투자", desc: "주식, 회계, 세금, 크립토" },
  { id: "legal", name: "법률·계약", desc: "계약서, 컴플라이언스, 개인정보" },
  { id: "medical", name: "의료·바이오", desc: "임상, 유전체, 화학, 헬스케어" },
  { id: "security", name: "보안", desc: "취약점 분석, 침투 테스트, 위협 대응" },
  { id: "etc", name: "기타", desc: "분류되지 않은 스킬" },
];

export function categorize(name, description, path = "", repoDesc = "") {
  // 이름과 경로는 설명보다 강한 신호
  const strong = `${name} ${path.split("/").slice(-2).join(" ")}`.toLowerCase().replace(/[-_/]+/g, " ");
  const text = String(description).toLowerCase();
  let best = "etc", bestScore = 0;
  for (const [id, weight, re] of RULES) {
    const a = (strong.match(re) || []).length;
    const b = (text.match(re) || []).length;
    const score = (a * 3 + b) * weight;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
