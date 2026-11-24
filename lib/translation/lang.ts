// lib/translation/lang.ts
// 判断一段文字是不是中文、要不要翻译成中文。浏览器和服务端共用，纯函数。
//
// 这里只需要回答「是不是中文」，所以按文字系统判断，不用 n-gram 语种识别：
// 推文太短，那类库在几十个字符上并不稳定，它们擅长的英/法/西之分这里也用不上。
//
// 1. 去掉不属于语言内容的部分：链接、邮箱、@用户名、$股票代码。
// 2. 用 Intl.Segmenter 分词（中文走 ICU 词典），只数含字母的词；
//    数字、标点、emoji 不计。
// 3. 按词数比中文词和其它词。按词而不按字符：一个英文词占好几个字符，
//    按字符算会把夹着英文术语的中文判成外文。
// 4. 有假名的是日文，整段按外文处理。

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/giu;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
const MENTION_RE = /[@＠]\w+/gu;
const CASHTAG_RE = /\$[a-z][a-z0-9._]*/giu;

const HAN_RE = /\p{Script=Han}/u;
const LETTER_RE = /\p{L}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
// 没有 Intl.Segmenter 时的退路：每个汉字算一个词，其它字母连写算一个词。
const FALLBACK_WORD_RE = /\p{Script=Han}|[^\s\p{P}\p{S}\p{N}\p{Script=Han}]+/gu;

/** 中文词至少占这么多，才算中文。 */
const CHINESE_SHARE = 0.4;

let segmenter: Intl.Segmenter | null | undefined;

function words(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null;
  }
  if (!segmenter) return text.match(FALLBACK_WORD_RE) ?? [];
  const out: string[] = [];
  for (const s of segmenter.segment(text)) {
    if (s.isWordLike) out.push(s.segment);
  }
  return out;
}

/** 去掉链接、邮箱、@用户名和 $代码后的文字。 */
export function stripNonLanguage(text: string): string {
  return text
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(CASHTAG_RE, ' ');
}

/** 中文词数和其它语言的词数。日文整段计入 other。 */
export function countWords(text: string): { zh: number; other: number } {
  const clean = stripNonLanguage(text);
  const list = words(clean).filter((w) => LETTER_RE.test(w));
  // 两个以上假名才算日文，免得颜文字里的「ツ」或中文网络用语里的「の」误判。
  if ((clean.match(KANA_RE)?.length ?? 0) >= 2) return { zh: 0, other: list.length };
  let zh = 0;
  for (const w of list) if (HAN_RE.test(w)) zh++;
  return { zh, other: list.length - zh };
}

/** 主要是中文（简体或繁体）。 */
export function isChineseText(text: string): boolean {
  const { zh, other } = countWords(text);
  return zh > 0 && zh / (zh + other) >= CHINESE_SHARE;
}

/** 有需要翻成中文的内容：不是中文，也不只是链接、@用户名、数字或 emoji。 */
export function needsZhTranslation(text: string): boolean {
  const { zh, other } = countWords(text);
  return other > 0 && zh / (zh + other) < CHINESE_SHARE;
}
