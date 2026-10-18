import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const data = vi.hoisted(() => ({ policy: {} as Record<string, unknown>, listeners: new Set<(changes: Record<string, unknown>) => void>(), send: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  storage: { local: {
    get: vi.fn(async () => ({ cloudReportPolicy: data.policy })),
    set: vi.fn(async (values: Record<string, any>) => { data.policy = values.cloudReportPolicy; data.listeners.forEach(fn => fn(values)); }),
  }, onChanged: { addListener: (fn: (changes: Record<string, unknown>) => void) => data.listeners.add(fn), removeListener: (fn: (changes: Record<string, unknown>) => void) => data.listeners.delete(fn) } },
  runtime: { sendMessage: data.send },
} }));
import { ConversationReport, ReportPreference } from './ReportControls';
const sync = { status: 'idle' as const, pendingCount: 0, lastSyncedAt: null, error: null };
beforeEach(() => { data.policy = {}; data.send.mockReset().mockResolvedValue({ ok: true }); });
afterEach(cleanup);
describe('manual report controls', () => {
  it('defaults the auto switch off and saves its explicit change', async () => {
    render(<ReportPreference />);
    expect(screen.getByRole('switch')).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
    expect(data.policy.autoSync).toBe(true);
  });
  it('saves the note before reporting only the selected conversation', async () => {
    const beforeReport = vi.fn(async () => { expect(data.send).not.toHaveBeenCalled(); });
    render(<ConversationReport conversationId="selected-chat" disabled={false} sync={sync} beforeReport={beforeReport} />);
    fireEvent.click(screen.getByRole('button', { name: '上报' }));
    await waitFor(() => expect(data.send).toHaveBeenCalledWith({ type: 'cloud:report', conversationId: 'selected-chat' }));
    expect(beforeReport).toHaveBeenCalledTimes(1);
  });
  it('locks reporting during capture and reports a rejected request visibly', async () => {
    const { rerender } = render(<ConversationReport conversationId="selected-chat" disabled sync={sync} beforeReport={async () => {}} />);
    expect(screen.getByRole('button', { name: '上报' })).toBeDisabled();
    data.send.mockResolvedValue({ ok: false, error: '当前会话尚无消息' });
    rerender(<ConversationReport conversationId="selected-chat" disabled={false} sync={sync} beforeReport={async () => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '上报' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前会话尚无消息');
  });
  it('does not report when saving the current draft fails', async () => {
    render(<ConversationReport conversationId="selected-chat" disabled={false} sync={sync} beforeReport={async () => { throw new Error('保存失败'); }} />);
    fireEvent.click(screen.getByRole('button', { name: '上报' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(data.send).not.toHaveBeenCalled();
  });
});
