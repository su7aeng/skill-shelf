// 스킬 폴더를 정적으로 훑어 "이 스킬이 하는 일"과 위험 신호를 찾는다.
// 실행하지 않고 텍스트 패턴만 본다. 오탐/미탐이 있을 수 있으므로 화면에는 "자동 검사"라고 밝힌다.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// level: high = 위험 신호, medium = 주의해서 볼 것, info = 하는 일(정상 기능일 수 있음)
const RULES = [
  // 위험 신호
  { id: "pipe-shell", level: "high", label: "인터넷에서 받은 스크립트 바로 실행", re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(curl|wget)\b[^\n]{0,200}\|\s*python3?\b|iex\s*\(\s*(New-Object\s+Net\.WebClient|iwr|Invoke-WebRequest)/i },
  { id: "rm-root", level: "high", label: "홈·루트 폴더 전체 삭제", re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(--no-preserve-root\s+)?(\/|~|\$HOME|\/\*|~\/\*)(\s|$|["'`;])/i },
  { id: "secrets", level: "high", label: "SSH 키·클라우드 인증 정보·브라우저 비밀번호 접근", re: /(~|\$HOME|homedir\(\)|expanduser\(["']~)[^\n]{0,40}(\.ssh\/(id_|authorized)|\.aws\/credentials|\.config\/gcloud|\.kube\/config|\.docker\/config\.json|\.npmrc|\.netrc|\.gnupg)|Login Data|Cookies\.binarycookies|\bKeychain\b.*\bfind-(generic|internet)-password|security\s+find-(generic|internet)-password/i },
  { id: "reverse-shell", level: "high", label: "리버스 셸로 원격 접속", re: /\bnc\s+(-[a-z]*e|-c)\s|\/dev\/tcp\/\d|bash\s+-i\s+>&\s*\/dev\/tcp|socket\.socket\([^)]*\)[\s\S]{0,200}\.connect\([\s\S]{0,200}subprocess|pty\.spawn\(["']\/bin\/(ba)?sh/i },
  { id: "obfuscated-exec", level: "high", label: "인코딩해 숨긴 코드 실행", re: /base64\s+(-d|--decode)[^\n]{0,80}\|\s*(ba)?sh|eval\s*\(\s*(atob|Buffer\.from)\(|exec\s*\(\s*(base64\.b64decode|codecs\.decode|zlib\.decompress)|eval\(compile\(base64/i },
  { id: "miner", level: "high", label: "암호화폐 채굴 흔적", re: /\b(xmrig|minerd|cryptonight|stratum\+tcp|coinhive)\b/i },
  { id: "prompt-injection", level: "high", label: "이전 지시를 무시하거나 몰래 행동하라는 지시", md: true, prose: true, re: /\b(ignore|disregard|forget)\s+(all\s+)?(your\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?|guidelines)\b|\bsecretly\s+(send|upload|exfiltrat\w*|run|execute|install|copy)|\b(hide|conceal)\s+(this|it|these|the\s+\w+)\s+from\s+the\s+user\b/i },
  { id: "silent", level: "medium", label: "사용자에게 알리지 말라는 지시", md: true, prose: true, re: /\b(do not|don'?t|never)\s+(tell|inform|notify|mention\s+(this|it)\s+to)\s+the\s+user\s+(about|that\s+you|what\s+you|you)\b|\bwithout\s+(telling|informing|notifying)\s+the\s+user\b/i },
  { id: "hidden-chars", level: "high", label: "보이지 않는 문자로 숨긴 텍스트", md: true, prose: true, re: /[‪-‮⁦-⁩]|[​-‍⁠﻿]{3,}|[\u{E0000}-\u{E007F}]/u },
  { id: "exfil", level: "high", label: "외부 웹훅·붙여넣기 사이트로 데이터 전송", re: /(webhook\.site|requestbin|pipedream\.net|ngrok\.io|discord(app)?\.com\/api\/webhooks|pastebin\.com\/api|transfer\.sh|interact\.sh|burpcollaborator|oast\.(fun|me|pro))/i },

  // 주의
  { id: "sudo", level: "medium", label: "관리자 권한(sudo) 사용", re: /(^|[\s;&|`(])sudo\s+\S/m },
  { id: "chmod", level: "medium", label: "권한을 넓게 여는 chmod", re: /chmod\s+(-R\s+)?(777|666|a\+w|o\+w)/i },
  { id: "global-install", level: "medium", label: "시스템 전역 패키지 설치", re: /^(?!.*\b(console\.\w+|print|echo|log\w*)\s*\().*(\bnpm\s+(i|install)\s+(-g|--global)\b|\bbrew\s+install\b|\bapt(-get)?\s+install\b)/i, codeOnly: true },
  { id: "shell-rc", level: "medium", label: "셸 설정·자동 실행 등록 수정", re: />>?\s*(~|\$HOME)\/\.(bashrc|zshrc|profile|bash_profile|zprofile)|crontab\s+-|launchctl\s+load|systemctl\s+enable/i },
  { id: "binary", level: "medium", label: "실행 파일 포함", file: /\.(exe|dll|so|dylib|bin|jar|msi|dmg|pkg|deb|rpm|appimage|scr|com)$/i },
  { id: "dangerous-flags", level: "medium", label: "에이전트 권한 확인 끄기", re: /--dangerously-skip-permissions|--yolo\b|--dangerously-bypass-approvals|approval[_-]?policy\s*[:=]\s*["']?never/i },

  // 하는 일
  { id: "network", level: "info", label: "인터넷 접속", re: /\b(requests\.(get|post|put)|urllib\.request|httpx\.|aiohttp|fetch\(\s*["'`]https?:|axios\.|curl\s+-|wget\s+|http\.get\(|got\(|WebClient)/i },
  { id: "exec", level: "info", label: "셸 명령 실행", re: /\b(subprocess\.(run|Popen|call|check_output)|os\.system\(|child_process|execSync\(|spawnSync?\(|exec\.Command\(|Runtime\.getRuntime\(\)\.exec)/i, ext: /\.(py|js|mjs|cjs|ts|go|rb|java)$/i },
  { id: "script", level: "info", label: "셸 스크립트 포함", file: /\.(sh|bash|zsh|ps1|bat|cmd)$/i },
  { id: "delete", level: "info", label: "파일 삭제", re: /\b(shutil\.rmtree|os\.remove\(|os\.unlink\(|fs\.(rm|rmSync|unlink|unlinkSync)\(|rimraf|rm\s+-[a-z]*r)/i },
  { id: "env", level: "info", label: "환경 변수·API 키 읽기", re: /\b(os\.environ|os\.getenv\(|process\.env\.|getenv\(|dotenv|load_dotenv)\b|\b[A-Z][A-Z0-9_]*_(API_KEY|TOKEN|SECRET)\b/ },
];
const TEXT = /\.(md|mdx|txt|py|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|fish|ps1|bat|cmd|rb|go|rs|php|pl|lua|json|ya?ml|toml|ini|cfg|html|xml|sql|r|swift|kt|java|cs)$/i;

export async function scanSkill(dir, files) {
  const hits = {};
  const add = (rule, file, line) => {
    const h = (hits[rule.id] ||= { level: rule.level, label: rule.label, where: [] });
    if (h.where.length < 3) h.where.push(line ? `${file}:${line}` : file);
  };
  let scanned = 0, scripts = 0;
  for (const [rel, size] of files) {
    for (const r of RULES) if (r.file?.test(rel)) add(r, rel);
    if (/\.(py|js|mjs|cjs|ts|sh|bash|zsh|ps1|rb|go|rs|php|pl|lua|bat|cmd)$/i.test(rel)) scripts++;
    if (!(TEXT.test(rel) || !rel.includes("."))) continue;
    let text;
    try { if ((await stat(join(dir, rel))).size > 512 << 10) continue; text = await readFile(join(dir, rel), "utf8"); } catch { continue; }
    scanned++;
    const isMd = /\.mdx?$/i.test(rel);
    const lines = text.split("\n");
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      // 압축된 코드처럼 아주 긴 줄은 정규식이 느려지므로 앞부분만 본다
      const line = lines[i].length > 2000 ? lines[i].slice(0, 2000) : lines[i];
      const t = line.trim();
      if (isMd && /^(```|~~~)/.test(t)) { fence = !fence; continue; }
      // 코드 파일의 주석 줄은 설명일 뿐이라 건너뜀 (숨김 문자 검사는 제외)
      const comment = !isMd && /^(\/\/|#(?!!)|\*|\/\*|--|;|REM\s)/i.test(t);
      for (const r of RULES) {
        if (!r.re || (hits[r.id]?.where.length >= 3)) continue;
        if (r.ext && !r.ext.test(rel)) continue;
        if (isMd) {
          // 문서: 지시문 규칙은 어디서나, 명령 규칙은 코드 블록 안에서만. "하는 일"은 문서에서 세지 않음
          if (!r.prose && (!fence || r.level === "info" || r.codeOnly)) continue;
        } else if (comment && !r.prose) continue;
        if (r.re.test(line)) add(r, rel, i + 1);
      }
    }
  }
  const levels = Object.values(hits).map((h) => h.level);
  const level = levels.includes("high") ? "high" : levels.includes("medium") ? "medium" : "ok";
  return { level, scripts, files: files.length, scanned, hits };
}
