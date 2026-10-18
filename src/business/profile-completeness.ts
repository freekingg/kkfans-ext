import type { CooperationProfile } from '../core/types';

const COOPERATION_PROFILE_FIELDS = [
  'contactWhatsapp',
  'platformAccount',
  'additionSource',
  'invitationUrl',
  'followerData',
  'instagramProfileUrl',
  'country',
  'finalPrice',
  'publishedUrl',
] as const satisfies ReadonlyArray<keyof CooperationProfile>;

export const COOPERATION_PROFILE_FIELD_COUNT = COOPERATION_PROFILE_FIELDS.length;

export function countCompletedProfileFields(profile: CooperationProfile | null): number {
  if (!profile) return 0;
  return COOPERATION_PROFILE_FIELDS.filter((field) => Boolean(String(profile[field] ?? '').trim())).length;
}
