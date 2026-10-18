import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  onChanged: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  getTagDefinitions: vi.fn(),
  getConversationTags: vi.fn(),
  getConversationSopStages: vi.fn(),
  getConversationNotes: vi.fn(),
  getCooperationProfiles: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: { storage: { onChanged: mocks.onChanged } },
}));

vi.mock('../storage/settings', () => ({
  getTagDefinitions: mocks.getTagDefinitions,
  getConversationTags: mocks.getConversationTags,
  getConversationSopStages: mocks.getConversationSopStages,
  getConversationNotes: mocks.getConversationNotes,
  getCooperationProfiles: mocks.getCooperationProfiles,
}));

vi.mock('../whatsapp/conversation-identity', () => ({
  refreshVisibleContactConflicts: () => false,
  identityFromChatRow: () => ({ id: 'chat-1', title: 'Palafox', avatarKey: null }),
}));

import { ChatTagRenderer, resolveTagHostPlacement } from './chat-tag-renderer';

describe('WhatsApp 会话列表快速标签布局', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTagDefinitions.mockResolvedValue([
      { id: 'follow-up', name: '待跟进', color: '#0ea5e9' },
      { id: 'video-making', name: '视频制作中', color: '#8b5cf6' },
      { id: 'paid', name: '已付款', color: '#10b981' },
    ]);
    mocks.getConversationTags.mockResolvedValue({
      'chat-1': ['follow-up', 'video-making', 'paid'],
    });
    mocks.getConversationSopStages.mockResolvedValue({});
    mocks.getConversationNotes.mockResolvedValue({
      'chat-1': { text: '等待对方补充发布链接', updatedAt: 1 },
    });
    mocks.getCooperationProfiles.mockResolvedValue({});
    document.body.innerHTML = `
      <div id="pane-side">
        <div role="row" id="chat-row">
          <div class="avatar"></div>
          <div class="content">
            <div class="title-line"><span data-testid="cell-frame-title">Palafox</span></div>
            <div class="preview-line"><span data-testid="cell-frame-secondary">最后一条消息</span></div>
          </div>
        </div>
      </div>
    `;
  });

  it('把快速标签放在第三行，并将备注排在标签后面', async () => {
    await new ChatTagRenderer().refresh();

    const row = document.querySelector<HTMLElement>('#chat-row')!;
    const title = row.querySelector<HTMLElement>('[data-testid="cell-frame-title"]')!;
    const host = row.querySelector<HTMLElement>('[data-kkfans-tag-host]')!;

    expect(host).toBeTruthy();
    expect(title.querySelector('[data-kkfans-tag-host]')).toBeNull();
    expect(host.parentElement).toHaveClass('content');
    expect(host.previousElementSibling).toHaveClass('preview-line');
    expect(host.shadowRoot?.querySelectorAll('.pill')).toHaveLength(3);
    const items = [...(host.shadowRoot?.querySelector('.labels')?.children ?? [])];
    expect(items.map((item) => item.className)).toEqual([
      'pill',
      'pill',
      'pill',
      'note-pill',
    ]);
    expect(items.at(-1)).toHaveTextContent('备注：等待对方补充发布链接');
    expect(host.shadowRoot?.querySelector('.tag-button')).toBeNull();
  });

  it('消息预览标识缺失时也不会把标签重新塞进标题节点', () => {
    const row = document.querySelector<HTMLElement>('#chat-row')!;
    const title = row.querySelector<HTMLElement>('[data-testid="cell-frame-title"]')!;
    row.querySelector('[data-testid="cell-frame-secondary"]')?.removeAttribute('data-testid');

    const placement = resolveTagHostPlacement(row, title);

    expect(placement.container).not.toBe(title);
    expect(title.contains(placement.container)).toBe(false);
  });

  it('插件停用时清除已经注入 WhatsApp 列表的标签', async () => {
    const renderer = new ChatTagRenderer();
    await renderer.refresh();
    expect(document.querySelector('[data-kkfans-tag-host]')).toBeTruthy();

    renderer.stop();

    expect(document.querySelector('[data-kkfans-tag-host]')).toBeNull();
  });

  it('会话列表 DOM 变化时使用内存缓存，不重新读取全部标签数据', async () => {
    const renderer = new ChatTagRenderer();
    renderer.start();
    await waitFor(() => expect(document.querySelector('[data-kkfans-tag-host]')).toBeTruthy());
    vi.clearAllMocks();

    const marker = document.createElement('span');
    marker.textContent = '选中状态变化';
    document.querySelector('#chat-row .content')?.append(marker);
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(mocks.getTagDefinitions).not.toHaveBeenCalled();
    expect(mocks.getConversationTags).not.toHaveBeenCalled();
    expect(mocks.getConversationNotes).not.toHaveBeenCalled();
    expect(document.querySelector('[data-kkfans-tag-host]')).toBeTruthy();
    renderer.stop();
  });
});
