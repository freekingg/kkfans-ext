import { describe, expect, it } from 'vitest';
import type { CooperationProfile } from '../core/types';
import { COOPERATION_PROFILE_FIELD_COUNT, countCompletedProfileFields } from './profile-completeness';

describe('合作资料填写数量', () => {
  it('只统计补充资料页真实展示的九个字段，包括添加来源', () => {
    const profile: CooperationProfile = {
      contactWhatsapp: '+52 123',
      platformAccount: 'player-8821',
      additionSource: 'comment',
      invitationUrl: 'https://example.com/invite/creator',
      followerData: '89.1K followers',
      instagramUsername: 'creator',
      instagramProfileUrl: '',
      country: '',
      finalPrice: '',
      specialStatus: 'completed',
      nextFollowUpAt: null,
      registeredDate: '',
      publishedDate: '',
      publishedUrl: '',
      updatedAt: 1,
    };

    expect(COOPERATION_PROFILE_FIELD_COUNT).toBe(9);
    expect(countCompletedProfileFields(profile)).toBe(5);
    expect(countCompletedProfileFields({ ...profile, additionSource: '' })).toBe(4);
    expect(countCompletedProfileFields(null)).toBe(0);
  });
});
