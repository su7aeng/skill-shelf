// 빌드 때 AI로 스킬마다 한국어 설명·검색 키워드·사용법을 만들어 data/ai/<id>.json 에 저장한다.
// Message Batches API(표준 가격의 50%)를 쓰고, 이미 만든 스킬은 건너뛴다.
//
//   node scripts/enrich.mjs --estimate              # 비용만 계산 (API 호출 없음)
//   node scripts/enrich.mjs --limit 100             # 인기순 100개만 실제로 생성
//   node scripts/enrich.mjs --only-new              # 아직 없는 것 전부 (매주 자동 수집 뒤에 쓰기 좋음)
//   node scripts/enrich.mjs --resume                # 중간에 끊겼을 때 제출해 둔 배치 결과 받기
//   옵션: --model claude-haiku-5-5 (기본) | claude-sonnet-5-5 | claude-opus-5-5
//
// 필요: ANTHROPIC_API_KEY (또는 ant auth login 프로필). 손으로 쓴 data/ko/<id>.json 이 있으면 화면에서는 그게 우선.
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "data", "ai");
const STATE = join(ROOT, ".cache", "enrich-state.json");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODEL = opt("--model", "claude-haiku-5-5");
const LIMIT = Number(opt("--limit", flag("--only-new") ? 100000 : 0));
// 1M 토큰당 달러 (일반 가격, 배치는 이 값의 50%). 대략 계산용.
const PRICE = { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20] };
const MAX_BODY = 6000; // SKILL.md 앞부분만 보낸다

const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["description_ko", "keywords_ko", "summary", "when", "examples", "notes"],
  properties: {
    description_ko: { type: "string", description: "목록 카드에 보일 한국어 설명. 무엇을 해 주는지 1~2문장, 90자 안팎" },
    keywords_ko: { type: "array", items: { type: "string" }, description: "한국 사용자가 검색할 만한 한국어 단어 5~12개 (예: 회의록, 엑셀, 버그 수정)" },
    summary: { type: "string", description: "상세 페이지 첫 문단. 이 스킬을 쓰면 무엇이 달라지는지 2~3문장" },
    when: { type: "array", items: { type: "string" }, description: "이럴 때 쓰세요: 구체적인 상황 2~4개" },
    examples: { type: "array", items: { type: "string" }, description: "설치 후 에이전트에게 그대로 말해 볼 수 있는 한국어 요청 2~3개" },
    notes: { type: "array", items: { type: "string" }, description: "필요한 도구·계정·주의점 0~3개. 없으면 빈 배열" },
  },
};
const SYSTEM = `당신은 AI 에이전트 스킬을 한국 개발자와 실무자에게 소개하는 편집자입니다. 주어진 SKILL.md를 읽고 한국어로 간결하게 정리하세요.
- 원문에 없는 기능을 지어내지 마세요. 모르면 짧게 쓰세요.
- 번역투를 피하고 자연스러운 존댓말(~해요)로 쓰세요. 제품명·명령어는 원문 그대로 둡니다.
- 예시 요청은 실제 사용자가 채팅창에 칠 법한 문장으로 쓰세요.`;

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };

async function skillBody(repo, s) {
  const local = join(ROOT, ".cache", "repos", repo.full.replace("/", "__"), s.path, "SKILL.md");
  try { return (await readFile(local, "utf8")).slice(0, MAX_BODY); } catch {}
  try {
    const url = `https://raw.githubusercontent.com/${repo.full}/${encodeURIComponent(repo.branch)}/${s.path ? s.path + "/" : ""}SKILL.md`;
    return (await (await fetch(url)).text()).slice(0, MAX_BODY);
  } catch { return ""; }
}

