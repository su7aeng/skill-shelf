// 네트워크 없이 도는 빌드. (스킬 수집은 scripts/crawl.mjs 가 따로 한다)
//   data/crawled.json      수집 결과 (자동)
//   data/safety.json       안전 검사 결과 (자동)
//   data/history/*.json    날짜별 스타 기록 (자동, 트렌딩 계산용)
//   data/curated/*.json    손으로 고른 항목: 추천 표시, 한마디, 카테고리 수정, 목록에 없는 스킬 추가
//   data/ko/<id>.json      한국어 사용법 (사람이 쓴 것, 가장 우선)
//   data/ai/<id>.json      한국어 설명·키워드·사용법 (scripts/enrich.mjs 가 AI로 생성, 선택)
//   data/community.json    GitHub Discussions 후기 수, 최근 글 (scripts/community.mjs, 선택)
//   data/packs.json        스타터팩
//   data/agents.json       에이전트별 설치 경로
// → dist/s/<id>/ (검색용 정적 페이지), sitemap.xml, robots.txt, llms.txt
// → dist/index.json (목록용) + dist/d/<저장소번호>.json (상세용) + dist/feed.xml (RSS)
import { readdir, readFile, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { CATEGORIES } from "./scripts/categorize.mjs";
import { detectAgents } from "./scripts/agents.mjs";
import { writeSeo } from "./scripts/seo.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
const DATA = join(ROOT, "data");
const DIST = join(ROOT, "dist");
const DAY = 86400e3;

const readJson = async (p, d) => {
  try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { if (d !== undefined) return d; throw new Error(`${p}: ${e.message}`); }
};
async function readDir(dir) {
  const out = {};
  let files = [];
  try { files = await readdir(dir); } catch { return out; }
  for (const f of files) if (f.endsWith(".json") && !f.startsWith("_")) out[f.slice(0, -5)] = await readJson(join(dir, f));
  return out;
}
const normRepo = (r) => (String(r).match(/github\.com\/([^/]+\/[^/#?]+)/)?.[1] || r).replace(/\.git$/, "");
const xml = (s) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

async function main() {
  const site = await readJson(join(ROOT, "site.json"));
  const agents = await readJson(join(DATA, "agents.json"));
  const crawled = await readJson(join(DATA, "crawled.json"), { repos: [], skills: [], generatedAt: null });
  const safety = await readJson(join(DATA, "safety.json"), {});
  const curated = await readDir(join(DATA, "curated"));
  const ko = await readDir(join(DATA, "ko"));
  const ai = await readDir(join(DATA, "ai"));
  const community = await readJson(join(DATA, "community.json"), { skills: {}, recent: [] });
  const packs = await readJson(join(DATA, "packs.json"), []);
  const catIds = new Set(CATEGORIES.map((c) => c.id));

  const repos = crawled.repos.map((r) => ({ ...r }));
  const repoIndex = new Map(repos.map((r, i) => [r.full.toLowerCase(), i]));
  const skills = crawled.skills.map((s) => ({ ...s }));
  const byRepoPath = new Map(skills.map((s) => [`${repos[s.repo].full.toLowerCase()}:${s.path.toLowerCase()}`, s]));

  // 손으로 고른 항목 반영
  let errors = 0;
  for (const [file, c] of Object.entries(curated)) {
    const full = normRepo(c.repo || "");
    if (!full.includes("/")) { console.error(`✗ curated/${file}.json: repo 형식 오류`); errors++; continue; }
    if (c.category && !catIds.has(c.category)) { console.error(`✗ curated/${file}.json: 없는 카테고리 '${c.category}'`); errors++; continue; }
    const key = `${full.toLowerCase()}:${(c.path || "").toLowerCase()}`;
    let s = byRepoPath.get(key);
    if (!s) {
      if (!c.name || !c.description || !c.category) { console.error(`✗ curated/${file}.json: 수집 목록에 없는 스킬이면 name, description, category 필수`); errors++; continue; }
      let ri = repoIndex.get(full.toLowerCase());
      if (ri == null) { ri = repos.length; repos.push({ full, stars: null, branch: c.branch || "HEAD", desc: "", license: c.license || null, pushed: null, marketplace: false, total: 1 }); repoIndex.set(full.toLowerCase(), ri); }
      s = { id: file, name: c.name, description: c.description, category: c.category, repo: ri, path: c.path || "" };
      skills.push(s);
      byRepoPath.set(key, s);
    }
    // 화면 이름을 바꿔도 설치 명령에는 SKILL.md 의 원래 name 을 써야 한다
    if (c.name && c.name !== s.name && !s.skillName) s.skillName = s.name;
    for (const k of ["name", "description", "category", "note", "install", "tags"]) if (c[k]) s[k] = c[k];
    if (c.featured) s.featured = true;
    if (c.kr != null) s.kr = !!c.kr;
    if (c.agents) s.agentsOverride = c.agents;
  }
  if (errors) { console.error(`\n${errors}개 오류로 빌드 중단`); process.exit(1); }

  for (const s of skills) {
    s.agents = s.agentsOverride || detectAgents(s, repos[s.repo]);
    delete s.agentsOverride;
    // 사람이 쓴 사용법이 있으면 그것, 없으면 AI가 만든 것
    if (ko[s.id]) s.ko = ko[s.id];
    else if (ai[s.id]) s.ko = { ...ai[s.id], description: ai[s.id].description_ko, ai: true };
    if (safety[s.id]) s.safety = safety[s.id];
    const c = community.skills[s.id];
    if (c) s.reviews = c.comments || 0;
  }
  const unusedKo = Object.keys(ko).filter((id) => !skills.some((s) => s.id === id));
  if (unusedKo.length) console.warn(`! 연결 안 된 한국어 사용법 ${unusedKo.length}개: ${unusedKo.slice(0, 5).join(", ")}`);

  // 검증됨: 자동 안전 검사 통과 + 최근 90일 안에 관리됨 + (저장소 스타 200 이상 또는 커뮤니티 후기 3개 이상)
  const genDate = new Date(crawled.generatedAt || Date.now());
  for (const s of skills) {
    const r = repos[s.repo];
    const fresh90 = r.pushed && genDate - new Date(r.pushed) <= 90 * 86400e3;
    s.verified = s.safety?.level === "ok" && !!fresh90 && ((r.stars ?? 0) >= 200 || (s.reviews ?? 0) >= 3);
  }
  skills.sort((a, b) => (b.featured | 0) - (a.featured | 0) || (repos[b.repo].stars ?? -1) - (repos[a.repo].stars ?? -1) || a.name.localeCompare(b.name));
  const idSet = new Set(skills.map((s) => s.id));

  // ---- 트렌딩 / 새 스킬 ----
  const today = new Date(crawled.generatedAt || Date.now());
  const histFiles = (await readdir(join(DATA, "history")).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
  // 7일 이상 지난 기록 중 가장 최근 것과 비교
  const oldFile = histFiles.filter((f) => today - new Date(f.slice(0, 10)) >= 6 * DAY).pop();
  const old = oldFile ? await readJson(join(DATA, "history", oldFile)) : null;
  let trending, fresh, trendBasis;
  if (old) {
    const delta = new Map(repos.map((r) => [r.full, (r.stars ?? 0) - (old.stars[r.full] ?? r.stars ?? 0)]));
    trendBasis = `${oldFile.slice(0, 10)} 이후 늘어난 스타`;
    trending = pickPerRepo(skills.filter((s) => delta.get(repos[s.repo].full) > 0).sort((a, b) => delta.get(repos[b.repo].full) - delta.get(repos[a.repo].full)), 2, 24)
      .map((s) => [s.id, delta.get(repos[s.repo].full)]);
    const oldIds = new Set(old.skills);
    fresh = skills.filter((s) => !oldIds.has(s.id));
  } else {
    // 기록이 쌓이기 전: 최근 1년 안에 만들어진 저장소 중 하루 평균 스타가 많은 것
    trendBasis = "새 저장소의 하루 평균 스타";
    const vel = (r) => (r.created ? (r.stars ?? 0) / Math.max(7, (today - new Date(r.created)) / DAY) : 0);
    trending = pickPerRepo(skills.filter((s) => repos[s.repo].created && today - new Date(repos[s.repo].created) < 365 * DAY).sort((a, b) => vel(repos[b.repo]) - vel(repos[a.repo])), 2, 24)
      .map((s) => [s.id, Math.round(vel(repos[s.repo]))]);
    fresh = skills.filter((s) => repos[s.repo].created && today - new Date(repos[s.repo].created) < 30 * DAY);
  }
  fresh = pickPerRepo(fresh.sort((a, b) => (repos[b.repo].stars ?? 0) - (repos[a.repo].stars ?? 0)), 3, 60);
  // 최근에 업데이트된 검증 스킬
  // (거의 모든 인기 저장소가 매일 푸시되므로, 최근 2주 안에 업데이트된 것 중 인기순)
  const recentCut = new Date(genDate - 14 * 86400e3).toISOString().slice(0, 10);
  const verifiedRecent = pickPerRepo(skills.filter((s) => s.verified && (repos[s.repo].pushed || "") >= recentCut).sort((a, b) => (repos[b.repo].stars ?? 0) - (repos[a.repo].stars ?? 0)), 2, 48);
  // 이번 주 같이 써볼 스킬: 새 스킬/떠오르는 스킬 중 검사 통과한 것을 주 단위로 돌아가며
  const weekNo = Math.floor(genDate / (7 * 86400e3));
  // 같이 써 보려면 설명이 충분해야 하므로 한국어 사용법이 있는 검증 스킬을 먼저 돌린다
  const withKo = pickPerRepo([...fresh, ...trending.map(([id]) => skills.find((s) => s.id === id)), ...verifiedRecent, ...skills.filter((s) => s.verified)]
    .filter((s) => s && s.ko && s.safety?.level === "ok"), 1, 30);
  const pool = withKo.length ? withKo : [...fresh, ...trending.map(([id]) => skills.find((s) => s.id === id))].filter((s) => s && s.safety?.level === "ok");
  const weekly = pool.length ? pool[weekNo % pool.length].id : null;

  // ---- 스타터팩 검사 ----
  const outPacks = [];
  for (const p of packs) {
    const ok = p.skills.filter((id) => idSet.has(id));
    const missing = p.skills.filter((id) => !idSet.has(id));
    if (missing.length) console.warn(`! 스타터팩 '${p.id}': 없는 스킬 ${missing.join(", ")}`);
    if (ok.length) outPacks.push({ ...p, skills: ok });
  }

  await rm(DIST, { recursive: true, force: true });
  await cp(join(ROOT, "public"), DIST, { recursive: true });
  await mkdir(join(DIST, "d"), { recursive: true });

  const agentIds = agents.map((a) => a.id);
  const short = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
  const SAFE = { ok: 0, medium: 1, high: 2 };
  // 목록용 행: [id, 이름, 짧은 설명, 카테고리, 저장소번호, 에이전트비트, 플래그(1=추천,2=한국어사용법,4=한국사용자용,8=검증됨), 안전(0/1/2/-1=미검사), 한국어 키워드, 후기 수]
  const index = {
    site, generatedAt: crawled.generatedAt, builtAt: new Date().toISOString().slice(0, 10),
    categories: CATEGORIES, agents: agents.map(({ id, name, short }) => ({ id, name, short })),
    repos: repos.map((r) => [r.full, r.stars, r.pushed || ""]),
    skills: skills.map((s) => [
      s.id, s.name, short(s.ko?.description || s.description, 120), s.category, s.repo,
      s.agents.reduce((m, a) => m | (1 << agentIds.indexOf(a)), 0),
      (s.featured ? 1 : 0) | (s.ko ? 2 : 0) | (s.kr ? 4 : 0) | (s.verified ? 8 : 0),
      s.safety ? SAFE[s.safety.level] : -1,
      (s.ko?.keywords_ko || []).join(" "),
      s.reviews || 0,
    ]),
    trending: { basis: trendBasis, items: trending },
    fresh: fresh.map((s) => s.id),
    verifiedRecent: verifiedRecent.map((s) => s.id),
    weekly,
    reviewLast: Object.fromEntries(Object.entries(community.skills || {}).filter(([, v]) => v.last).map(([id, v]) => [id, v.last])),
    community: { recent: (community.recent || []).slice(0, 20), updatedAt: community.updatedAt || null },
    packs: outPacks,
  };
  await writeFile(join(DIST, "index.json"), JSON.stringify(index));

  // 상세용: 저장소 단위 파일
  const groups = new Map();
  for (const s of skills) { if (!groups.has(s.repo)) groups.set(s.repo, []); groups.get(s.repo).push(s); }
  for (const [ri, list] of groups) {
    await writeFile(join(DIST, "d", `${ri}.json`), JSON.stringify({ repo: repos[ri], skills: list.map(({ repo, ...rest }) => rest) }));
  }
  await writeFile(join(DIST, "agents.json"), JSON.stringify(agents));

  // RSS: 새로 들어온 스킬
  const base = (site.url || "").replace(/\/$/, "");
  const items = fresh.slice(0, 50).map((s) => `<item><title>${xml(s.name)} (${xml(repos[s.repo].full)})</title><link>${xml(`${base}/#/s/${encodeURIComponent(s.id)}`)}</link><guid isPermaLink="false">${xml(s.id)}</guid><description>${xml(s.ko?.description || s.description)}</description><category>${xml(CATEGORIES.find((c) => c.id === s.category)?.name)}</category></item>`).join("");
  await writeFile(join(DIST, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xml(site.title)} · 새 스킬</title><link>${xml(base || "/")}</link><description>${xml(site.tagline)}</description><language>ko</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`);

  const seoPages = await writeSeo({ DIST, site, skills, repos, categories: CATEGORIES, agents });
  if (!site.url) console.warn("! site.json 의 url 이 비어 있어 sitemap.xml 과 canonical 을 만들지 않았어요");
  const n = (f) => skills.filter(f).length;
  console.log(`✓ 스킬 ${skills.length}개 (검증됨 ${n((s) => s.verified)}, 한국어 사용법 ${n((s) => s.ko && !s.ko.ai)} + AI ${n((s) => s.ko?.ai)}, 한국 사용자용 ${n((s) => s.kr)}, 위험 ${n((s) => s.safety?.level === "high")}, 주의 ${n((s) => s.safety?.level === "medium")}), 저장소 ${groups.size}개, 트렌딩 ${trending.length}, 새 스킬 ${fresh.length}, 스타터팩 ${outPacks.length} → dist/`);
}

function pickPerRepo(list, per, max) {
  // 같은 이름의 스킬(포크·복사본)은 한 번만
  const cnt = {}, out = [], names = new Set();
  for (const s of list) {
    const nm = s.name.toLowerCase();
    if (names.has(nm) || (cnt[s.repo] || 0) >= per) continue;
    cnt[s.repo] = (cnt[s.repo] || 0) + 1; names.add(nm); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
