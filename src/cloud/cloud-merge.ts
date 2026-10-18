import type { CooperationProfile, ConversationNote, ConversationSopStage } from '../core/types';

export interface CloudMetadata {
  tagIds: string[];
  note: ConversationNote | null;
  profile: CooperationProfile | null;
  sopStage: ConversationSopStage | null;
}
export type MetadataField = keyof CloudMetadata;
export const METADATA_FIELDS: MetadataField[] = ['tagIds', 'note', 'profile', 'sopStage'];
export const emptyMetadata = (): CloudMetadata => ({ tagIds: [], note: null, profile: null, sopStage: null });
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function mergeCloudMetadata(local: CloudMetadata, remote: CloudMetadata, base?: CloudMetadata) {
  const value = { ...remote };
  const conflicts: MetadataField[] = [];
  if (base) {
    for (const key of METADATA_FIELDS) {
      if (sameValue(local[key], base[key])) continue;
      Object.assign(value, { [key]: local[key] });
      if (!sameValue(remote[key], base[key]) && !sameValue(local[key], remote[key])) conflicts.push(key);
    }
    return { value, conflicts };
  }
  // Migration/first restore: empty is absence, not an intentional deletion.
  value.tagIds = [...new Set([...remote.tagIds, ...local.tagIds])];
  if (local.note) {
    const text = [...new Set([remote.note?.text, local.note.text].filter(Boolean))].join('\n');
    if (text.length > 2000) { value.note = local.note; conflicts.push('note'); }
    else value.note = { text, updatedAt: Math.max(local.note.updatedAt, remote.note?.updatedAt ?? 0) };
  }
  if (local.profile) {
    const entries = Object.entries(local.profile).filter(([, v]) => v !== '' && v !== null && v !== undefined);
    value.profile = { ...remote.profile, ...local.profile, ...Object.fromEntries(entries) };
    // Fill empty legacy fields from cloud instead of erasing cloud-only details.
    for (const [key, v] of Object.entries(remote.profile ?? {})) {
      if ((value.profile as unknown as Record<string, unknown>)[key] == null || (value.profile as unknown as Record<string, unknown>)[key] === '') {
        Object.assign(value.profile, { [key]: v });
      }
    }
  }
  if (local.sopStage && (!remote.sopStage || local.sopStage.updatedAt >= remote.sopStage.updatedAt)) value.sopStage = local.sopStage;
  return { value, conflicts };
}
