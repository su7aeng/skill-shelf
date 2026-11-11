import { buildQueryTerms, detectStack, readStackFromRepo, expandWord } from "./recommend.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 .9l2.2 4.6 5 .7-3.6 3.5.9 5L8 12.3l-4.5 2.4.9-5L.8 6.2l5-.7z"/></svg>';
const GH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 0z"/></svg>';
const PAGE = 48;
const SAFETY = [
  { key: "ok", label: "검사 통과", short: "검사 통과", cls: "safe-ok" },
  { key: "medium", label: "주의", short: "주의", cls: "safe-mid" },
  { key: "high", label: "위험", short: "위험", cls: "safe-high" },
];
const VIEWS = ["list", "detail", "guide", "recommend", "packs", "community"];

let D; // index.json
let SK = [];
let byId = new Map();
let catById = {};
let agentList = [];
const shardCache = new Map();
// 직무별 분류: 직무마다 관련 카테고리를 묶는다
const JOBS = [
  { id: "dev", name: "개발자", cats: ["dev", "testing", "devops", "security"] },
  { id: "design", name: "디자이너", cats: ["design", "media"] },
  { id: "marketing", name: "마케터", cats: ["marketing", "writing"] },
  { id: "pm", name: "기획자·PM", cats: ["product", "workflow"] },
  { id: "data", name: "데이터 분석가", cats: ["data"] },
  { id: "office", name: "사무·경영", cats: ["docs", "finance", "legal"] },
  { id: "research", name: "연구자", cats: ["research", "medical"] },
  { id: "builder", name: "AI·에이전트 개발자", cats: ["ai", "meta", "automation"] },
];
const jobById = Object.fromEntries(JOBS.map((j) => [j.id, j]));
// 만들 것별 분류: 결과물 키워드로 찾는다
const MAKES = [
  { id: "web", name: "웹사이트", terms: ["website", "landing page", "frontend", "web app", "웹사이트", "랜딩"] },
  { id: "app", name: "모바일 앱", terms: ["mobile", "ios", "android", "react native", "flutter", "swiftui"] },
  { id: "api", name: "API·서버", terms: ["api", "backend", "server", "endpoint", "database"] },
  { id: "doc", name: "문서·보고서", terms: ["docx", "pdf", "report", "document", "보고서", "문서"] },
  { id: "slides", name: "발표 자료", terms: ["pptx", "slides", "presentation", "deck", "발표"] },
  { id: "sheet", name: "엑셀·표", terms: ["xlsx", "excel", "spreadsheet", "csv", "엑셀"] },
  { id: "dashboard", name: "차트·대시보드", terms: ["dashboard", "chart", "visualization", "대시보드", "차트"] },
  { id: "media", name: "이미지·영상", terms: ["image", "video", "illustration", "thumbnail", "이미지", "영상"] },
  { id: "post", name: "글·블로그", terms: ["blog", "article", "newsletter", "copywriting", "블로그", "글쓰기"] },
  { id: "auto", name: "업무 자동화", terms: ["automation", "automate", "workflow", "n8n", "zapier", "자동화"] },
];
const SPINE_H = [188, 164, 200, 172, 156, 192, 180, 160, 196, 168];
const makeById = Object.fromEntries(MAKES.map((m) => [m.id, m]));
// 영어 키워드는 단어 단위로만 (api 가 rapid 에 걸리지 않게)
for (const m of MAKES) m.re = new RegExp(m.terms.map((t) => (/^[a-z]/.test(t) ? `\\b${t}\\b` : t)).join("|"));
const makeHit = (m, s) => m.re.test(s.hay);
const state = { job: "", make: "", q: "", cat: "all", agent: "all", ko: false, kr: false, safe: false, verified: false, set: "", sort: "stars", shown: PAGE };
let listScroll = 0;
let current = "list";

const fmtStars = (n) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---------- 데이터 ----------
async function load() {
  const [idx, agents] = await Promise.all([fetch("index.json").then((r) => r.json()), fetch("agents.json").then((r) => r.json())]);
  D = idx;
  agentList = agents;
  catById = Object.fromEntries(D.categories.map((c) => [c.id, c]));
  SK = D.skills.map(([id, name, desc, cat, repo, abits, flags, safety, kw, reviews], i) => {
    const [full, stars, pushed] = D.repos[repo];
    return {
      i, id, name, desc, cat, repo, full, stars, pushed: pushed || "", abits, safety,
      featured: !!(flags & 1), ko: !!(flags & 2), kr: !!(flags & 4), verified: !!(flags & 8), reviews: reviews || 0,
      hay: `${name} ${desc} ${full} ${kw || ""}`.toLowerCase(),
      nameLc: name.toLowerCase(),
    };
  });
  byId = new Map(SK.map((s) => [s.id, s]));
}
const agentsOf = (s) => D.agents.filter((_, k) => s.abits & (1 << k));
async function shard(repoIdx) {
  if (!shardCache.has(repoIdx)) shardCache.set(repoIdx, fetch(`d/${repoIdx}.json`).then((r) => r.json()));
  return shardCache.get(repoIdx);
}
const skillArg = (name, dir) => (/^[\w.-]+$/.test(name) ? name : dir || JSON.stringify(name));

// ---------- 카드 ----------
function safetyBadge(level, long = false) {
  if (level == null || level < 1) return "";
  const s = SAFETY[level];
  return `<span class="safe ${s.cls}" title="${esc(s.label)}">${esc(long ? s.label : s.short)}</span>`;
}
function card(s, showCat = true, extra = "") {
  const ags = agentsOf(s);
  return `<a class="card" href="#/s/${encodeURIComponent(s.id)}">
    <div class="card-top"><h3>${esc(s.name)}</h3>${s.stars != null ? `<span class="stars" title="GitHub 스타">${STAR}${fmtStars(s.stars)}</span>` : ""}</div>
    <div class="by">${esc(s.full)}${extra}</div>
    <p class="desc">${esc(s.desc)}</p>
    <div class="tags">
      ${s.verified ? `<span class="verified">검증됨</span>` : ""}
      ${safetyBadge(s.safety)}
      ${s.ko ? `<span class="ko-label">한국어 사용법</span>` : ""}
      ${s.reviews ? `<span class="tag">후기 ${s.reviews}</span>` : ""}
    </div>
    ${reviewLine(s)}
  </a>`;
}
function reviewLine(s) {
  const r = D.reviewLast?.[s.id];
  return r ? `<p class="review-line"><span>후기 ${s.reviews}</span>${esc(r.text)}${r.by ? ` <em>${esc(r.by)}</em>` : ""}</p>` : "";
}
function section(title, desc, items, showCat, extra = "", cardExtra) {
  return `<section class="group"><div class="group-head"><h2>${esc(title)}</h2>${extra}</div><div class="grid">${items.map((s) => card(s, showCat, cardExtra?.(s) || "")).join("")}</div></section>`;
}

