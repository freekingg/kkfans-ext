import { browser } from 'wxt/browser';
import type { CloudSettings } from '../core/types';

export const CLOUD_SPACE_KEY = 'cloudDataSpace';
export function cloudSpaceKey(settings: CloudSettings): string {
  return JSON.stringify([settings.username.trim(), settings.whatsappAccount.replace(/\D/g, '')]);
}

export async function assertCloudSpace(settings: CloudSettings): Promise<void> {
  const { cloudDataSpace, cloudSettings } = await browser.storage.local.get([CLOUD_SPACE_KEY, 'cloudSettings']);
  const desired = cloudSpaceKey(settings);
  if (cloudSettings && cloudSpaceKey(cloudSettings as CloudSettings) !== desired) throw new Error('账号已切换，本次同步已停止');
  if (cloudDataSpace && cloudDataSpace !== desired) throw new Error('本地数据已绑定其他账号，请在独立浏览器环境配置新账号，避免数据串号');
  if (!cloudDataSpace) await browser.storage.local.set({ [CLOUD_SPACE_KEY]: desired });
}
