import { afterEach, describe, expect, it, vi } from 'vitest';
import { microphoneErrorMessage, testMicrophoneAccess, voiceSetupUrl } from './voice-permission';

afterEach(() => vi.restoreAllMocks());
describe('语音权限', () => {
  it('授权页保持同一个插件来源，而不是直接打开外部网站', () => {
    expect(voiceSetupUrl('chrome-extension://example-id/sidepanel.html')).toBe('chrome-extension://example-id/microphone.html');
    expect(voiceSetupUrl('http://localhost:3000/src/entrypoints/sidepanel/index.html')).toBe('http://localhost:3000/src/entrypoints/microphone/index.html');
  });
  it('只请求音频，成功后立即停止所有音轨', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }));
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    await testMicrophoneAccess();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it('区分拒绝授权、无设备和设备不可用', () => {
    expect(microphoneErrorMessage(new DOMException('', 'NotAllowedError'))).toContain('NotAllowedError');
    expect(microphoneErrorMessage(new DOMException('', 'NotFoundError'))).toContain('未找到麦克风');
    expect(microphoneErrorMessage(new DOMException('', 'NotReadableError'))).toContain('无法启动麦克风');
  });
});
