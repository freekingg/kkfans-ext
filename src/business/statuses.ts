import type { CooperationSpecialStatus } from '../core/types';

export const COOPERATION_SPECIAL_STATUSES: ReadonlyArray<{
  id: CooperationSpecialStatus;
  label: string;
}> = [
  { id: 'paused', label: '暂停' },
  { id: 'rejected', label: '拒绝合作' },
  { id: 'lost-contact', label: '失联' },
  { id: 'abandoned', label: '放弃' },
  { id: 'completed', label: '合作完成' },
];

const LABELS = new Map(COOPERATION_SPECIAL_STATUSES.map((status) => [status.id, status.label]));

export function isCooperationSpecialStatus(value: unknown): value is CooperationSpecialStatus {
  return typeof value === 'string' && LABELS.has(value as CooperationSpecialStatus);
}

export function getCooperationSpecialStatusLabel(value: CooperationSpecialStatus): string {
  return LABELS.get(value) ?? value;
}
