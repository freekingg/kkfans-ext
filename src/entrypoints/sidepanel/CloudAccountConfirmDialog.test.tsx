import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudAccountConfirmDialog } from './CloudAccountConfirmDialog';

afterEach(cleanup);

const account = { username: 'kkflow01', whatsappAccount: '+5218116884087' };

describe('cloud account confirmation', () => {
  it('shows the exact account and does not save before explicit confirmation', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    render(<CloudAccountConfirmDialog account={account} onConfirm={save} onCancel={cancel} />);
    expect(screen.getByText('kkflow01')).toBeInTheDocument();
    expect(screen.getByText('+5218116884087')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认账号并同步' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it('submits the displayed snapshot once and locks repeated clicks while saving', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const cancel = vi.fn();
    render(<CloudAccountConfirmDialog account={account} onConfirm={save} onCancel={cancel} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认账号并同步' }));
    fireEvent.click(screen.getByRole('button', { name: '正在保存…' }));
    expect(save).toHaveBeenCalledExactlyOnceWith(account);
    expect(screen.getByRole('button', { name: '返回修改' })).toBeDisabled();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(cancel).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: '确认账号并同步' })).toBeEnabled());
  });

  it('retains the confirmation when saving fails and shows the reason', async () => {
    const save = vi.fn().mockRejectedValue(new Error('本地数据已绑定其他账号'));
    render(<CloudAccountConfirmDialog account={account} onConfirm={save} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认账号并同步' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('本地数据已绑定其他账号');
    expect(screen.getByRole('button', { name: '返回修改' })).toBeEnabled();
  });
});
