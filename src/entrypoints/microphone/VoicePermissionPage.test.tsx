import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoicePermissionPage } from './VoicePermissionPage';
import { testMicrophoneAccess } from '../../translation/voice-permission';

vi.mock('../../translation/voice-permission', async importOriginal => ({
  ...await importOriginal<typeof import('../../translation/voice-permission')>(),
  testMicrophoneAccess: vi.fn(async () => {}),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('普通标签页授权流程', () => {
  it('不自动打开麦克风，用户点击才检查，且不宣称 FastGPT 已获授权', async () => {
    const { container } = render(<VoicePermissionPage />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.querySelector('.voice-footer button')).toHaveAttribute('aria-label', '检查麦克风权限');
    expect(testMicrophoneAccess).not.toHaveBeenCalled();
    expect(screen.getByTitle('FastGPT 语音授权验证')).toHaveAttribute('allow', 'microphone https://cloud.fastgpt.io; clipboard-write');
    fireEvent.click(screen.getByRole('button', { name: '检查麦克风权限' }));
    expect(await screen.findByText(/插件麦克风可用/)).toHaveTextContent('请返回面板刷新');
    expect(testMicrophoneAccess).toHaveBeenCalledTimes(1);
  });
  it('显示可诊断的实际错误', async () => {
    vi.mocked(testMicrophoneAccess).mockRejectedValueOnce(new DOMException('', 'NotAllowedError'));
    render(<VoicePermissionPage />);
    fireEvent.click(screen.getByRole('button', { name: '检查麦克风权限' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NotAllowedError');
    expect(screen.getByRole('button', { name: '检查麦克风权限' })).toBeEnabled();
  });
});
