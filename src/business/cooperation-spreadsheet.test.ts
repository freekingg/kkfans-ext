import { describe, expect, it } from 'vitest';
import type { CooperationProfile } from '../core/types';
import { buildCooperationSpreadsheetRow } from './cooperation-spreadsheet';

describe('合作资料表格行', () => {
  it('按表格列顺序生成一行，并把多行粉丝数据保留在同一 HTML 单元格', () => {
    const profile: CooperationProfile = {
      contactWhatsapp: '52 12481553000',
      platformAccount: 'player-8821',
      additionSource: 'referral',
      invitationUrl: 'https://example.com/invite/creator',
      followerData: '53 posts\n89.1K followers\n320 following',
      instagramUsername: 'xitomata',
      instagramProfileUrl: 'https://www.instagram.com/xitomata/',
      country: 'México',
      finalPrice: '400',
      specialStatus: null,
      nextFollowUpAt: null,
      registeredDate: '',
      publishedDate: '',
      publishedUrl: '',
      updatedAt: 1,
    };

    const row = buildCooperationSpreadsheetRow('+8116884087', {
      ...profile,
      contactWhatsapp: '+52 12481553000',
    }, '视频制作中\n等待审核');

    expect(row.cells).toEqual([
      '8116884087',
      'https://www.instagram.com/xitomata/',
      '52 12481553000',
      'player-8821',
      'https://example.com/invite/creator',
      '400',
      '53 posts\n89.1K followers\n320 following',
      '视频制作中\n等待审核',
    ]);
    expect(row.plainText.split('\t')).toHaveLength(8);
    expect(row.plainText).not.toContain('+');
    expect(row.plainText).toContain('53 posts / 89.1K followers / 320 following');
    expect(row.html).toContain('<td>53 posts<br>89.1K followers<br>320 following</td>');
    expect(row.html).toContain('<td>视频制作中<br>等待审核</td>');
  });
});
