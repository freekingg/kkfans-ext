import type { CooperationAdditionSource } from '../core/types';

export const COOPERATION_ADDITION_SOURCES: ReadonlyArray<{
  id: CooperationAdditionSource;
  label: string;
}> = [
  { id: 'comment', label: '评论' },
  { id: 'direct-message', label: '私信' },
  { id: 'email', label: '邮件' },
  { id: 'referral', label: '转介绍' },
];

export function normalizeAdditionSource(value: unknown): CooperationAdditionSource | '' {
  return COOPERATION_ADDITION_SOURCES.find((source) => source.id === value)?.id ?? '';
}
