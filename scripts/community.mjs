// 사이트 저장소의 GitHub Discussions에서 스킬별 후기 수와 최근 글을 모아 data/community.json 에 저장한다.
//   node scripts/community.mjs
// site.json 의 github(owner/repo)가 비어 있으면 아무것도 하지 않는다. 토큰: GITHUB_TOKEN 또는 `gh auth token`.
// giscus는 스킬 상세 페이지마다 "제목 = 스킬 id"인 토론을 만들므로, 제목으로 스킬과 연결한다.
import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const site = JSON.parse(await readFile(join(ROOT, "site.json"), "utf8"));
if (!site.github) { console.log("site.json 의 github 이 비어 있어 건너뜀"); process.exit(0); }
const [owner, name] = site.github.split("/");
const token = process.env.GITHUB_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();

const QUERY = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    discussions(first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{ title url createdAt updatedAt upvoteCount category{name} author{login} comments(last:1){totalCount nodes{bodyText author{login}}} reactions{totalCount} bodyText }
    }
  }
}`;

const skills = {}, recent = [];
let after = null, pages = 0;
do {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "skill-shelf" },
    body: JSON.stringify({ query: QUERY, variables: { owner, name, after } }),
  });
  const j = await res.json();
  if (j.errors) { console.error(j.errors); process.exit(1); }
  const d = j.data.repository.discussions;
  for (const n of d.nodes) {
    const isSkillThread = n.category?.name === site.giscus?.category;
    if (isSkillThread) {
      skills[n.title] = { comments: n.comments.totalCount, reactions: n.reactions.totalCount, last: n.comments.nodes[0] ? { text: n.comments.nodes[0].bodyText.replace(/\s+/g, " ").slice(0, 80), by: n.comments.nodes[0].author?.login || "" } : null, url: n.url, updatedAt: n.updatedAt.slice(0, 10) };
    }
    if (recent.length < 30) {
      recent.push({
        title: n.title, url: n.url, category: n.category?.name, author: n.author?.login, updatedAt: n.updatedAt.slice(0, 10),
        comments: n.comments.totalCount, likes: n.reactions.totalCount + n.upvoteCount, skill: isSkillThread ? n.title : null, excerpt: (n.bodyText || "").slice(0, 140),
      });
    }
  }
  after = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
} while (after && ++pages < 20);

await writeFile(join(ROOT, "data", "community.json"), JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), skills, recent }, null, 1));
console.log(`✓ 스킬 토론 ${Object.keys(skills).length}개, 최근 글 ${recent.length}개 → data/community.json`);
