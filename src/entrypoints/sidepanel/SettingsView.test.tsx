import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from './SettingsView';

afterEach(cleanup);
describe('本地模式设置', () => {
  it('仅保留模型设置，不再要求账号或提供上报入口', () => {
    render(<SettingsView focusSection="ai" aiDraft={{ baseUrl: '', apiKey: '', model: '' }} aiConfigured={false}
      aiTesting={false} aiNotice="" aiNoticeTone="info" onAiChange={vi.fn()} onSaveAi={vi.fn()} onTestAi={vi.fn()} />);
    expect(screen.getByText('AI 模型')).toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('WhatsApp 账号')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /恢复|上报|同步/ })).not.toBeInTheDocument();
  });
});
