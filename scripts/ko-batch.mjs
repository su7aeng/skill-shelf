// 한국어 사용법을 쓸 대상 스킬을 고르고, 원문 SKILL.md 를 받아 배치 파일로 만든다.
//   node scripts/ko-batch.mjs <개수=300> <저장소당 최대=8> <배치 크기=30> <출력 폴더>
// 이미 data/ko/<id>.json 이 있는 스킬은 건너뛴다. 배치 파일을 보고 data/ko/<id>.json 을 작성하면 된다.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const [N = 300, PER_REPO = 8, BATCH = 30, OUT = join(ROOT, ".cache", "ko-batches")] = process.argv.slice(2);

const crawled = JSON.parse(await readFile(join(ROOT, "data", "crawled.json"), "utf8"));
const done = new Set((await readdir(join(ROOT, "data", "ko")).catch(() => [])).map((f) => f.replace(/\.json$/, "")));
const perRepo = {};
const picked = [];
for (const s of crawled.skills) {
  if (picked.length >= Number(N)) break;
  if (done.has(s.id)) continue;
  perRepo[s.repo] = (perRepo[s.repo] || 0) + 1;
  if (perRepo[s.repo] > Number(PER_REPO)) continue;
  picked.push(s);
}

async function body(s) {
  const r = crawled.repos[s.repo];
  const url = `https://raw.githubusercontent.com/${r.full}/${encodeURIComponent(r.branch)}/${s.path ? s.path.split("/").map(encodeURIComponent).join("/") + "/" : ""}SKILL.md`;
  try {
    const t = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).text();
    return t.slice(0, 7000);
  } catch { return ""; }
}

await mkdir(OUT, { recursive: true });
const items = [];
for (let i = 0; i < picked.length; i += 16) {
  items.push(...(await Promise.all(picked.slice(i, i + 16).map(async (s) => ({
    id: s.id, name: s.name, repo: crawled.repos[s.repo].full, description: s.description, skill_md: await body(s),
  })))));
}
let n = 0;
for (let i = 0; i < items.length; i += Number(BATCH)) {
  await writeFile(join(OUT, `batch-${String(++n).padStart(2, "0")}.json`), JSON.stringify(items.slice(i, i + Number(BATCH)), null, 1));
}
console.log(`✓ ${items.length}개 → ${n}개 배치 (${OUT})`);