// ---------- 목록 ----------
const SETS = {
  trending: { title: "떠오르는 스킬", desc: () => `기준: ${D.trending.basis}`, ids: () => D.trending.items.map(([id]) => id) },
  new: { title: "새 스킬", desc: () => "지난 수집 뒤 들어온 스킬", ids: () => D.fresh },
  verified: { title: "검증된 스킬", desc: () => "검증됨 · 2주 안에 업데이트", ids: () => D.verifiedRecent },
};
// 검색창 아래 추천 검색어 [보이는 글자, 실제 검색어]
const SUGGEST = [
  ["엑셀", "엑셀"], ["PDF", "pdf"], ["HWP", "hwp"], ["코드 리뷰", "리뷰"],
  ["디버깅", "디버깅"], ["프론트엔드", "프론트"], ["마케팅", "마케팅"], ["노션", "노션"],
];
// 인기순 점수. 지금은 GitHub 스타만 쓴다.
// 커뮤니티 후기가 쌓이면 REVIEW_WEIGHT 를 올려 후기 1개를 스타 몇 개만큼 칠지 정한다 (예: 500)
const REVIEW_WEIGHT = 0;
const popScore = (s) => (s.stars || 0) + s.reviews * REVIEW_WEIGHT;
function filtered(opts = {}) {
  const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // "엑셀"로 찾아도 영어 설명만 있는 excel 스킬이 나오도록 한국어 단어는 영어 키워드까지 넓혀 찾는다
  const groups = words.map(expandWord);
  const ak = state.agent === "all" ? -1 : D.agents.findIndex((a) => a.id === state.agent);
  const cat = opts.ignoreCat ? "all" : state.cat;
  const base = state.set && SETS[state.set] ? SETS[state.set].ids().map((id) => byId.get(id)).filter(Boolean) : SK;
  let out = base.filter((s) =>
    (cat === "all" || s.cat === cat) &&
    (!state.job || jobById[state.job]?.cats.includes(s.cat)) &&
    (!state.make || makeHit(makeById[state.make], s)) &&
    (ak < 0 || s.abits & (1 << ak)) &&
    (!state.ko || s.ko) && (!state.kr || s.kr) && (!state.safe || s.safety === 0) && (!state.verified || s.verified) &&
    groups.every((g) => g.some((t) => s.hay.includes(t))));
  if (state.sort === "name") out = [...out].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  else if (state.sort === "new") out = [...out].sort((a, b) => b.pushed.localeCompare(a.pushed) || a.i - b.i);
  else if (REVIEW_WEIGHT && !words.length) out = [...out].sort((a, b) => popScore(b) - popScore(a) || a.i - b.i);
  else if (words.length) {
    const q = words.join(" ");
    out = [...out].sort((a, b) => (b.nameLc.includes(q) - a.nameLc.includes(q)) || a.i - b.i);
  }
  return out;
}
function renderChips() {
  const base = filtered({ ignoreCat: true });
  const counts = {};
  for (const s of base) counts[s.cat] = (counts[s.cat] || 0) + 1;
  $("#quick").innerHTML = SUGGEST.map(([label, q]) => `<button type="button" data-suggest="${esc(q)}">${esc(label)}</button>`).join("");
  $("#cats").innerHTML = [{ id: "all", name: "전체" }, ...D.categories]
    .filter((c) => c.id === "all" || counts[c.id] || state.cat === c.id)
    .map((c) => `<button data-cat="${c.id}" aria-pressed="${state.cat === c.id}">${esc(c.name)}<span class="n">${(c.id === "all" ? base.length : counts[c.id] || 0).toLocaleString()}</span></button>`)
    .join("");
  $("#agents").innerHTML = `<span class="chips-label">에이전트</span>` + [{ id: "all", short: "전체" }, ...D.agents]
    .map((a) => `<button data-agent="${a.id}" aria-pressed="${state.agent === a.id}">${esc(a.short)}</button>`).join("");
}
function renderList() {
  renderChips();
  const hits = filtered();
  const el = $("#list");
  const plain = !state.job && !state.make && state.cat === "all" && !state.q.trim() && state.agent === "all" && !state.ko && !state.kr && !state.safe && !state.verified && !state.set && state.sort === "stars";
  $(".intro").hidden = !plain;
  const pick = [jobById[state.job]?.name, makeById[state.make]?.name].filter(Boolean);
  $("#set-head").innerHTML = pick.length ? `<div class="set-head"><h2>${esc(pick.join(" · "))}</h2>${state.job && !state.make ? `<span class="set-sub">결과물: ${MAKES.map((m) => `<a href="#/?job=${state.job}&make=${m.id}">${esc(m.name)}</a>`).join(" ")}</span>` : ""}<a href="#/">전체</a></div>` : state.set && SETS[state.set] ? `<div class="set-head"><h2>${esc(SETS[state.set].title)}</h2><a href="#/">전체</a></div>` : "";
  if (!hits.length) { el.innerHTML = `<div class="empty"><p>조건에 맞는 스킬이 없어요.</p><button data-reset>필터 초기화</button></div>`; return; }
  if (plain) { el.innerHTML = homeSections(); return; }
  const page = hits.slice(0, state.shown);
  const trendVal = state.set === "trending" ? new Map(D.trending.items) : null;
  el.innerHTML = `<p class="result-n">${hits.length.toLocaleString()}개</p><div class="grid">${page.map((s) => card(s, state.cat === "all", trendVal ? ` · <span class="up">+${trendVal.get(s.id).toLocaleString()}</span>` : "")).join("")}</div>` +
    (hits.length > page.length ? `<div class="more"><button data-more>더 보기 <span>${(hits.length - page.length).toLocaleString()}개 남음</span></button></div>` : "");
}
function homeSections() {
  const featured = SK.filter((s) => s.featured);
  const trend = D.trending.items.slice(0, 6).map(([id, v]) => [byId.get(id), v]).filter(([s]) => s);
  const fresh = D.fresh.slice(0, 6).map((id) => byId.get(id)).filter(Boolean);
  const verified = D.verifiedRecent.slice(0, 6).map((id) => byId.get(id)).filter(Boolean);
  const weekly = D.weekly && byId.get(D.weekly);
  const kr = SK.filter((s) => s.kr).slice(0, 6);
  return [
    `<section class="group"><div class="group-head"><h2>결과물로 찾기</h2></div><div class="jobs">${MAKES.map((m) => `<a class="job" href="#/?make=${m.id}">${esc(m.name)}<span class="job-n">${SK.filter((s) => makeHit(m, s)).length.toLocaleString()}</span></a>`).join("")}</div></section>`,
    `<section class="group"><div class="group-head"><h2>직무로 찾기</h2></div><div class="jobs">${JOBS.map((j) => `<a class="job" href="#/?job=${j.id}"><span>${esc(j.name)}</span><span class="job-n">${SK.filter((s) => j.cats.includes(s.cat)).length.toLocaleString()}개</span></a>`).join("")}</div></section>`,
    featured.length ? section("추천 스킬", "", featured, true) : "",
    verified.length ? section("검증된 스킬", "", verified, true, `<a class="more-link" href="#/?set=verified">모두 보기</a>`) : "",
    trend.length ? section("떠오르는 스킬", "", trend.map(([s]) => s), true, `<a class="more-link" href="#/?set=trending">모두 보기</a>`) : "",
    fresh.length ? section("새 스킬", "", fresh, true, `<a class="more-link" href="#/?set=new">모두 보기</a>`) : "",
    kr.length ? section("한국 사용자용", "", kr, true, `<a class="more-link" href="#/?kr=1">모두 보기</a>`) : "",
  ].join("");
}