async function collect(client, state) {
  await mkdir(OUT, { recursive: true });
  let ok = 0, bad = 0;
  for (const b of state.batches) {
    let batch;
    while (true) {
      batch = await client.messages.batches.retrieve(b.id);
      if (batch.processing_status === "ended") break;
      console.log(`  ${b.id}: 처리 중 ${batch.request_counts.processing}, 완료 ${batch.request_counts.succeeded}`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
    for await (const r of await client.messages.batches.results(b.id)) {
      const id = b.map[r.custom_id];
      if (r.result.type !== "succeeded") { bad++; continue; }
      const msg = r.result.message;
      if (msg.stop_reason === "refusal") { bad++; continue; }
      const text = msg.content.find((c) => c.type === "text")?.text;
      try {
        const j = JSON.parse(text);
        j.model = MODEL;
        j.generatedAt = new Date().toISOString().slice(0, 10);
        await writeFile(join(OUT, `${id}.json`), JSON.stringify(j, null, 1));
        ok++;
      } catch { bad++; }
    }
  }
  console.log(`✓ 생성 ${ok}개, 실패 ${bad}개 → data/ai/ (실패한 것은 다음 실행 때 다시 시도)`);
}

async function main() {
  const client = flag("--estimate") ? null : new Anthropic();
  if (flag("--resume")) {
    const state = await readJson(STATE, null);
    if (!state) return console.log("이어 받을 배치가 없어요");
    await collect(client, state);
    return;
  }
  const crawled = await readJson(join(ROOT, "data", "crawled.json"));
  const done = new Set([
    ...(await readdir(OUT).catch(() => [])).map((f) => f.replace(/\.json$/, "")),
  ]);
  const todo = crawled.skills.filter((s) => !done.has(s.id)).slice(0, LIMIT || crawled.skills.length);
  if (!todo.length) return console.log("새로 만들 스킬이 없어요");

  const requests = [], map = {};
  let chars = 0;
  for (let i = 0; i < todo.length; i++) {
    const s = todo[i], repo = crawled.repos[s.repo];
    const body = await skillBody(repo, s);
    const content = `스킬: ${s.name}\n저장소: ${repo.full}\n설명: ${s.description}\n\nSKILL.md (앞부분):\n${body}`;
    chars += content.length + SYSTEM.length;
    const cid = `s${i}`;
    map[cid] = s.id;
    requests.push({ custom_id: cid, params: { model: MODEL, max_tokens: 1500, output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } }, system: SYSTEM, messages: [{ role: "user", content }] } });
  }
  // 영어/코드는 약 4자, 한국어는 약 1.5자당 1토큰. 섞여 있으니 3자당 1토큰으로 어림잡는다.
  const inTok = chars / 3, outTok = todo.length * 450;
  const [pi, po] = PRICE[MODEL] || [NaN, NaN];
  const cost = ((inTok * pi + outTok * po) / 1e6) * 0.5;
  console.log(`대상 ${todo.length}개 · 입력 약 ${(inTok / 1e6).toFixed(1)}M 토큰 · 출력 약 ${(outTok / 1e6).toFixed(1)}M 토큰`);
  console.log(`${MODEL} 배치 예상 비용: 약 $${cost.toFixed(2)} (어림값. 먼저 --limit 100 으로 실제 사용량을 확인하세요)`);
  if (flag("--estimate")) return;

  const state = { model: MODEL, batches: [] };
  for (let i = 0; i < requests.length; i += 10000) {
    const chunk = requests.slice(i, i + 10000);
    const batch = await client.messages.batches.create({ requests: chunk });
    const m = Object.fromEntries(chunk.map((r) => [r.custom_id, map[r.custom_id]]));
    state.batches.push({ id: batch.id, map: m });
    console.log(`  배치 제출 ${batch.id} (${chunk.length}개)`);
  }
  await mkdir(join(ROOT, ".cache"), { recursive: true });
  await writeFile(STATE, JSON.stringify(state));
  console.log("  결과 기다리는 중 (보통 1시간 안, 최대 24시간). 끊기면 --resume 으로 이어 받으세요.");
  await collect(client, state);
}

main().catch((e) => {
  if (e instanceof Anthropic.AuthenticationError) console.error("API 키가 없거나 잘못됐어요. ANTHROPIC_API_KEY 를 설정하세요.");
  else console.error(e);
  process.exit(1);
});
