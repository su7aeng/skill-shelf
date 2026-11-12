// 검색엔진·AI 검색용 산출물: 스킬별 정적 페이지, sitemap.xml, robots.txt, llms.txt, 홈 메타/JSON-LD
// build.mjs 가 호출한다. 앱은 해시 라우팅이라 크롤러가 스킬마다 다른 주소로 볼 수 없어서 따로 만든다.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
const cut = (t, n) => { t = String(t ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const MAX_PAGES = 10000;

export async function writeSeo({ DIST, site, skills, repos, categories, agents }) {
  const base = (site.url || "").replace(/\/$/, "");
  const abs = (p) => (base ? base + p : p);
  const catName = Object.fromEntries((categories || []).map((c) => [c.id, c.name]));
  const title = site.title;

  // 색인할 스킬: 한국어 사용법이 있는 스킬 전부
  const pages = [];
  // 한국어 사용법이 없는 스킬은 영어 한 문단뿐이라 색인 대상에서 뺀다
  const seenName = new Set();
  for (const s of [...skills].sort((a, b) => (repos[b.repo].stars ?? 0) - (repos[a.repo].stars ?? 0))) {
    if (pages.length >= MAX_PAGES) break;
    if (!s.ko || s.safety?.level === "high") continue;
    const key = s.repo + "/" + s.name;
    if (seenName.has(key)) continue;
    seenName.add(key);
    pages.push(s);
  }
  const byRepo = {}, byCat = {};
  for (const s of pages) { (byRepo[s.repo] ||= []).push(s); (byCat[s.category] ||= []).push(s); }
  const near = (list, s, n) => { const i = list.indexOf(s); const out = []; for (let k = 1; k < list.length && out.length < n; k++) out.push(list[(i + k) % list.length]); return out; };
  const li = (x) => `<li><a href="/s/${esc(x.id)}/">${esc(x.name)}</a> · ${esc(cut(x.ko?.description || x.description, 60))}</li>`;

  for (const s of pages) {
    const r = repos[s.repo];
    const ko = s.ko;
    const desc = cut(ko?.description || s.description, 155);
    const skillArg = ((name) => (/^[\w.-]+$/.test(name) ? name : "'" + name.replace(/'/g, "'\\''") + "'"))(s.skillName || s.name);
    const cmd = `npx skills add ${r.full} --skill ${skillArg}`;
    const notes = [].concat(ko?.notes || []).map((x) => String(x).trim()).filter(Boolean);
    const url = abs(`/s/${s.id}/`);
    const app = `/#/s/${encodeURIComponent(s.id)}`;
    const ld = {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: s.name,
      description: ko?.description || s.description,
      codeRepository: `https://github.com/${r.full}`,
      programmingLanguage: "Markdown",
      ...(r.license ? { license: r.license } : {}),
      ...(r.pushed ? { dateModified: r.pushed } : {}),
      inLanguage: ko ? "ko" : "en",
      keywords: [catName[s.category], ...(s.tags || [])].filter(Boolean).join(", "),
      ...(base ? { url } : {}),
    };
    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.name)} 스킬 설치와 사용법 (${esc(r.full)}) · ${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${base ? `<link rel="canonical" href="${esc(url)}">\n` : ""}<meta property="og:type" content="article">
<meta property="og:title" content="${esc(s.name)} · ${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${base ? `<meta property="og:url" content="${esc(url)}">\n` : ""}<meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top"><div class="wrap top-inner"><a class="brand" href="/">${esc(title)}</a></div></header>
<main class="wrap"><article class="detail">
<p class="crumbs"><a href="/">${esc(title)}</a> · <a href="/c/${esc(s.category)}/">${esc(catName[s.category] || s.category)}</a></p>
<h1>${esc(s.name)}</h1>
<p class="lead">${esc(ko?.description || s.description)}</p>
<p class="muted">${esc(r.full)}${r.stars != null ? ` · 스타 ${r.stars.toLocaleString("en-US")}` : ""}${s.safety ? ` · 안전 검사 ${s.safety.level === "ok" ? "통과" : "주의"}` : ""}</p>
<h2>설치</h2>
<div class="cmd"><pre><code>${esc(cmd)}</code></pre></div>
${ko?.summary ? `<h2>이런 스킬이에요</h2><p>${esc(ko.summary)}</p>` : ""}
${ko?.when ? `<h2>이럴 때 쓰세요</h2><ul>${[].concat(ko.when).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${ko?.examples?.length ? `<h2>요청 예시</h2><ul>${ko.examples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${notes.length ? `<h2>알아둘 점</h2><ul>${notes.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${byRepo[s.repo].length > 1 ? `<h2>같은 저장소의 스킬</h2><ul>${near(byRepo[s.repo], s, 5).map(li).join("")}</ul>` : ""}
${byCat[s.category].length > 1 ? `<h2>${esc(catName[s.category] || s.category)} 스킬 더 보기</h2><ul>${near(byCat[s.category].filter((x) => x === s || x.repo !== s.repo), s, 5).map(li).join("")}</ul>` : ""}
<p><a href="${app}">후기와 안전 검사 자세히 보기</a> · <a href="https://github.com/${esc(r.full)}/tree/${esc(r.branch || "main")}/${esc(s.path || "")}" rel="noopener">GitHub 원문</a></p>
</article></main>
</body></html>`;
    const dir = join(DIST, "s", s.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html);
  }

  // 카테고리 목록 페이지
  const cats = (categories || []).filter((c) => byCat[c.id]?.length);
  for (const c of cats) {
    const list = byCat[c.id];
    const url = abs(`/c/${c.id}/`);
    const desc = cut(`${c.name} 분야 AI 에이전트 스킬 ${list.length}개. 안전 검사 결과와 한국어 사용법, 설치 명령을 함께 볼 수 있어요.`, 155);
    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.name)} AI 에이전트 스킬 ${list.length}개 · ${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${base ? `<link rel="canonical" href="${esc(url)}">\n` : ""}<meta property="og:type" content="website">
<meta property="og:title" content="${esc(c.name)} 스킬 · ${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top"><div class="wrap top-inner"><a class="brand" href="/">${esc(title)}</a></div></header>
<main class="wrap"><article class="detail">
<p class="crumbs"><a href="/">${esc(title)}</a></p>
<h1>${esc(c.name)} 스킬</h1>
<p class="lead">${esc(desc)}</p>
<ul>${list.map(li).join("")}</ul>
<p><a href="/#/?c=${esc(c.id)}">전체 목록에서 검색하고 걸러 보기</a></p>
</article></main>
</body></html>`;
    const dir = join(DIST, "c", c.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html);
  }

  // sitemap.xml
  if (base) {
    const now = new Date().toISOString().slice(0, 10);
    const urls = [`<url><loc>${base}/</loc><lastmod>${now}</lastmod></url>`, ...cats.map((c) => `<url><loc>${esc(abs(`/c/${c.id}/`))}</loc><lastmod>${now}</lastmod></url>`), ...pages.map((s) => `<url><loc>${esc(abs(`/s/${s.id}/`))}</loc><lastmod>${repos[s.repo].pushed || now}</lastmod></url>`)];
    await writeFile(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
  }

  // robots.txt: 검색·AI 크롤러 모두 허용
  const bots = ["Googlebot", "Bingbot", "Yeti", "Daumoa", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"];
  await writeFile(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\n${bots.map((b) => `User-agent: ${b}\nAllow: /\n`).join("\n")}\n${base ? `Sitemap: ${base}/sitemap.xml\n` : ""}`);

  // llms.txt: AI가 사이트를 요약해서 읽는 파일
  const top = [...pages].sort((a, b) => (repos[b.repo].stars ?? 0) - (repos[a.repo].stars ?? 0)).slice(0, 40);
  await writeFile(join(DIST, "llms.txt"), `# ${title}

> ${site.tagline}. GitHub에 흩어진 AI 에이전트 스킬(SKILL.md)을 용도별로 모으고, 설치 전에 안전 검사 결과와 한국어 사용법을 보여주는 한국어 사이트입니다.

## 주요 스킬
${top.map((s) => `- [${s.name}](${abs(`/s/${s.id}/`)}): ${cut(s.ko?.description || s.description, 90)}`).join("\n")}

## 기타
- [새 스킬 RSS](${abs("/feed.xml")})
${base ? `- [사이트맵](${base}/sitemap.xml)\n` : ""}`);

  // 홈: 메타·JSON-LD·크롤러용 링크 목록
  const p = join(DIST, "index.html");
  let h = await readFile(p, "utf8");
  const ld = { "@context": "https://schema.org", "@type": "WebSite", name: title, description: site.tagline, inLanguage: "ko", ...(base ? { url: base + "/" } : {}) };
  const head = `${base ? `<link rel="canonical" href="${base}/">\n  <meta property="og:url" content="${base}/">\n` : ""}  <meta property="og:type" content="website">
  <meta property="og:locale" content="ko_KR">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
`;
  h = h.replace("</head>", head + "</head>");
  const links = `<nav class="wrap cat-links" aria-label="분야별 스킬">${cats.map((c) => `<a href="/c/${esc(c.id)}/">${esc(c.name)}</a>`).join("")}</nav>\n  `;
  h = h.replace('<h1 id="tagline"></h1>', `<h1 id="tagline">${esc(site.tagline)}</h1>`);
  h = h.replace('<footer class="wrap foot">', links + '<footer class="wrap foot">');
  await writeFile(p, h);
  return pages.length;
}
