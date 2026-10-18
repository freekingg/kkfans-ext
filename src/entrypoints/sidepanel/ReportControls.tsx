import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { CloudUpload, LoaderCircle } from 'lucide-react';
import { readReportPolicy, REPORT_POLICY, setAutoReport, type ReportPolicy } from '../../cloud/report-policy';
import type { CloudSyncState } from '../../core/types';

function useReportPolicy() {
  const [policy, setPolicy] = useState<ReportPolicy>({ autoSync: false, reported: {}, requests: {} });
  useEffect(() => {
    let active = true;
    const refresh = () => { void readReportPolicy().then(value => { if (active) setPolicy(value); }); };
    const listener = (changes: Record<string, unknown>) => { if (changes[REPORT_POLICY]) refresh(); };
    refresh();
    browser.storage.onChanged.addListener(listener);
    return () => { active = false; browser.storage.onChanged.removeListener(listener); };
  }, []);
  return policy;
}

export function ReportPreference() {
  const policy = useReportPolicy();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <div className="report-preference">
    <label>
      <span><strong>首次上报后自动同步</strong><small>默认关闭，每次修改后需手动上报。开启后，仅自动同步在本机手动上报成功过的会话。</small></span>
      <input type="checkbox" role="switch" checked={policy.autoSync} disabled={saving} onChange={async event => {
        setSaving(true); setError('');
        try { await setAutoReport(event.target.checked); }
        catch { setError('保存失败，请重试'); }
        finally { setSaving(false); }
      }} />
    </label>
    <small aria-live="polite">{error || (saving ? '保存中…' : '立即生效 · 开关已保存')}</small>
  </div>;
}

export function ConversationReport({ conversationId, disabled, sync, beforeReport }: {
  conversationId: string | undefined;
  disabled: boolean;
  sync: CloudSyncState;
  beforeReport: () => Promise<void>;
}) {
  const policy = useReportPolicy();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); }, [conversationId]);
  const requested = Boolean(conversationId && policy.requests[conversationId]);
  const lastReported = conversationId ? policy.reported[conversationId] : undefined;
  const failed = requested && sync.status === 'error';
  const busy = submitting || (requested && !failed);
  return <div className="conversation-report">
    <div className="conversation-report-copy" aria-live="polite">
      <strong>{busy ? '正在上报当前会话…' : failed ? '上报未完成' : lastReported ? '已上报' : '手动上报'}</strong>
      <small>{lastReported
        ? `上次：${new Date(lastReported).toLocaleString()} · ${policy.autoSync ? '后续自动同步' : '修改后需再次上报'}`
        : '点击后上传当前会话已读取的消息、标签和合作资料'}</small>
    </div>
    <button className="report-button" disabled={disabled || !conversationId || busy} onClick={async () => {
      if (!conversationId) return;
      const id = conversationId;
      setSubmitting(true); setError('');
      try {
        await beforeReport();
        const result = await browser.runtime.sendMessage({ type: 'cloud:report', conversationId: id });
        if (!result?.ok) throw new Error(result?.error || '上报未启动，请重试');
      } catch (cause) { setError(cause instanceof Error ? cause.message : '上报失败'); }
      finally { setSubmitting(false); }
    }}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <CloudUpload size={17} />}
      {busy ? '上报中…' : failed ? '重试上报' : lastReported ? '再次上报' : '上报'}
    </button>
    {error || failed ? <p className="cloud-error" role="alert">{error || sync.error}</p> : null}
  </div>;
}