// ---------- 스타터팩 ----------
function packCard(p) {
  return `<a class="pack" href="#/packs/${encodeURIComponent(p.id)}"><h3>${esc(p.title)}</h3><span class="pack-n">스킬 ${p.skills.length}개</span></a>`;
}
async function installAll(ids) {
  // 저장소별로 묶어 npx skills add 한 줄씩
  const byRepo = new Map();
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    const sh = await shard(s.repo);
    const full = sh.skills.find((x) => x.id === id);
    if (!byRepo.has(s.full)) byRepo.set(s.full, []);
    byRepo.get(s.full).push(skillArg(full.skillName || full.name, full.path.split("/").pop()));
  }
  return [...byRepo].map(([repo, names]) => `npx skills add ${repo} --skill ${names.join(" ")} -g -y`).join("\n");
}
async function renderPacks(id) {
  const view = $("#view-packs");
  if (!id) {
    view.innerHTML = `<p class="crumbs"><a href="#/">← 목록</a></p><article class="detail wide"><h1>스타터팩</h1><p class="lead">함께 쓰면 좋은 스킬 묶음이에요. 명령 한 줄로 모두 설치해요.</p><div class="packs">${D.packs.map(packCard).join("")}</div></article>`;
    document.title = `스타터팩 · ${D.site.title}`;
    return;
  }
  const p = D.packs.find((x) => x.id === id);
  if (!p) { view.innerHTML = `<div class="empty"><p>스타터팩을 찾을 수 없어요.</p><a href="#/packs">← 스타터팩</a></div>`; return; }
  const items = p.skills.map((sid) => byId.get(sid)).filter(Boolean);
  view.innerHTML = `<p class="crumbs"><a href="#/packs">← 스타터팩</a></p><article class="detail wide">
    <h1>${esc(p.title)}</h1><p class="lead">${esc(p.desc)}</p>
    <h3>한 번에 설치</h3><div class="cmd"><pre><code id="pack-cmd">만드는 중…</code></pre><button data-copy-from="#pack-cmd">복사</button></div>
    <p class="hint">설치된 에이전트를 찾아 모든 프로젝트에 설치해요. 에이전트를 고르려면 끝에 <code>-a claude-code</code>를 붙이세요.</p>
    ${p.tips?.length ? `<h3>요청 예시</h3><ul class="bullets">${p.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    <h3>포함된 스킬</h3><div class="grid">${items.map((s) => card(s, true)).join("")}</div></article>`;
  document.title = `${p.title} · ${D.site.title}`;
  window.scrollTo(0, 0);
  $("#pack-cmd").textContent = await installAll(p.skills);
}

// ---------- 상세 ----------
let marked, purify;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); }); }
async function mdLibs() {
  if (!marked) {
    await Promise.all([loadScript("https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"), loadScript("https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js")]);
    marked = window.marked; purify = window.DOMPurify;
  }
}
const ALL_AGENTS = {
  id: "all", name: "모든 에이전트", short: "모든 에이전트",
  install_note: "npx skills는 Vercel의 공용 설치 도구예요. Node.js가 필요해요. GitHub CLI로는 gh skill install을 써요.",
  invoke: "설치 후 에이전트를 다시 시작하세요.",
  docs: "https://skills.sh/docs/cli",
};
function installFor(agent, s, repo) {
  const dir = s.path.split("/").pop() || repo.full.split("/")[1];
  const src = s.path ? `${repo.full}/${s.path}` : repo.full;
  const arg = skillArg(s.skillName || s.name, dir);
  const fill = (t) => t.replaceAll("{repo}", repo.full).replaceAll("{skill}", arg).replaceAll("{path}", s.path || ".");
  if (agent.id === "all") return [
    { label: "모든 프로젝트", code: `npx skills add ${repo.full} --skill ${arg} -g` },
    { label: "이 프로젝트만", code: `npx skills add ${repo.full} --skill ${arg}` },
    { label: "GitHub CLI", code: `gh skill install ${repo.full} ${arg}` },
  ];
  const cmds = [];
  if (agent.id === "claude-code" && repo.marketplace) cmds.push({ label: "플러그인 마켓플레이스 · Claude Code 안에서 실행", code: `/plugin marketplace add ${repo.full}` });
  if (agent.installer) cmds.push({ label: "설치 명령", code: fill(agent.installer) });
  if (agent.user_path) cmds.push({ label: `직접 복사 · 모든 프로젝트`, code: `npx degit ${src} ${agent.user_path}/${dir}` });
  if (agent.project_path) cmds.push({ label: `직접 복사 · 이 프로젝트만`, code: `npx degit ${src} ${agent.project_path}/${dir}` });
  return cmds;
}
function safetySection(s, repo) {
  const sf = s.safety;
  if (!sf) return `<p class="muted">아직 검사하지 않았어요.</p>`;
  const blob = (w) => {
    const [file, line] = w.split(":");
    return `https://github.com/${repo.full}/blob/${encodeURIComponent(repo.branch)}/${s.path ? s.path + "/" : ""}${file.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;
  };
  const rows = (lvl) => Object.values(sf.hits).filter((h) => h.level === lvl);
  const list = (hs) => `<ul class="findings">${hs.map((h) => `<li><span>${esc(h.label)}</span><span class="where">${h.where.map((w) => `<a href="${esc(blob(w))}" target="_blank" rel="noopener">${esc(w)}</a>`).join(" ")}</span></li>`).join("")}</ul>`;
  const lv = SAFETY[{ ok: 0, medium: 1, high: 2 }[sf.level]];
  return `
    <div class="safety-head ${lv.cls}"><strong>${esc(lv.label)}</strong><span>파일 ${sf.files}개 중 ${sf.scanned}개 검사 · 스크립트 ${sf.scripts}개</span></div>
    ${rows("high").length ? `<h3>위험</h3>${list(rows("high"))}` : ""}
    ${rows("medium").length ? `<h3>주의</h3>${list(rows("medium"))}` : ""}
    ${rows("info").length ? `<h3>하는 일</h3>${list(rows("info"))}` : `<p class="hint">스크립트 없이 지시문만 있어요.</p>`}
    <p class="hint">실행하지 않고 텍스트 패턴만 본 결과라 틀릴 수 있어요. 위험 항목은 링크된 줄을 직접 확인하세요.</p>`;
}
async function renderDetail(id) {
  const s0 = byId.get(id);
  const view = $("#view-detail");
  if (!s0) { view.innerHTML = `<div class="empty"><p>스킬을 찾을 수 없어요.</p><a href="#/">← 목록</a></div>`; return; }
  view.innerHTML = `<p class="crumbs"><a href="#/">← 목록</a></p><div class="loading">불러오는 중…</div>`;
  const sh = await shard(s0.repo);
  if (location.hash !== `#/s/${encodeURIComponent(id)}`) return;
  const s = sh.skills.find((x) => x.id === id);
  const repo = sh.repo;
  const cat = catById[s.category];
  const myAgents = new Set(s.agents);
  myAgents.add("all");
  const ordered = [ALL_AGENTS, ...agentList.filter((a) => myAgents.has(a.id)), ...agentList.filter((a) => !myAgents.has(a.id))];
  const ko = s.ko;
  const rawBase = `https://raw.githubusercontent.com/${repo.full}/${encodeURIComponent(repo.branch)}/${s.path ? s.path + "/" : ""}`;
  const treeUrl = `https://github.com/${repo.full}/tree/${encodeURIComponent(repo.branch)}/${s.path}`;
  const others = sh.skills.filter((x) => x.id !== id).slice(0, 12);
  const sameCat = SK.filter((x) => x.cat === s0.cat && x.repo !== s0.repo).slice(0, 6);
  const realName = s.skillName || s.name;
  const slashName = /^[\w.-]+$/.test(realName) ? realName : s.path.split("/").pop() || realName;

  view.innerHTML = `
    <p class="crumbs"><a href="#/">← 목록</a> <span>/</span> <a href="#/?c=${cat.id}">${esc(cat.name)}</a></p>
    <article class="detail">
      <header class="d-head">
        <h1>${esc(s.name)}</h1>
        <p class="d-by"><a href="https://github.com/${esc(repo.full)}" target="_blank" rel="noopener">${esc(repo.full)}</a>${repo.stars != null ? ` · ${STAR} ${repo.stars.toLocaleString()}` : ""}${repo.license ? ` · ${esc(repo.license === "NOASSERTION" ? "라이선스 확인 필요" : repo.license)}` : ""}${repo.pushed ? ` · 업데이트 ${esc(repo.pushed)}` : ""}</p>
        <p class="d-desc">${esc(ko?.description || s.description)}</p>
        ${ko?.description ? `<details class="orig"><summary>원문 설명</summary><p>${esc(s.description)}</p></details>` : ""}
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ""}
        <div class="d-badges">${s0.verified ? `<span class="verified">검증됨</span>` : ""}${safetyBadge(s0.safety, true)}${s0.safety === 0 && !s0.verified ? `<span class="safe safe-ok">검사 통과</span>` : ""}${s.kr ? `<span class="kr-label">한국 사용자용</span>` : ""}<a class="more-link" href="#safety">안전 검사</a></div>
        <div class="d-agents">${s.agents.map((a) => { const ag = agentList.find((x) => x.id === a); return ag ? `<a class="agent-badge" href="#/?a=${a}">${esc(ag.name)}</a>` : ""; }).join("")}</div>
        <div class="actions"><a class="btn primary" href="${esc(treeUrl)}" target="_blank" rel="noopener">${GH}GitHub</a></div>
      </header>

      <section class="d-sec">
        <h2>${ko ? "한국어 사용법" : "설치"}</h2>
        ${ko ? `
          ${ko.ai ? `<p class="hint ai-note">AI 요약</p>` : ""}
          ${ko.summary ? `<p class="lead">${esc(ko.summary)}</p>` : ""}
          ${ko.when?.length ? `<h3>이럴 때</h3><ul class="bullets">${ko.when.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
          ${ko.examples?.length ? `<h3>요청 예시</h3><ul class="examples">${ko.examples.map((e) => `<li><span>${esc(e)}</span><button data-copy-text="${esc(e)}">복사</button></li>`).join("")}</ul>` : ""}
          ${ko.notes?.length ? `<h3>참고</h3><ul class="bullets">${ko.notes.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        ` : ""}
        ${ko ? `<h3>설치</h3>` : ""}
        <div class="cmd"><pre><code>${esc(installFor(ordered[0], s, repo)[0].code)}</code></pre><button data-copy-text="${esc(installFor(ordered[0], s, repo)[0].code)}">복사</button></div>
        <details class="by-agent"><summary>에이전트별 설치</summary>
        <div class="tabs" role="tablist">${ordered.map((a, k) => `<button role="tab" data-tab="${a.id}" aria-selected="${k === 0}">${esc(a.short)}</button>`).join("")}</div>
        ${ordered.map((a, k) => `<div class="tabpanel" data-panel="${a.id}" ${k === 0 ? "" : "hidden"}>
          ${installFor(a, s, repo).map((c) => `<p class="cmd-label">${esc(c.label)}</p><div class="cmd"><pre><code>${esc(c.code)}</code></pre><button data-copy-text="${esc(c.code)}">복사</button></div>`).join("")}
          ${a.slash ? `<p class="hint">직접 부르기 <code>${esc(a.slash.replace("{name}", slashName))}</code></p>` : ""}
        </div>`).join("")}
        </details>
      </section>

      <section class="d-sec" id="safety"><h2>안전 검사</h2>${safetySection(s, repo)}</section>

      <section class="d-sec">
        <h2>SKILL.md</h2>
        <div class="md" id="md"><p class="muted">불러오는 중…</p></div>
        <button class="md-toggle" id="md-toggle" hidden>펼치기</button>
      </section>

      <section class="d-sec" id="talk"><h2>후기</h2>${giscusBlock()}</section>

      ${others.length ? `<section class="d-sec"><h2>같은 저장소 <span class="muted">${(sh.skills.length - 1).toLocaleString()}개</span></h2><ul class="related">${others.map((r) => `<li><a href="#/s/${encodeURIComponent(r.id)}">${esc(r.name)}<span>${esc(catById[r.category]?.name)}</span></a></li>`).join("")}</ul>${sh.skills.length - 1 > others.length ? `<p><a class="more-link" href="#/?q=${encodeURIComponent(repo.full)}">모두 보기</a></p>` : ""}</section>` : ""}
      ${sameCat.length ? `<section class="d-sec"><h2>비슷한 스킬</h2><div class="grid">${sameCat.map((x) => card(x, false)).join("")}</div></section>` : ""}
    </article>`;
  document.title = `${s.name} · ${D.site.title}`;
  window.scrollTo(0, 0);
  const pref = lsGet("agent");
  if (pref) view.querySelector(`[data-tab="${CSS.escape(pref)}"]`)?.click();
  mountGiscus(id);

  try {
    await mdLibs();
    const res = await fetch(rawBase + "SKILL.md");
    if (!res.ok) throw new Error(res.status);
    const text = (await res.text()).replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    const md = $("#md");
    if (!md) return;
    md.innerHTML = purify.sanitize(marked.parse(text), { FORBID_TAGS: ["style", "form", "input"], FORBID_ATTR: ["style"] });
    for (const img of md.querySelectorAll("img[src]")) { const u = img.getAttribute("src"); if (!/^(https?:|data:)/.test(u)) img.src = new URL(u, rawBase).href; img.loading = "lazy"; }
    for (const a of md.querySelectorAll("a[href]")) { const u = a.getAttribute("href"); if (u.startsWith("#")) continue; if (!/^(https?:|mailto:)/.test(u)) a.href = new URL(u, treeUrl.replace(/\/?$/, "/")).href; a.target = "_blank"; a.rel = "noopener"; }
    if (md.scrollHeight > 900) { md.classList.add("clamped"); const t = $("#md-toggle"); t.hidden = false; t.onclick = () => { md.classList.toggle("clamped"); t.textContent = md.classList.contains("clamped") ? "펼치기" : "접기"; }; }
  } catch {
    const md = $("#md");
    if (md) md.innerHTML = `<p class="muted">SKILL.md를 불러오지 못했어요. <a href="${esc(treeUrl)}" target="_blank" rel="noopener">GitHub에서 보기</a></p>`;
  }
}

// ---------- 커뮤니티 (GitHub Discussions + giscus) ----------
const giscusReady = () => { const g = D.site.giscus || {}; return g.repo && g.repoId && g.categoryId; };
function giscusBlock() {
  if (!giscusReady()) return `<p class="muted">후기 기능을 준비하고 있어요.${D.site.github ? ` 지금은 <a href="https://github.com/${esc(D.site.github)}/discussions" target="_blank" rel="noopener">GitHub Discussions</a>에 남겨 주세요.` : ""}</p>`;
  return `<div id="giscus"></div>`;
}
function mountGiscus(term) {
  const box = $("#giscus");
  if (!box || !giscusReady()) return;
  const g = D.site.giscus;
  const sc = document.createElement("script");
  sc.src = "https://giscus.app/client.js";
  sc.async = true;
  sc.crossOrigin = "anonymous";
  Object.entries({
    repo: g.repo, "repo-id": g.repoId, category: g.category, "category-id": g.categoryId,
    mapping: "specific", term, strict: "1", "reactions-enabled": "1", "emit-metadata": "0",
    "input-position": "top", theme: "preferred_color_scheme", lang: "ko", loading: "lazy",
  }).forEach(([k, v]) => sc.setAttribute(`data-${k}`, v));
  box.replaceChildren(sc);
}
function renderCommunity() {
  const view = $("#view-community");
  const weekly = D.weekly && byId.get(D.weekly);
  const talked = SK.filter((s) => s.reviews).sort((a, b) => b.reviews - a.reviews).slice(0, 5);
  const recent = D.community?.recent || [];
  const TABS = [["all", "전체"], ["hot", "인기"], ["Skill reviews", "후기"], ["Q&A", "질문"], ["Ideas", "제안"]];
  const post = (r) => {
    const sk = r.skill && byId.get(r.skill);
    const who = r.author || "익명";
    const href = esc(r.url);
    return `<li class="post"><a class="post-link" href="${href}" ${r.url.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>
      <p class="post-head"><span class="avatar sm" data-c="${who.charCodeAt(0) % 6}">${esc(who[0].toUpperCase())}</span><b>${esc(who)}</b><span class="muted">${esc(r.updatedAt)}</span></p>
      <p class="post-text"><b>${esc(sk ? "후기" : r.title)}</b> ${esc(r.excerpt || "")}</p></a>
      <p class="post-foot">${sk ? `<a class="msg-skill" href="#/s/${encodeURIComponent(sk.id)}">${esc(sk.name)}${sk.stars != null ? ` <i>${STAR}${fmtStars(sk.stars)}</i>` : ""}</a>` : ""}<span>공감 ${r.likes || 0}</span><span>댓글 ${r.comments}</span></p></li>`;
  };
  view.innerHTML = `<p class="crumbs"><a href="#/">← 목록</a></p><div class="talk">
    <section class="talk-main">
      <h1>커뮤니티</h1>
      <div class="composer">${giscusReady() ? `<div id="giscus"></div>` : `<div class="composer-fake"><span class="avatar" data-c="0">나</span><span>스킬 써 본 이야기를 남겨 보세요</span></div>`}</div>
      <nav class="tabs" id="ctabs">${TABS.map(([k, n], i) => `<button data-t="${k}" aria-pressed="${i === 0}">${n}</button>`).join("")}</nav>
      <ul class="feed" id="cfeed"></ul>
    </section>
    <aside class="talk-side">
      ${weekly ? `<h2>이번 주 스킬</h2>${card(weekly, true)}` : ""}
      ${talked.length ? `<h2>이야기 많은 스킬</h2><ul class="related">${talked.map((s) => `<li><a href="#/s/${encodeURIComponent(s.id)}">${esc(s.name)}<span>후기 ${s.reviews}</span></a></li>`).join("")}</ul>` : ""}
    </aside>
  </div>`;
  const paint = (t) => {
    let list = recent;
    if (t === "hot") list = [...recent].sort((a, b) => (b.likes || 0) + b.comments - (a.likes || 0) - a.comments);
    else if (t !== "all") list = recent.filter((r) => r.category === t);
    $("#cfeed").innerHTML = list.length ? list.map(post).join("") : `<li class="muted post">아직 글이 없어요</li>`;
  };
  paint("all");
  $("#ctabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#ctabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    paint(b.dataset.t);
  });
  mountGiscus("community");
  document.title = `커뮤니티 · ${D.site.title}`;
  window.scrollTo(0, 0);
}

// ---------- 추천받기 ----------
function renderRecommend() {
  const view = $("#view-recommend");
  if (view.dataset.ready) { document.title = `추천받기 · ${D.site.title}`; return; }
  view.dataset.ready = "1";
  view.innerHTML = `<p class="crumbs"><a href="#/">← 목록</a></p><article class="detail wide">
    <h1>어떤 일을 하고 싶으세요?</h1>
    <p class="lead">평소 말투로 적으면 맞는 스킬을 골라 드려요.</p>
    <form id="rec-form" class="rec-form">
      <textarea id="rec-q" rows="3" maxlength="600" placeholder="예: Next.js 프로젝트에서 테스트랑 PR 리뷰를 자동화하고 싶어"></textarea>
      <div class="rec-examples">${["회의록 정리해서 노션에 올리고 싶어", "엑셀 매출 데이터로 보고서 만들고 싶어", "랜딩 페이지를 더 세련되게 바꾸고 싶어", "HWP 문서를 읽고 요약하고 싶어", "버그 원인을 체계적으로 찾고 싶어"].map((t) => `<button type="button" data-fill="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <details class="rec-stack"><summary>기술 스택 반영하기</summary>
        <p class="hint">GitHub 저장소 주소나 package.json, requirements.txt 같은 파일 내용을 넣으세요. 파일은 브라우저에서만 읽어요.</p>
        <textarea id="rec-stack" rows="4" placeholder="https://github.com/owner/repo 또는 package.json 내용"></textarea>
        <p class="hint" id="rec-stack-out"></p>
      </details>
      <button class="btn primary" type="submit">추천받기</button>
    </form>
    <div id="rec-out"></div>
  </article>`;
  document.title = `추천받기 · ${D.site.title}`;
  const out = $("#rec-out");
  view.addEventListener("click", (e) => { const b = e.target.closest("[data-fill]"); if (b) { $("#rec-q").value = b.dataset.fill; $("#rec-q").focus(); } });
  $("#rec-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#rec-q").value.trim();
    if (!q) return $("#rec-q").focus();
    const btn = e.submitter || $("#rec-form button[type=submit]");
    btn.disabled = true;
    out.innerHTML = `<p class="loading">찾는 중…</p>`;
    try {
      let stack = { names: [], terms: [] };
      const raw = $("#rec-stack").value.trim();
      if (raw) {
        stack = /github\.com\//.test(raw) ? await readStackFromRepo(raw) : detectStack(raw);
        $("#rec-stack-out").textContent = stack.names.length ? `찾은 기술: ${stack.names.join(", ")}` : "기술 스택을 찾지 못했어요.";
      }
      const terms = buildQueryTerms(q, stack.terms);
      const cands = candidates(terms, 60);
      let ai = null, err = null;
      if (D.site.features?.aiRecommend) try {
        const res = await fetch("api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          query: q, stack: stack.names.join(", "),
          candidates: cands.map((s) => ({ id: s.id, name: s.name, description: s.desc, category: catById[s.cat]?.name, stars: s.stars, safety: ["ok", "medium", "high"][s.safety] || "unknown" })),
        }) });
        if (res.ok) ai = await res.json(); else err = (await res.json().catch(() => ({}))).error || "AI 추천을 지금 쓸 수 없어요";
      } catch (x) { err = "AI 추천을 지금 쓸 수 없어요"; }
      const picks = ai?.picks?.length ? ai.picks.map((p) => ({ ...p, s: byId.get(p.id) })).filter((p) => p.s) : cands.slice(0, 6).map((s) => ({ s }));
      if (!picks.length) { out.innerHTML = `<div class="empty"><p>맞는 스킬이 없어요. 다르게 적어 보세요.</p></div>`; return; }
      out.innerHTML = `
        ${ai ? `<p class="lead rec-summary">${esc(ai.summary)}</p>` : err ? `<p class="hint">${esc(err)} · 키워드 검색 결과예요.</p>` : `<p class="hint">키워드가 겹치는 스킬이에요. 인기와 한국어 사용법도 반영했어요.</p>`}
        <h3>한 번에 설치</h3><div class="cmd"><pre><code id="rec-cmd">만드는 중…</code></pre><button data-copy-from="#rec-cmd">복사</button></div>
        <div class="rec-list">${picks.map((p) => `<div class="rec-item">${card(p.s, true)}${p.why ? `<p class="rec-why">${esc(p.why)}</p>` : ""}${p.how ? `<p class="rec-how"><span>요청 예시</span>${esc(p.how)}</p>` : ""}</div>`).join("")}</div>`;
      $("#rec-cmd").textContent = await installAll(picks.map((p) => p.s.id));
    } finally { btn.disabled = false; }
  });
}
function candidates(terms, n) {
  // 이름에 걸리면 3점, 설명에 걸리면 1점. 동점이면 스타. 위험 신호 있는 건 제외
  const scored = [];
  for (const s of SK) {
    if (s.safety === 2) continue;
    let sc = 0;
    for (const t of terms) { if (s.nameLc.includes(t)) sc += 3; else if (s.hay.includes(t)) sc += 1; }
    if (sc) scored.push([sc + Math.log10((s.stars || 1) + 1) * 0.4 + (s.ko ? 0.3 : 0), s]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const per = {}, out = [];
  for (const [, s] of scored) { if ((per[s.repo] = (per[s.repo] || 0) + 1) > 4) continue; out.push(s); if (out.length >= n) break; }
  return out;
}

// ---------- 처음이라면 ----------
function renderGuide() {
  $("#view-guide").innerHTML = `
    <p class="crumbs"><a href="#/">← 목록</a></p>
    <article class="detail guide">
      <h1>스킬이란</h1>
      <p class="lead">스킬은 AI에게 일하는 방법을 적어 둔 문서 폴더예요. 설치하면 AI가 해당 요청을 받을 때 그 방법대로 일해요.</p>
      <h2>쓰는 법</h2>
      <ol class="bullets">
        <li>목록에서 찾거나 <a href="#/recommend">추천받기</a>에 하고 싶은 일을 적어요.</li>
        <li>상세 페이지에서 설치 명령을 복사해 터미널에서 실행해요.</li>
        <li>에이전트를 다시 시작하고 평소처럼 요청해요. 요청 예시를 그대로 써도 돼요.</li>
      </ol>
      <h2>공통 설치 도구</h2>
      <p>에이전트마다 폴더가 달라도 <code>npx skills add 저장소 --skill 이름</code> 하나면 돼요. 설치된 에이전트를 찾아 알맞은 폴더에 설치해요. GitHub CLI로는 <code>gh skill install 저장소 이름</code>을 써요.</p>
      <h2>에이전트별 스킬 폴더</h2>
      <div class="table-wrap"><table class="agents-table"><thead><tr><th>에이전트</th><th>모든 프로젝트</th><th>이 프로젝트만</th><th>부르는 법</th></tr></thead><tbody>
        ${agentList.map((a) => `<tr><td><a href="#/?a=${a.id}">${esc(a.name)}</a>${a.docs ? ` <a class="doc" href="${esc(a.docs)}" target="_blank" rel="noopener">문서</a>` : ""}</td><td><code>${esc(a.user_path || "-")}</code></td><td><code>${esc(a.project_path || "-")}</code></td><td>${esc(a.invoke || "")}${a.install_note ? `<br><span class="muted">${esc(a.install_note)}</span>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <h2>안전 검사</h2>
      <p>스킬의 텍스트 파일을 실행하지 않고 훑어 위험 신호를 찾아요. 받은 스크립트를 바로 실행하거나, SSH 키에 접근하거나, 사용자 몰래 행동하라는 지시문 같은 것이에요. 상세 페이지에 근거 파일과 줄을 링크해요. 완벽하지 않으니 처음 쓰는 저장소는 설치 전에 훑어보세요.</p>
      <h2>새 스킬 알림</h2>
      <p>매주 GitHub를 다시 수집해요. <a href="feed.xml">RSS 피드</a>로 새 스킬을 받아 보세요.</p>
    </article>`;
  document.title = `가이드 · ${D.site.title}`;
  window.scrollTo(0, 0);
}

// ---------- 라우팅 ----------
function readParams() {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  state.job = jobById[p.get("job")] ? p.get("job") : "";
  state.make = makeById[p.get("make")] ? p.get("make") : "";
  state.cat = p.get("c") || "all";
  state.agent = p.get("a") || "all";
  state.q = p.get("q") || "";
  state.ko = p.get("ko") === "1";
  state.kr = p.get("kr") === "1";
  state.safe = p.get("safe") === "1";
  state.verified = p.get("v") === "1";
  state.set = p.get("set") || "";
  state.sort = p.get("sort") || "stars";
  state.shown = PAGE;
  $("#q").value = state.q;
  $("#ko-only").checked = state.ko;
  $("#kr-only").checked = state.kr;
  $("#safe-only").checked = state.safe;
  $("#verified-only").checked = state.verified;
  $("#sort").value = state.sort;
}
function writeParams() {
  const p = new URLSearchParams();
  if (state.job) p.set("job", state.job);
  if (state.make) p.set("make", state.make);
  if (state.set) p.set("set", state.set);
  if (state.cat !== "all") p.set("c", state.cat);
  if (state.agent !== "all") p.set("a", state.agent);
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.ko) p.set("ko", "1");
  if (state.kr) p.set("kr", "1");
  if (state.safe) p.set("safe", "1");
  if (state.verified) p.set("v", "1");
  if (state.sort !== "stars") p.set("sort", state.sort);
  const h = `#/${p.toString() ? "?" + p : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  if (current === "list" && view !== "list") listScroll = window.scrollY;
  for (const a of document.querySelectorAll(".top-links a[data-nav]")) a.toggleAttribute("aria-current", a.dataset.nav === view);
  current = view;
}
function route() {
  const h = location.hash || "#/";
  let m;
  if ((m = h.match(/^#\/s\/(.+)$/))) { show("detail"); renderDetail(decodeURIComponent(m[1])); return; }
  if (h.startsWith("#/guide")) { show("guide"); renderGuide(); return; }
  if (h.startsWith("#/recommend")) { show("recommend"); renderRecommend(); window.scrollTo(0, 0); return; }
  if ((m = h.match(/^#\/packs(?:\/(.+))?$/))) { show("packs"); renderPacks(m[1] && decodeURIComponent(m[1])); return; }
  if (h.startsWith("#/community")) { show("community"); renderCommunity(); return; }
  if (h === "#talk") { $("#talk")?.scrollIntoView({ behavior: "smooth" }); return; }
  if (h === "#safety") { $("#safety")?.scrollIntoView({ behavior: "smooth" }); return; }
  const wasList = current === "list";
  show("list");
  readParams();
  renderList();
  document.title = D.site.title;
  if (!wasList) requestAnimationFrame(() => window.scrollTo(0, listScroll));
}

// ---------- 이벤트 ----------
function bind() {
  let t;
  const update = () => { state.shown = PAGE; writeParams(); renderList(); };
  $("#q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; update(); }, 120); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); });
  $("#ko-only").addEventListener("change", (e) => { state.ko = e.target.checked; update(); });
  $("#kr-only").addEventListener("change", (e) => { state.kr = e.target.checked; update(); });
  $("#safe-only").addEventListener("change", (e) => { state.safe = e.target.checked; update(); });
  $("#verified-only").addEventListener("change", (e) => { state.verified = e.target.checked; update(); });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button, a");
    if (!b) return;
    if (b.tagName === "A" && /^#(safety|talk)$/.test(b.getAttribute("href"))) { e.preventDefault(); $(b.getAttribute("href"))?.scrollIntoView({ behavior: "smooth" }); return; }
    if (b.dataset.cat && b.closest("#cats")) { state.cat = b.dataset.cat; update(); }
    else if (b.dataset.agent) { state.agent = b.dataset.agent; update(); }
    else if (b.dataset.suggest != null) { $("#q").value = b.dataset.suggest; state.q = b.dataset.suggest; update(); }
    else if ("more" in b.dataset) { state.shown += PAGE * 2; renderList(); }
    else if ("reset" in b.dataset) { location.hash = "#/"; if (current === "list") route(); }
    else if (b.dataset.tab) {
      const box = b.closest(".d-sec");
      box.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
      box.querySelectorAll("[data-panel]").forEach((x) => (x.hidden = x.dataset.panel !== b.dataset.tab));
      if (e.isTrusted) lsSet("agent", b.dataset.tab);
    } else if (b.dataset.copyText != null || b.dataset.copyFrom) {
      const text = b.dataset.copyText ?? $(b.dataset.copyFrom)?.textContent ?? "";
      try { await navigator.clipboard.writeText(text); b.textContent = "복사됨"; } catch { b.textContent = "복사 실패"; }
      setTimeout(() => (b.textContent = "복사"), 1400);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && current === "list" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); $("#q").focus(); }
  });
  window.addEventListener("hashchange", route);
}

async function init() {
  await load();
  const { site } = D;
  $("#brand").textContent = site.title;
  $("#tagline").textContent = site.tagline;
  const repoCount = new Set(SK.map((s) => s.repo)).size;
  $("#summary").innerHTML = `엑셀, 발표 자료, 코드까지. 명령 한 줄로 Claude, Codex, Cursor 등 AI에 새 기술을 더해요. 설치 전에 안전 검사 결과도 볼 수 있어요.`;
  $("#foot").innerHTML = `${site.author ? `큐레이션 ${esc(site.author)} · ` : ""}수집 ${esc(D.generatedAt || "-")} · 매주 갱신 · <a href="feed.xml">RSS</a> · 스킬 저작권은 각 원작자에게 있어요.`;
  if (site.github && $("#suggest")) { const a = $("#suggest"); a.href = `https://github.com/${site.github}/issues/new?title=${encodeURIComponent("스킬 제안: ")}`; a.hidden = false; }
  { // 기여 그래프 장식: 스킬 수로 고정된 무늬
    let x = SK.length || 1; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    $(".intro-text").insertAdjacentHTML("beforeend", `<div class="contrib" aria-hidden="true">${Array.from({ length: 7 * 26 }, (_, k) => `<i data-l="${Math.floor(Math.pow(rnd(), 2.2) * 5)}" style="grid-area:${(k % 7) + 1}/${Math.floor(k / 7) + 1}"></i>`).join("")}</div>`);
  }
  renderPick();
  bind();
  route();
}
async function renderPick() {
  const w = D.weekly && byId.get(D.weekly);
  const el = $("#pick");
  if (!w) return;
  el.innerHTML = `<p class="pick-label">이번 주 스킬</p>
    <a class="pick-name" href="#/s/${encodeURIComponent(w.id)}">${esc(w.name)}</a>
    <p class="pick-by">${esc(w.full)}${w.stars != null ? ` · ${STAR}${fmtStars(w.stars)}` : ""}</p>
    <p class="pick-desc">${esc(w.desc)}</p>
    <div class="cmd pick-cmd"><pre><code id="pick-code">npx skills add ${esc(w.full)}</code></pre><button data-copy-text="">복사</button></div>
    <p class="pick-how">터미널에 붙여넣으면 설치돼요</p>`;
  el.hidden = false;
  try {
    const sh = await shard(w.repo);
    const full = sh.skills.find((x) => x.id === w.id);
    const code = `npx skills add ${w.full} --skill ${skillArg(full.skillName || full.name, full.path.split("/").pop())}`;
    $("#pick-code").textContent = code;
    el.querySelector("[data-copy-text]").dataset.copyText = code;
  } catch {}
}

init().catch((err) => { $("#list").innerHTML = `<div class="empty"><p>목록을 불러오지 못했어요.</p></div>`; console.error(err); });
