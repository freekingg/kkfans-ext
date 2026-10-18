import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaptureLockedActions } from './CaptureLockedActions';

describe('消息读取操作锁', () => {
  it('读取时禁用区域内的按钮和输入框', () => {
    const { rerender } = render(
      <CaptureLockedActions locked>
        <button>AI 分析</button>
        <input aria-label="备注" />
      </CaptureLockedActions>,
    );

    expect(screen.getByRole('button', { name: 'AI 分析' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '备注' })).toBeDisabled();
    expect(screen.getByText('消息读取中，下方操作已暂时锁定')).toBeInTheDocument();

    rerender(
      <CaptureLockedActions locked={false}>
        <button>AI 分析</button>
        <input aria-label="备注" />
      </CaptureLockedActions>,
    );
    expect(screen.getByRole('button', { name: 'AI 分析' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: '备注' })).toBeEnabled();
  });
});
