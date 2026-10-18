import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'KKFans WhatsApp 助手',
    description: '读取 WhatsApp Web 会话历史、添加标签、云端同步并使用 AI 分析。',
    minimum_chrome_version: '114',
    permissions: [
      'storage',
      'scripting',
      'unlimitedStorage',
      'alarms',
      'clipboardWrite',
    ],
    host_permissions: [
      'https://web.whatsapp.com/*',
      'https://business.facebook.com/*',
      'http://127.0.0.1:3333/*',
      'https://kkfans.lllin.fun/*',
      'https://sop.lllin.fun/*',
      'https://translate.googleapis.com/*',
    ],
    action: {
      default_title: '打开 KKFans WhatsApp 助手',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
    },
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
  },
});
