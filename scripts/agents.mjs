// 스킬이 어떤 에이전트를 염두에 두고 만들어졌는지 저장소/경로/설명의 신호로 추정한다.
// SKILL.md 는 공통 형식(Agent Skills)이라 대부분 다른 에이전트에서도 동작하지만,
// 여기서 표시하는 건 "제작자가 그 에이전트를 언급했거나 그 에이전트 폴더 구조를 쓴 흔적이 있는 것"이다.
// id 는 data/agents.json 과 같아야 한다.
const SIGNALS = {
  "claude-code": [/(^|\/)\.claude\//, /\bclaude[- ]?code\b/i, /\bclaude\b/i, /\banthropic\b/i],
  "claude-apps": [/\bclaude\.ai\b/i, /\bclaude (desktop|app)\b/i],
  codex: [/(^|\/)\.codex\//, /\bcodex\b/i],
  copilot: [/(^|\/)\.github\/skills\//, /\bcopilot\b/i],
  cursor: [/(^|\/)\.cursor\//, /\bcursor\b/i],
  antigravity: [/(^|\/)\.gemini\//, /\bgemini[- ]cli\b/i, /\bantigravity\b/i, /\bgemini\b/i],
  opencode: [/(^|\/)\.opencode\//, /\bopencode\b/i],
  openclaw: [/\bopenclaw\b/i, /\bclawhub\b/i, /\bclawdbot\b/i, /\bmoltbot\b/i],
  amp: [/\bampcode\b/i, /\bamp\s+(cli|agent|code)\b/i],
  goose: [/(^|\/)\.goose\//, /\bgoose\b/i],
  devin: [/(^|\/)\.(windsurf|devin)\//, /\bwindsurf\b/i, /\bdevin\b/i],
  kiro: [/(^|\/)\.kiro\//, /\bkiro\b/i],
  cline: [/(^|\/)\.(cline|clinerules)\//, /\bcline\b/i],
  roo: [/(^|\/)\.roo\//, /\broo[- ]?code\b/i],
  factory: [/(^|\/)\.factory\//, /\bfactory droid\b/i, /\bdroids?\b.*\bfactory\b/i],
};
// .agents/skills 는 여러 에이전트가 함께 읽는 공통 경로
const SHARED_PATH = /(^|\/)\.agents?\/skills\//;
const SHARED_READERS = ["codex", "copilot", "cursor", "opencode", "amp", "goose"];

export function detectAgents(skill, repo) {
  const text = `${skill.path}\n${skill.name}\n${skill.description}\n${repo.full}\n${repo.desc || ""}`;
  const out = new Set();
  for (const [id, res] of Object.entries(SIGNALS)) if (res.some((re) => re.test(text))) out.add(id);
  if (SHARED_PATH.test(skill.path + "/")) SHARED_READERS.forEach((a) => out.add(a));
  if (repo.marketplace) out.add("claude-code");
  // 아무 신호가 없으면 가장 흔한 Claude Code 형식으로 본다
  if (!out.size) out.add("claude-code");
  return [...out];
}
