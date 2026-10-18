import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: {}, storage: {} } }));
import { App } from './App';

afterEach(cleanup);
describe('无账号本地工作台', () => {
  it('显示三个主标签，没有标题区、消息页和上报入口', async () => {
    const { container } = render(<App />);
    await screen.findByRole('button', { name: '概览' });
    expect(container.querySelector('.topbar')).toBeNull();
    expect(container.querySelectorAll('.tabs button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '消息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /上报|恢复云端|保存并同步/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '翻译' }));
    expect(await screen.findByRole('tab', { name: 'AI 翻译' })).toBeEnabled();
  });
});
