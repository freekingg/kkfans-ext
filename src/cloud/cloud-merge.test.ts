import { describe, expect, it } from 'vitest';
import { mergeCloudMetadata, emptyMetadata } from './cloud-merge';

describe('cloud recovery merge', () => {
  it('restores cloud tags and notes into an empty installation', () => {
    const remote = { ...emptyMetadata(), tagIds: ['paid'], note: { text: '云端备注', updatedAt: 10 } };
    expect(mergeCloudMetadata(emptyMetadata(), remote).value).toEqual(remote);
  });
  it('preserves pre-upgrade local data without losing cloud-only tags or notes', () => {
    const local = { ...emptyMetadata(), tagIds: ['local'], note: { text: '本地备注', updatedAt: 20 } };
    const remote = { ...emptyMetadata(), tagIds: ['paid'], note: { text: '云端备注', updatedAt: 10 } };
    const merged = mergeCloudMetadata(local, remote);
    expect(merged.value.tagIds).toEqual(['paid', 'local']);
    expect(merged.value.note?.text).toContain('本地备注');
    expect(merged.value.note?.text).toContain('云端备注');
  });
  it('distinguishes intentional local clearing from a cache that has never been restored', () => {
    const base = { ...emptyMetadata(), tagIds: ['paid'] };
    expect(mergeCloudMetadata(emptyMetadata(), base, base).value.tagIds).toEqual([]);
    expect(mergeCloudMetadata(emptyMetadata(), base).value.tagIds).toEqual(['paid']);
  });
  it('applies remote edits to clean data but retains dirty fields and reports conflicts', () => {
    const base = { ...emptyMetadata(), note: { text: '原备注', updatedAt: 1 } };
    const local = { ...base, note: { text: '本地刚修改', updatedAt: 2 } };
    const remote = { ...base, tagIds: ['paid'], note: { text: 'Web刚修改', updatedAt: 3 } };
    const result = mergeCloudMetadata(local, remote, base);
    expect(result.value.tagIds).toEqual(['paid']);
    expect(result.value.note).toEqual(local.note);
    expect(result.conflicts).toEqual(['note']);
  });
});
