import { beforeEach, describe, expect, it } from 'vitest';
import { extractMetaMessages, parseMetaTimestamp, unwrapMetaUrl } from './message-extractor';
import { metaTagPlacement } from './dom';
function bubble(id: string, text: string, outgoing = false) {
  return `<div style="display:flex;flex-direction:${outgoing ? 'row-reverse' : 'row'}"><div style="display:flex;align-items:${outgoing ? 'flex-end' : 'flex-start'}"><div data-message-id="${id}">${text}</div></div></div>`;
}
describe('Meta Inbox extraction', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  it('reads message IDs, directions and explicit dates; excludes other chats and injected controls', () => {
    document.body.innerHTML = `<aside>Other chat</aside><section id="messages"><div><span>2026年8月21日 09:30</span></div>${bubble('one', '<span>hola<br>amigo</span><button class="trans_btn">翻译</button>', true)}${bubble('two', '<span>sí</span><span hidden>译文</span>')}</section>`;
    const messages = extractMetaMessages('shared', document.querySelector('#messages')!);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'meta:one', key: 'shared:meta:one', direction: 'outgoing', text: 'hola\namigo', timestampMs: new Date(2026, 7, 21, 9, 30).getTime() });
    expect(messages[1]).toMatchObject({ direction: 'incoming', text: 'sí', timestampMs: null });
  });
  it('keeps emoji and attachment types, not preview articles or image contents', () => {
    const url = 'https://www.instagram.com/reel/example/';
    const redirect = `https://l.facebook.com/l.php?u=${encodeURIComponent(url)}`;
    document.body.innerHTML = bubble('emoji', '<img alt="😀" src="emoji.png">')
      + bubble('link', `<a href="${redirect}">${url}</a><a href="${redirect}"><div>Unrelated article</div><img src="preview.png"></a>`)
      + bubble('image', '<a href="#" aria-label="图片附件：File.jpg"><img alt="" src="image.png"></a>');
    const messages = extractMetaMessages('a', document.body);
    expect(messages[0]).toMatchObject({ text: '😀', kind: 'text', mediaCount: 0 });
    expect(messages[1]).toMatchObject({ text: url, kind: 'link', urls: [url] });
    expect(messages[2]).toMatchObject({ text: '', kind: 'image', mediaCount: 1, urls: [] });
  });
  it('does not invent dates or unsupported message content', () => {
    document.body.innerHTML = `<div><span>08:37</span></div>${bubble('u', "<b>Message can't be displayed</b>")}`;
    expect(extractMetaMessages('a', document.body)[0]).toMatchObject({ kind: 'unknown', timestampMs: null, timestampRaw: '08:37' });
    expect(parseMetaTimestamp('2026年2月31日 09:30')).toBeNull();
    expect(parseMetaTimestamp('昨天')).toBeNull();
    expect(unwrapMetaUrl('javascript:alert(1)')).toBeNull();
  });
  it('places tags below the preview outside the clipped title line', () => {
    document.body.innerHTML = '<div id="row"><div id="column"><div class="_4ik4"><span id="title">Wynn ken</span></div><div id="preview"><div class="_4ik4">hola</div></div></div></div>';
    expect(metaTagPlacement(document.querySelector('#row')!, document.querySelector('#title')!))
      .toEqual({ container: document.querySelector('#column'), after: document.querySelector('#preview') });
  });
  it('handles recent Chinese/English weekdays and yesterday across month boundaries', () => {
    const now = new Date(2026, 8, 7, 12).getTime();
    expect(parseMetaTimestamp('周四01:08', now)).toBe(new Date(2026, 8, 3, 1, 8).getTime());
    expect(parseMetaTimestamp('周日22:38', now)).toBe(new Date(2026, 8, 6, 22, 38).getTime());
    expect(parseMetaTimestamp('Thu 1:08 AM', now)).toBe(new Date(2026, 8, 3, 1, 8).getTime());
    expect(parseMetaTimestamp('昨天23:50', new Date(2026, 8, 1, 12).getTime())).toBe(new Date(2026, 7, 31, 23, 50).getTime());
    expect(parseMetaTimestamp('周四25:08', now)).toBeNull();
  });
});
