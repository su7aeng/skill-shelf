// Vercel 서버 함수: 사용자의 하고 싶은 일 + 후보 스킬 목록을 받아 Claude가 골라 준다.
// 기본은 꺼져 있다(site.json features.aiRecommend=false). 켜려면:
//   1) site.json 의 features.aiRecommend 를 true 로
//   2) Vercel 환경변수 ANTHROPIC_API_KEY 등록
//   선택: RECOMMEND_MODEL(기본 claude-haiku-5-5), RECOMMEND_DAILY_LIMIT(기본 300), RECOMMEND_PER_IP_PER_MIN(기본 5)
// 후보 추리기는 브라우저에서 하므로(2만 개 전체를 보내지 않음) 요청 하나가 작다. Haiku 기준 1회 약 0.1센트.
import Anthropic from "@anthropic-ai/sdk";

const MAX_QUERY = 600;
const MAX_CANDIDATES = 60;
const MODEL = process.env.RECOMMEND_MODEL || "claude-haiku-5-5";
const DAILY_LIMIT = Number(process.env.RECOMMEND_DAILY_LIMIT || 300);
const PER_IP_PER_MIN = Number(process.env.RECOMMEND_PER_IP_PER_MIN || 5);
// 서버리스 인스턴스 메모리에 두는 간단한 제한이라 인스턴스가 여러 개면 느슨해진다.
// 트래픽이 커지면 Vercel 대시보드의 Spend Management/Firewall 규칙이나 KV 저장소로 옮길 것.
const usage = { day: "", count: 0, ips: new Map() };
function limited(ip) {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) { usage.day = day; usage.count = 0; usage.ips.clear(); }
  if (usage.count >= DAILY_LIMIT) return "오늘 AI 추천 한도를 다 썼어요. 내일 다시 시도해 주세요";
  const now = Date.now();
  const recent = (usage.ips.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= PER_IP_PER_MIN) return "잠시 뒤에 다시 시도해 주세요";
  recent.push(now);
  usage.ips.set(ip, recent);
  usage.count++;
  return null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "picks"],
  properties: {
    summary: { type: "string", description: "추천 전체를 한두 문장으로 정리한 한국어" },
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "why", "how"],
        properties: {
          id: { type: "string", description: "후보 목록에 있는 스킬 id 그대로" },
          why: { type: "string", description: "이 사람 상황에 왜 맞는지, 한국어 한 문장" },
          how: { type: "string", description: "설치 후 에이전트에게 이렇게 요청해 보라는 예시 문장, 한국어" },
        },
      },
    },
  },
};

const SYSTEM = `당신은 AI 에이전트 스킬 큐레이터입니다. 사용자가 하고 싶은 일과 (있다면) 프로젝트 기술 스택을 보고, 주어진 후보 스킬 중에서 실제로 도움이 될 것을 3~6개 고릅니다.
- 후보 목록에 있는 id만 쓰세요. 맞는 게 없으면 picks를 비우고 summary에 그렇게 말하세요.
- 같은 일을 하는 스킬을 여러 개 고르지 말고, 서로 보완되는 조합을 고르세요.
- 스타 수가 높고 안전 등급이 ok인 것을 우선하되, 상황에 더 맞는 것이 있으면 그것을 고르세요. 안전 등급이 high인 것은 고르지 마세요.
- 모든 설명은 자연스러운 한국어로, 짧게 쓰세요.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST만 지원해요" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "추천 API가 설정되지 않았어요" });

  const ip = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const { query, stack, candidates } = req.body || {};
  if (typeof query !== "string" || !query.trim()) return res.status(400).json({ error: "하고 싶은 일을 적어 주세요" });
  if (!Array.isArray(candidates) || !candidates.length) return res.status(400).json({ error: "후보가 없어요" });

  const why = limited(ip);
  if (why) return res.status(429).json({ error: why });

  const list = candidates.slice(0, MAX_CANDIDATES).map((c) => ({
    id: String(c.id).slice(0, 200),
    name: String(c.name).slice(0, 120),
    description: String(c.description).slice(0, 300),
    category: String(c.category || "").slice(0, 40),
    stars: Number(c.stars) || 0,
    safety: ["ok", "medium", "high", "unknown"].includes(c.safety) ? c.safety : "unknown",
  }));
  const ids = new Set(list.map((c) => c.id));

  const client = new Anthropic();
  try {
    // Opus/Sonnet/Fable 계열은 안전 분류기가 거절하면 서버에서 다른 모델로 다시 시도(fallbacks). Haiku는 지원하지 않음.
    const fallback = /^claude-(opus|sonnet|fable)-5/.test(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      ...fallback,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `하고 싶은 일:\n${query.slice(0, MAX_QUERY)}\n\n${stack ? `프로젝트 기술 스택: ${String(stack).slice(0, 300)}\n\n` : ""}후보 스킬(JSON):\n${JSON.stringify(list)}`,
      }],
    });
    if (response.stop_reason === "refusal") return res.status(422).json({ error: "이 요청에는 추천을 만들 수 없어요" });
    const text = response.content.find((b) => b.type === "text")?.text;
    const out = JSON.parse(text);
    out.picks = out.picks.filter((p) => ids.has(p.id)).slice(0, 6);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(out);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "잠시 뒤에 다시 시도해 주세요" });
    if (error instanceof SyntaxError) return res.status(502).json({ error: "추천 결과를 읽지 못했어요" });
    if (error instanceof Anthropic.APIError) return res.status(502).json({ error: `추천 서버 오류 (${error.status})` });
    return res.status(500).json({ error: "알 수 없는 오류" });
  }
}
