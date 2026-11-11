// 한국 사용자에게 특히 쓸모 있는 스킬인지 판단한다.
// 설명이나 이름이 한국어이거나, 한국 서비스/문서 형식/제도를 다루면 true.
const KR_TERMS = /\b(hwp|hwpx|hangul|hangeul|korea|korean|kakao|kakaotalk|naver|toss ?payments|coupang|baemin|daangn|karrot|kospi|kosdaq|opendart|dart\.fss|krx|nts\.go|hometax|data\.go\.kr|law\.go\.kr|kipris|nice ?pay|kcp|inicis|channel\.io|hancom|kftc|kisa|isms-p)\b/i;
const KR_HANGUL_TERMS = /(한글|한국|카카오|네이버|토스|쿠팡|배민|당근|공공데이터|국세청|홈택스|법령|판례|공시|전자공시|금감원|금융감독원|한컴|정부24|주민등록|사업자등록|세금계산서|건강보험|국민연금|청약|부동산|국토교통부|기상청|우체국|공문|보고서 양식)/;
const HANGUL = /[가-힣]/g;

export function isKorean(name, description, text, repo) {
  const head = `${name}\n${description}`;
  if ((head.match(HANGUL) || []).length >= 6) return true; // 설명 자체가 한국어
  if (KR_TERMS.test(head) || KR_HANGUL_TERMS.test(head)) return true;
  // 본문 대부분이 한국어로 쓰인 스킬
  const body = String(text).slice(0, 4000);
  if ((body.match(HANGUL) || []).length > 300) return true;
  if (repo.krQuery && (KR_TERMS.test(repo.desc) || KR_HANGUL_TERMS.test(repo.desc))) return true;
  return false;
}
