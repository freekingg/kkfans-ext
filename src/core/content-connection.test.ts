import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), send: vi.fn(), inject: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  tabs: { query: mocks.query, sendMessage: mocks.send },
  scripting: { executeScript: mocks.inject },
  runtime: { getManifest: () => ({ content_scripts: [{ matches: ['https://web.whatsapp.com/*'], js: ['content-scripts/whatsapp.js'] }] }) },
} }));
import { sendContent } from './content-connection';
const contextCommand = { type: 'content:get-context' } as const;
beforeEach(() => { vi.resetAllMocks(); mocks.query.mockResolvedValue([{ id: 41, active: true, status: 'complete' }]); });
describe('panel page connection', () => {
  it('uses Meta WhatsApp and never falls back from Messenger to another chat', async () => {
    mocks.query.mockResolvedValue([{ id: 60, active: true, url: 'https://business.facebook.com/latest/inbox/wec' }, { id: 61, url: 'https://web.whatsapp.com/' }]);
    mocks.send.mockResolvedValue({ ok: true });
    expect(await sendContent(contextCommand)).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith(60, contextCommand, { frameId: 0 });
    mocks.query.mockResolvedValue([{ id: 60, active: true, url: 'https://business.facebook.com/latest/inbox/messenger' }, { id: 61, url: 'https://web.whatsapp.com/' }]);
    expect(await sendContent(contextCommand)).toEqual({ ok: false, error: expect.stringContaining('切换到 WhatsApp') });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('selects the active WhatsApp tab in this window and only addresses its main frame', async () => {
    mocks.query.mockResolvedValue([{ id: 42, active: false }, { id: 41, active: true }]);
    mocks.send.mockResolvedValue({ ok: true });
    expect(await sendContent(contextCommand)).toEqual({ ok: true });
    expect(mocks.query).toHaveBeenCalledWith({ url: ['https://web.whatsapp.com/*', 'https://business.facebook.com/*'], currentWindow: true });
    expect(mocks.send).toHaveBeenCalledWith(41, contextCommand, { frameId: 0 });
    expect(mocks.inject).not.toHaveBeenCalled();
  });
  it('repairs a missing content script and retries without requiring a page refresh', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.')).mockResolvedValueOnce({ ok: true });
    mocks.inject.mockResolvedValue([]);
    expect(await sendContent(contextCommand)).toEqual({ ok: true });
    expect(mocks.inject).toHaveBeenCalledWith({ target: { tabId: 41, frameIds: [0] }, files: ['/content-scripts/whatsapp.js'] });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('does not reinject on every panel poll if a page keeps failing', async () => {
    mocks.query.mockResolvedValue([{ id: 43, active: true }]);
    mocks.send.mockRejectedValue(new Error('Receiving end does not exist'));
    mocks.inject.mockResolvedValue([]);
    expect((await sendContent(contextCommand)).ok).toBe(false);
    expect((await sendContent(contextCommand)).ok).toBe(false);
    expect(mocks.inject).toHaveBeenCalledTimes(1);
  });
  it('never repeats an action if the receiver may have executed it before its channel closed', async () => {
    mocks.send.mockRejectedValue(new Error('The message port closed before a response was received.'));
    const response = await sendContent({ type: 'content:start-capture' });
    expect(response).toEqual({ ok: false, error: expect.stringContaining('message port closed') });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.inject).not.toHaveBeenCalled();
  });
  it('shows the real injection error instead of repeatedly asking to refresh', async () => {
    mocks.query.mockResolvedValue([{ id: 44, active: true }]);
    mocks.send.mockRejectedValue(new Error('Receiving end does not exist'));
    mocks.inject.mockRejectedValue(new Error('Cannot access contents of the page. Extension manifest must request permission.'));
    expect(await sendContent(contextCommand)).toEqual({ ok: false, error: expect.stringContaining('must request permission') });
  });
  it('waits for a loading page and does not select a tab in a different window', async () => {
    mocks.query.mockResolvedValueOnce([{ id: 45, active: true, status: 'loading' }]).mockResolvedValueOnce([]);
    expect(await sendContent(contextCommand)).toEqual({ ok: false, error: expect.stringContaining('正在加载') });
    expect(await sendContent(contextCommand)).toEqual({ ok: false, error: expect.stringContaining('本窗口没有打开') });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
