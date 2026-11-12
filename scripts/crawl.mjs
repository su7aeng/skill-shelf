// GitHub에서 공개 스킬(SKILL.md)을 찾아 data/crawled.json, data/safety.json, data/history/<날짜>.json 을 만든다.
//   node scripts/crawl.mjs
// - 저장소 찾기만 GitHub 검색 API를 쓰고(토큰: GITHUB_TOKEN 또는 `gh auth token`),
//   파일은 git 부분 클론으로 받는다(API 한도 없음). 스킬 폴더의 텍스트 파일만 내려받는다.
// - 캐시: .cache/search.json, .cache/repos/<owner__repo>/ (git), 다시 실행하면 바뀐 저장소만 갱신.
import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { categorize } from "./categorize.mjs";
import { scanSkill } from "./safety.mjs";
import { isKorean } from "./korea.mjs";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const CACHE = join(ROOT, ".cache");
const REPOS = join(CACHE, "repos");
const MIN_STARS = Number(process.env.MIN_STARS || 100);
const MAX_SKILLS_PER_REPO = Number(process.env.MAX_SKILLS_PER_REPO || 500); // 넘으면 남의 스킬을 통째로 모은 미러로 보고 제외
const QUERIES = [
  "topic:agent-skills", "topic:claude-skills", "topic:claude-code-skills", "topic:skills topic:claude-code", "topic:codex-skills",
  "agent skills in:name,description", "claude skills in:name,description", "SKILL.md in:readme",
  "claude code skill in:description", "codex skills in:description",
];
// 한국 사용자용 스킬은 생태계가 작아서 스타 기준을 낮춰 따로 찾는다
const KR_QUERIES = ["skill hwp", "skills korean", "claude 한국어", "skill 한국", "SKILL.md 한국어 in:readme", "skill kakao", "skill naver", "claude code 스킬", "에이전트 스킬", "skill 공공데이터", "skill dart 공시", "skill hangul"];
const KR_MIN_STARS = 3;
const MIRROR_HINT = /awesome|registry|marketplace|collection|hub|list|curated|ordinary|tons-of/i;
const TEXT_EXT = ["md", "mdx", "txt", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "rb", "go", "rs", "php", "pl", "lua", "json", "yaml", "yml", "toml", "ini", "cfg", "html", "xml", "sql", "r", "swift", "kt", "java", "cs"];

const token = process.env.GITHUB_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "skill-shelf-crawler" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

async function search(q, page) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=100&page=${page}`, { headers: H }).catch(() => null);
    if (res?.ok) return res.json();
    if (res && (res.status === 403 || res.status === 429)) {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      await sleep(Math.max(5000, Math.min(reset - Date.now() + 1000, 70000)));
      continue;
    }
    if (res?.status === 422) return null;
    await sleep(2000);
  }
  return null;
}

async function pool(items, n, fn, label) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { await fn(items[k], k); } catch (e) { console.warn(`  ! ${items[k].full || k}: ${String(e.message).split("\n")[0]}`); }
      if (++done % 200 === 0) console.log(`  ${label} ${done}/${items.length}`);
    }
  }));
}

function parseFrontmatter(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (/^[>|][+-]?$/.test(v)) {
      const buf = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) buf.push(lines[++i].trim());
      v = buf.join(v.startsWith(">") ? " " : "\n").trim();
    } else if (v === "") {
      const buf = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
      v = buf.some((b) => b.startsWith("- ")) ? buf.map((b) => b.replace(/^-\s*/, "")) : buf.join(" ");
    } else if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      v = v.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1").replace(/\\"/g, '"');
    }
    out[k] = v;
  }
  return out;
}

const repoMeta = (it, kr = false) => ({
  full: it.full_name, stars: it.stargazers_count, branch: it.default_branch, desc: (it.description || "").slice(0, 300),
  license: it.license?.spdx_id || null, pushed: it.pushed_at?.slice(0, 10), created: it.created_at?.slice(0, 10), topics: it.topics || [], krQuery: kr,
});

async function findRepos() {
  const cached = await readJson(join(CACHE, "search.json"), null);
  if (cached && Date.now() - cached.at < 12 * 3600e3 && !process.argv.includes("--refresh")) {
    console.log(`1) 저장소 검색 (캐시 사용, ${cached.repos.length}개)`);
    return new Map(cached.repos.map((r) => [r.full, r]));
  }
  console.log("1) 저장소 검색");
  const repos = new Map();
  const runQ = async (q, minStars, kr) => {
    for (let page = 1; page <= 10; page++) {
      const r = await search(`${q} stars:>=${minStars}`, page);
      await sleep(2100); // search API: 분당 30회
      if (!r?.items?.length) break;
      for (const it of r.items) if (!it.fork && !it.archived && !repos.has(it.full_name)) repos.set(it.full_name, repoMeta(it, kr));
      if (r.items.length < 100) break;
    }
  };
  for (const q of QUERIES) await runQ(q, MIN_STARS, false);
  for (const q of KR_QUERIES) await runQ(q, KR_MIN_STARS, true);
  for (const full of await readJson(join(ROOT, "data", "extra-repos.json"), [])) {
    if (repos.has(full)) continue;
    const res = await fetch(`https://api.github.com/repos/${full}`, { headers: H }).catch(() => null);
    if (res?.ok) repos.set(full, repoMeta(await res.json()));
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(join(CACHE, "search.json"), JSON.stringify({ at: Date.now(), repos: [...repos.values()] }));
  console.log(`   후보 ${repos.size}개`);
  return repos;
}

