import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileModal } from './ProfileModal';

function mockConfirm(result: boolean) {
  const confirm = vi.fn(() => result);
  Object.defineProperty(window, 'confirm', {
    value: confirm,
    configurable: true,
    writable: true,
  });
  return confirm;
}

afterEach(() => cleanup());

describe('合作资料弹层', () => {
  it('有未保存修改时关闭需要确认', () => {
    const onClose = vi.fn();
    const confirm = mockConfirm(false);
    render(
      <ProfileModal title="合作资料" subtitle="当前会话" dirty onClose={onClose}>
        <input aria-label="国家" />
      </ProfileModal>,
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭合作资料' }));
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('打开后产生的修改也会被关闭保护识别', () => {
    const onClose = vi.fn();
    const confirm = mockConfirm(false);
    const { rerender } = render(
      <ProfileModal title="合作资料" subtitle="当前会话" dirty={false} onClose={onClose}>
        <input aria-label="国家" />
      </ProfileModal>,
    );
    rerender(
      <ProfileModal title="合作资料" subtitle="当前会话" dirty onClose={onClose}>
        <input aria-label="国家" />
      </ProfileModal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(confirm).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('没有修改时可直接关闭', () => {
    const onClose = vi.fn();
    const confirm = mockConfirm(false);
    render(
      <ProfileModal title="合作资料" subtitle="当前会话" dirty={false} onClose={onClose}>
        <input aria-label="国家" />
      </ProfileModal>,
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭合作资料' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
