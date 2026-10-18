import type { CooperationProfile } from '../core/types';

export interface CooperationSpreadsheetRow {
  cells: string[];
  plainText: string;
  html: string;
}

function normalizeCell(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function normalizeWhatsappCell(value: string): string {
  return normalizeCell(value).replace(/\+/g, '');
}

function plainCell(value: string): string {
  return normalizeCell(value).replace(/[\t\n]+/g, ' / ');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCooperationSpreadsheetRow(
  ownWhatsapp: string,
  profile: CooperationProfile,
  note: string,
): CooperationSpreadsheetRow {
  const cells = [
    normalizeWhatsappCell(ownWhatsapp),
    profile.instagramProfileUrl,
    normalizeWhatsappCell(profile.contactWhatsapp),
    profile.platformAccount,
    profile.invitationUrl,
    profile.finalPrice,
    profile.followerData,
    note,
  ].map(normalizeCell);

  return {
    cells,
    plainText: cells.map(plainCell).join('\t'),
    html: `<table><tbody><tr>${cells
      .map((cell) => `<td>${escapeHtml(cell).replace(/\n/g, '<br>')}</td>`)
      .join('')}</tr></tbody></table>`,
  };
}

export async function copyCooperationSpreadsheetRow(
  ownWhatsapp: string,
  profile: CooperationProfile,
  note: string,
): Promise<void> {
  const row = buildCooperationSpreadsheetRow(ownWhatsapp, profile, note);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([row.plainText], { type: 'text/plain' }),
          'text/html': new Blob([row.html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // 部分 Chromium 环境只允许纯文本剪贴板，继续使用兼容写入。
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
  await navigator.clipboard.writeText(row.plainText);
}
