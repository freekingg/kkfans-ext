const API_URL = 'https://translate.googleapis.com/translate_a/single';
const MAX_QUERY_BYTES = 1200;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function splitTranslationText(value: string): string[] {
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining) {
    if (utf8Length(remaining) <= MAX_QUERY_BYTES) {
      chunks.push(remaining);
      break;
    }
    let bytes = 0;
    let end = 0;
    let preferredEnd = 0;
    for (const character of remaining) {
      const nextBytes = utf8Length(character);
      if (bytes + nextBytes > MAX_QUERY_BYTES) break;
      bytes += nextBytes;
      end += character.length;
      if (/\s|[。！？；，.!?;,]/.test(character)) preferredEnd = end;
    }
    const splitAt = preferredEnd >= Math.floor(end * 0.6) ? preferredEnd : end;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function parseGoogleTranslation(value: unknown): string | null {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return null;
  const translated = value[0]
    .map((segment) => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '')
    .join('')
    .trim();
  return translated || null;
}

async function translateChunk(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const url = new URL(API_URL);
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', source);
  url.searchParams.set('tl', target);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);
  const response = await fetch(url, { method: 'GET' });
  const body = await response.json().catch(() => null);
  const translated = parseGoogleTranslation(body);
  if (!response.ok || !translated) {
    throw new Error(
      response.status === 429 || response.status === 403
        ? 'Google 免费翻译当前限制了该网络，请稍后重试'
        : `Google 翻译请求失败 (${response.status})`,
    );
  }
  return translated;
}

export async function translateWithGoogleFree(
  text: string,
  source: 'zh-CN' | 'es',
  target: 'zh-CN' | 'es',
): Promise<string> {
  const chunks = splitTranslationText(text);
  if (!chunks.length) throw new Error('请输入需要翻译的内容');
  const translated: string[] = [];
  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk, source, target));
  }
  return translated.join('');
}
