// 검색엔진·AI 검색용 산출물: 스킬별 정적 페이지, sitemap.xml, robots.txt, llms.txt, 홈 메타/JSON-LD
// build.mjs 가 호출한다. 앱은 해시 라우팅이라 크롤러가 스킬마다 다른 주소로 볼 수 없어서 따로 만든다.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const esc = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
const cut = (t, n) => { t = String(t ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };
const MAX_PAGES = 6000;

export async function writeSeo({ DIST, site, skills, repos, categories, agents }) {
  const base = (site.url || "").replace(/\/$/, "");
  const abs = (p) => (base ? base + p : p);
  const catName = Object.fromEntries((categories || []).map((c) => [c.id, c.name]));
  const title = site.title;

  // 색인할 스킬: 한국어 사용법이 있는 것 + 검증됨·인기 스킬 (저장소당 4개까지)
  const perRepo = {};
  const pages = [];
  const rank = (s) => (s.ko ? 1e9 : 0) + (repos[s.repo].stars ?? 0);
  for (const s of [...skills].sort((a, b) => rank(b) - rank(a))) {
    if (pages.length >= MAX_PAGES) break;
    if (s.safety?.level === "high") continue;
    if (!s.ko && !(s.verified && (repos[s.repo].stars ?? 0) >= 1000)) continue;
    if ((perRepo[s.repo] = (perRepo[s.repo] || 0) + 1) > 4) continue;
    pages.push(s);
  }

  for (const s of pages) {
    const r = repos[s.repo];
    const ko = s.ko;
    const desc = cut(ko?.description || s.description, 155);
    const skillArg = s.skillName || s.name;
    const cmd = `npx skills add ${r.full} --skill ${skillArg}`;
    const notes = (Array.isArray(ko?.notes) ? ko.notes.join(" ") : ko?.notes || "").trim();
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
<title>${esc(s.name)} 스킬 설치와 사용법 · ${esc(title)}</title>
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
<p class="crumbs"><a href="/">${esc(title)}</a> · <a href="/#/?c=${esc(s.category)}">${esc(catName[s.category] || s.category)}</a></p>
<h1>${esc(s.name)}</h1>
<p class="lead">${esc(ko?.description || s.description)}</p>
<p class="muted">${esc(r.full)}${r.stars != null ? ` · 스타 ${r.stars.toLocaleString("en-US")}` : ""}${s.safety ? ` · 안전 검사 ${s.safety.level === "ok" ? "통과" : "주의"}` : ""}</p>
<h2>설치</h2>
<pre><code>${esc(cmd)}</code></pre>
${ko?.summary ? `<h2>이런 스킬이에요</h2><p>${esc(ko.summary)}</p>` : ""}
${ko?.when ? `<h2>이럴 때 쓰세요</h2><p>${esc(Array.isArray(ko.when) ? ko.when.join(" ") : ko.when)}</p>` : ""}
${ko?.examples?.length ? `<h2>요청 예시</h2><ul>${ko.examples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
${notes ? `<h2>알아둘 점</h2><p>${esc(notes)}</p>` : ""}
<p><a href="${app}">후기와 안전 검사 자세히 보기</a> · <a href="https://github.com/${esc(r.full)}/tree/${esc(r.branch || "main")}/${esc(s.path || "")}" rel="noopener">GitHub 원문</a></p>
</article></main>
</body></html>`;
    const dir = join(DIST, "s", s.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), html);
  }

  // sitemap.xml
  if (base) {
    const now = new Date().toISOString().slice(0, 10);
    const urls = [`<url><loc>${base}/</loc><lastmod>${now}</lastmod></url>`, ...pages.map((s) => `<url><loc>${esc(abs(`/s/${s.id}/`))}</loc><lastmod>${repos[s.repo].pushed || now}</lastmod></url>`)];
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
  const links = `<noscript><nav aria-label="주요 스킬"><ul>${pages.slice(0, 120).map((s) => `<li><a href="/s/${esc(s.id)}/">${esc(s.name)}</a> ${esc(cut(s.ko?.description || s.description, 60))}</li>`).join("")}</ul></nav></noscript>\n  `;
  h = h.replace('<footer class="wrap foot">', links + '<footer class="wrap foot">');
  await writeFile(p, h);
  return pages.length;
}
