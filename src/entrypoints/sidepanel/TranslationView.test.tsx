import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_TRANSLATION_URL, TranslationView } from './TranslationView';

vi.mock('../../storage/translation-history', () => ({
  getTranslationHistory: vi.fn(async () => []),
  addTranslationHistory: vi.fn(async () => []),
  deleteTranslationHistory: vi.fn(async () => []),
}));

describe('翻译工作台', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('按需加载 AI 页面，切换保留输入及同一个 iframe', async () => {
    const { container } = render(<TranslationView />);
    await act(async () => {});
    expect(container.querySelector('iframe')).toBeNull();
    const input = container.querySelector('textarea')!;
    fireEvent.change(input, { target: { value: '待翻译内容' } });
    fireEvent.click(screen.getByRole('tab', { name: 'AI 翻译' }));
    const frame = screen.getByTitle('FastGPT AI 翻译');
    expect(frame).toHaveAttribute('src', AI_TRANSLATION_URL);
    expect(frame).toHaveAttribute('allow', 'clipboard-write; microphone https://cloud.fastgpt.io');
    expect(container.querySelector('script')).toBeNull();
    const external = screen.getByRole('link', { name: '新窗口' });
    expect(external).toHaveAttribute('href', AI_TRANSLATION_URL);
    expect(external).toHaveAttribute('target', '_blank');
    const microphoneCheck = screen.getByRole('link', { name: '检查麦克风权限' });
    expect(microphoneCheck).toHaveAttribute('target', '_blank');
    expect(microphoneCheck.getAttribute('href')).toContain('/microphone/index.html');
    expect(microphoneCheck.closest('.ai-translation-footer')).not.toBeNull();
    expect(microphoneCheck.textContent).toBe('');
    expect(screen.queryByText(/独立网站和插件嵌入环境/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '快速翻译' }));
    expect(input).toHaveValue('待翻译内容');
    expect(frame.parentElement?.parentElement?.parentElement).toHaveAttribute('hidden');
    fireEvent.click(screen.getByRole('tab', { name: 'AI 翻译' }));
    expect(screen.getByTitle('FastGPT AI 翻译')).toBe(frame);
  });

  it('刷新确实重新创建 iframe，加载后移除加载遮罩', async () => {
    render(<TranslationView />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('tab', { name: 'AI 翻译' }));
    const frame = screen.getByTitle('FastGPT AI 翻译');
    fireEvent.load(frame);
    expect(screen.queryByText('正在加载 AI 翻译…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByTitle('FastGPT AI 翻译')).not.toBe(frame);
    expect(screen.getByTitle('FastGPT AI 翻译')).toHaveAttribute('src', AI_TRANSLATION_URL);
    expect(screen.getByText('正在加载 AI 翻译…')).toBeInTheDocument();
  });

  it('加载超时提示刷新或新窗口，不宣称加载成功', async () => {
    vi.useFakeTimers();
    render(<TranslationView />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('tab', { name: 'AI 翻译' }));
    act(() => vi.advanceTimersByTime(15000));
    expect(screen.getByRole('status')).toHaveTextContent('页面加载较慢或不可用');
    expect(screen.queryByText('正在加载 AI 翻译…')).not.toBeInTheDocument();
  });
});
