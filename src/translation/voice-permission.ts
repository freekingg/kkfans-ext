export function voiceSetupUrl(panelUrl: string): string {
  const url = new URL(panelUrl);
  return new URL(url.protocol.endsWith('-extension:') ? '/microphone.html' : '../microphone/index.html', url).href;
}

/** Test access only after a click; never record, retain or upload audio. */
export async function testMicrophoneAccess(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('此页面无法调用麦克风。请使用浏览器中的插件授权页，或单独打开 FastGPT。');
  }
  const policy = (document as Document & {
    featurePolicy?: { allowsFeature(feature: string): boolean };
  }).featurePolicy;
  if (policy && !policy.allowsFeature('microphone')) {
    throw new Error('当前页面被上层麦克风策略限制，请在 AdsPower 的普通标签页中打开插件授权页。');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stream.getTracks().forEach(track => track.stop());
}

export function microphoneErrorMessage(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `${name}：浏览器或系统拒绝访问。请检查当前插件页面的网站麦克风权限、Windows 麦克风隐私设置，以及 AdsPower 环境的媒体设备设置。FastGPT 网站的授权不代表插件也已获准。`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `${name}：未找到麦克风，请检查设备连接及 AdsPower 环境是否提供音频输入设备。`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `${name}：无法启动麦克风，可能被其他程序占用，或被系统/浏览器阻止。`;
    default:
      return cause instanceof Error ? `${name ? `${name}：` : ''}${cause.message}` : '麦克风检查失败，请在新窗口使用语音。';
  }
}
