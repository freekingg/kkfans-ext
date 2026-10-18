import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequiredAccountSetup } from './RequiredAccountSetup';

afterEach(() => cleanup());

describe('插件必填账号配置', () => {
  it('两个字段未配置时不能启用插件', () => {
    render(
      <RequiredAccountSetup
        draft={{ username: '', whatsappAccount: '' }}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '保存并启用插件' })).toBeDisabled();
    expect(screen.getByText('请输入用户名')).toBeInTheDocument();
  });

  it('输入或粘贴 WhatsApp 账号时会立即移除空格', () => {
    const onChange = vi.fn();
    render(
      <RequiredAccountSetup
        draft={{ username: 'king', whatsappAccount: '' }}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('例如：+521234567890'), {
      target: { value: '+52 123 456 7890' },
    });
    expect(onChange).toHaveBeenCalledWith('whatsappAccount', '+521234567890');
  });

  it('配置完整后允许保存并启用', () => {
    const onSave = vi.fn();
    render(
      <RequiredAccountSetup
        draft={{ username: 'king', whatsappAccount: '+521234567890' }}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存并启用插件' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
