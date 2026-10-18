import { browser } from 'wxt/browser';

export const REPORT_POLICY = 'cloudReportPolicy';
export interface ReportPolicy {
  autoSync: boolean;
  reported: Record<string, number>;
  requests: Record<string, string>;
}
export async function readReportPolicy(): Promise<ReportPolicy> {
  const value = (await browser.storage.local.get(REPORT_POLICY))[REPORT_POLICY] as Partial<ReportPolicy> | undefined;
  return { autoSync: value?.autoSync === true, reported: value?.reported ?? {}, requests: value?.requests ?? {} };
}
let writing: Promise<unknown> = Promise.resolve();
function update(change: (policy: ReportPolicy) => void): Promise<void> {
  const next = writing.then(async () => {
    const policy = await readReportPolicy();
    change(policy);
    await browser.storage.local.set({ [REPORT_POLICY]: policy });
  });
  writing = next.catch(() => {});
  return next;
}
export function setAutoReport(autoSync: boolean) {
  return update(policy => { policy.autoSync = autoSync; });
}
export function requestReport(id: string) {
  return update(policy => { policy.requests[id] ??= crypto.randomUUID(); });
}
export function finishReport(id: string, ticket?: string) {
  return update(policy => {
    if (ticket && policy.requests[id] === ticket) {
      delete policy.requests[id];
      policy.reported[id] = Date.now();
    } else if (policy.reported[id]) policy.reported[id] = Date.now();
  });
}
export function canReport(policy: ReportPolicy, id: string): boolean {
  return Boolean(policy.requests[id] || (policy.autoSync && policy.reported[id]));
}
export function migrateReportAliases(id: string, aliases: string[]) {
  return update(policy => {
    for (const alias of aliases) {
      if (alias === id) continue;
      if (policy.reported[alias]) policy.reported[id] = Math.max(policy.reported[id] ?? 0, policy.reported[alias]!);
      if (policy.requests[alias]) policy.requests[id] ??= policy.requests[alias]!;
      delete policy.reported[alias];
      delete policy.requests[alias];
    }
  });
}