const TEST_DIR = /(^|\/)(tests?|__tests__|__fixtures__|fixtures?|testdata|test-data|e2e|mocks?)\//i;

// git 부분 클론: 트리만 받고, 스킬 폴더의 텍스트 파일만 체크아웃
async function syncRepo(repo) {
  const dir = join(REPOS, repo.full.replace("/", "__"));
  const metaPath = dir + ".json";
  const meta = await readJson(metaPath, null);
  if (meta && meta.pushed === repo.pushed && meta.v === 2) return Object.assign(repo, meta);
  const git = (...a) => run("git", ["-C", dir, ...a], { maxBuffer: 256 << 20, timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (await exists(join(dir, ".git"))) {
    await git("fetch", "--depth", "1", "--filter=blob:none", "origin", repo.branch);
    await git("reset", "--soft", "FETCH_HEAD").catch(() => {});
  } else {
    await rm(dir, { recursive: true, force: true });
    await run("git", ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--single-branch", "--branch", repo.branch, `https://github.com/${repo.full}.git`, dir],
      { timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  }
  const { stdout } = await git("ls-tree", "-r", "--full-tree", "HEAD");
  const files = [];
  for (const line of stdout.split("\n")) {
    // -l(크기)를 쓰면 부분 클론에서 모든 파일을 내려받게 되므로 크기 없이 목록만 본다
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m) files.push({ sha: m[1], size: 0, path: m[2].replace(/^"|"$/g, "") });
  }
  // 테스트용 샘플 스킬(test/fixtures 폴더 등)은 실제로 쓰는 스킬이 아니므로 뺀다
  const skillPaths = files.filter((f) => /(^|\/)SKILL\.md$/.test(f.path) && !TEST_DIR.test(f.path));
  // 스킬 폴더별 파일 목록: 파일마다 상위 폴더를 거슬러 올라가며 스킬 폴더를 찾는다
  // (스킬 수 × 파일 수로 돌면 큰 저장소에서 몇 시간씩 멈춘다)
  const byDir = new Map();
  if (skillPaths.length <= MAX_SKILLS_PER_REPO) {
    for (const f of skillPaths) byDir.set(f.path.replace(/\/?SKILL\.md$/, ""), []);
    for (const x of files) {
      let d = x.path;
      while (true) {
        const cut = d.lastIndexOf("/");
        d = cut < 0 ? "" : d.slice(0, cut);
        const arr = byDir.get(d);
        if (arr) arr.push([d ? x.path.slice(d.length + 1) : x.path, x.size]);
        if (!d) break;
      }
    }
  }
  const data = {
    v: 2, pushed: repo.pushed,
    marketplace: files.some((f) => f.path === ".claude-plugin/marketplace.json"),
    skills: skillPaths.map((f) => {
      const d = f.path.replace(/\/?SKILL\.md$/, "");
      return { path: d, sha: f.sha, files: byDir.get(d) || [] };
    }),
  };
  if (data.skills.length && data.skills.length <= MAX_SKILLS_PER_REPO) {
    // 스킬 폴더 안의 텍스트 파일만 체크아웃 (1MB 넘는 파일은 제외)
    const want = new Set();
    for (const s of data.skills) {
      for (const [rel, size] of s.files) {
        const ext = rel.split(".").pop().toLowerCase();
        if ((TEXT_EXT.includes(ext) || !rel.includes("."))) want.add((s.path ? s.path + "/" : "") + rel);
      }
    }
    const list = [...want].slice(0, 4000);
    await git("config", "core.sparseCheckout", "true");
    await mkdir(join(dir, ".git", "info"), { recursive: true });
    // 한 번에 너무 많은 파일을 요청하면 GitHub가 400을 돌려주므로 400개씩 늘려 가며 받는다
    const esc = (p) => "/" + p.replace(/([*?[\]!#\\])/g, "\\$1");
    for (let i = 400; ; i += 400) {
      await writeFile(join(dir, ".git", "info", "sparse-checkout"), list.slice(0, i).map(esc).join("\n") + "\n");
      // GitHub가 동시 요청이 많으면 일시적으로 400을 주므로 몇 번 다시 시도
      for (let t = 0; ; t++) {
        try { await git("read-tree", "-mu", "HEAD"); break; }
        catch (e) { if (t >= 3) throw e; await sleep(3000 * (t + 1)); }
      }
      if (i >= list.length) break;
    }
  }
  await writeFile(metaPath, JSON.stringify(data));
  return Object.assign(repo, data);
}

async function main() {
  await mkdir(REPOS, { recursive: true });
  const repos = await findRepos();
  const excluded = new Set(await readJson(join(ROOT, "data", "excluded-repos.json"), []));
  for (const x of excluded) repos.delete(x);

  console.log("2) git 부분 클론 & 스킬 폴더 받기");
  const list = [...repos.values()];
  await pool(list, 8, syncRepo, "클론");
  const withSkills = list.filter((r) => r.skills?.length && r.skills.length <= MAX_SKILLS_PER_REPO);
  const tooMany = list.filter((r) => r.skills?.length > MAX_SKILLS_PER_REPO);
  console.log(`   스킬 있는 저장소 ${withSkills.length}개 (미러로 보고 제외 ${tooMany.length}개)`);

  console.log("3) 읽기, 안전 검사, 중복 제거, 분류");
  const candidates = [];
  for (const r of withSkills) {
    const base = join(REPOS, r.full.replace("/", "__"));
    for (const s of r.skills) {
      let text = "";
      try { text = await readFile(join(base, s.path, "SKILL.md"), "utf8"); } catch { continue; }
      const fm = parseFrontmatter(text);
      const description = typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim().slice(0, 1200) : "";
      if (description.length < 15) continue;
      const folder = s.path.split("/").pop() || r.full.split("/")[1];
      const name = (typeof fm.name === "string" && fm.name.trim()) || folder;
      if (/(^|\/)(templates?|examples?|test-?fixtures?|node_modules)(\/|$)/i.test(s.path) && /template|example|your-skill|my-skill/i.test(name)) continue;
      candidates.push({ r, s, base, name: name.slice(0, 120), description, text });
    }
  }
  const rank = (c) => [MIRROR_HINT.test(c.r.full) ? 1 : 0, c.r.skills.length > 150 ? 1 : 0, -c.r.stars];
  candidates.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });

  const seenSha = new Set(), seenKey = new Set(), ids = new Set();
  const repoIdx = new Map();
  const outRepos = [], outSkills = [], safety = {};
  for (const c of candidates) {
    const key = `${c.name.toLowerCase()}|${c.description.toLowerCase().slice(0, 160)}`;
    if (seenSha.has(c.s.sha) || seenKey.has(key)) continue;
    seenSha.add(c.s.sha); seenKey.add(key);
    if (!repoIdx.has(c.r.full)) {
      repoIdx.set(c.r.full, outRepos.length);
      outRepos.push({ full: c.r.full, stars: c.r.stars, branch: c.r.branch, desc: c.r.desc, license: c.r.license, pushed: c.r.pushed, created: c.r.created, marketplace: c.r.marketplace, total: c.r.skills.length });
    }
    let id = `${c.r.full.replace("/", "--")}--${c.s.path.split("/").pop() || "root"}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-");
    if (ids.has(id)) { let n = 2; while (ids.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    ids.add(id);
    const kr = isKorean(c.name, c.description, c.text, c.r);
    outSkills.push({ id, name: c.name, description: c.description, category: categorize(c.name, c.description, c.s.path, c.r.desc), repo: repoIdx.get(c.r.full), path: c.s.path, files: c.s.files.length, ...(kr ? { kr: true } : {}) });
    safety[id] = await scanSkill(join(c.base, c.s.path), c.s.files);
  }
  outSkills.sort((a, b) => outRepos[b.repo].stars - outRepos[a.repo].stars || a.name.localeCompare(b.name));

  const today = new Date().toISOString().slice(0, 10);
  await mkdir(join(ROOT, "data", "history"), { recursive: true });
  // 수집이 반쯤 실패했을 때 사이트가 비워지지 않게: 지난번의 90% 미만이면 저장하지 않고 멈춘다
  try {
    const prev = JSON.parse(await readFile(join(ROOT, "data", "crawled.json"), "utf8")).skills.length;
    if (outSkills.length < prev * 0.9) { console.error(`✗ 스킬 수가 ${prev} → ${outSkills.length}로 크게 줄어 저장하지 않아요`); process.exit(1); }
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  await writeFile(join(ROOT, "data", "crawled.json"), JSON.stringify({ generatedAt: today, repos: outRepos, skills: outSkills }));
  await writeFile(join(ROOT, "data", "safety.json"), JSON.stringify(safety));
  // 트렌딩 계산용 기록: 저장소 스타 수, 이날 목록에 있던 스킬 id
  await writeFile(join(ROOT, "data", "history", `${today}.json`), JSON.stringify({ stars: Object.fromEntries(outRepos.map((r) => [r.full, r.stars])), skills: outSkills.map((s) => s.id) }));

  const byCat = {}, bySafety = {};
  for (const s of outSkills) { byCat[s.category] = (byCat[s.category] || 0) + 1; bySafety[safety[s.id].level] = (bySafety[safety[s.id].level] || 0) + 1; }
  console.log(`✓ 스킬 ${outSkills.length}개, 저장소 ${outRepos.length}개, 한국 사용자용 ${outSkills.filter((s) => s.kr).length}개`);
  console.log("  카테고리", byCat);
  console.log("  안전", bySafety);
}

main().catch((e) => { console.error(e); process.exit(1); });
