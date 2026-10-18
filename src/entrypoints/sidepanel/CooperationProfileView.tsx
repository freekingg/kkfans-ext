import { AtSign, Check, Copy, LoaderCircle, Save, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiProfileSuggestions, CooperationProfile } from '../../core/types';
import { copyCooperationSpreadsheetRow } from '../../business/cooperation-spreadsheet';
import { COOPERATION_ADDITION_SOURCES, normalizeAdditionSource } from '../../business/addition-sources';

interface CooperationProfileViewProps {
  conversationId: string | null;
  conversationTitle: string;
  createdAt: number | null;
  lastMessageAt?: number | null;
  hasHistoryStart?: boolean;
  operatorName: string;
  ownWhatsapp: string;
  note: string;
  profile: CooperationProfile | null;
  suggestions: Partial<AiProfileSuggestions>;
  onSave: (profile: CooperationProfile) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveSuccess?: () => void;
}

type SuggestionField = 'instagramProfileUrl' | 'country' | 'finalPrice' | 'publishedUrl';

const SUGGESTION_FIELDS = new Set<SuggestionField>([
  'instagramProfileUrl',
  'country',
  'finalPrice',
  'publishedUrl',
]);

const SUGGESTION_LABELS: Record<SuggestionField, string> = {
  instagramProfileUrl: 'IG 主页',
  country: '国家',
  finalPrice: '最终价格',
  publishedUrl: '发布链接',
};

function emptyProfile(contactWhatsapp: string): CooperationProfile {
  return {
    contactWhatsapp,
    platformAccount: '',
    additionSource: '',
    invitationUrl: '',
    followerData: '',
    instagramUsername: '',
    instagramProfileUrl: '',
    country: '',
    finalPrice: '',
    specialStatus: null,
    nextFollowUpAt: null,
    registeredDate: '',
    publishedDate: '',
    publishedUrl: '',
    updatedAt: 0,
  };
}

export function CooperationProfileView({
  conversationId,
  conversationTitle,
  createdAt,
  lastMessageAt,
  hasHistoryStart,
  operatorName,
  ownWhatsapp,
  note,
  profile,
  suggestions,
  onSave,
  onDirtyChange,
  onSaveSuccess,
}: CooperationProfileViewProps) {
  const [draft, setDraft] = useState<CooperationProfile>(() => profile ?? emptyProfile(conversationTitle));
  const baselineRef = useRef(JSON.stringify(profile ?? emptyProfile(conversationTitle)));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const nextDraft = profile ?? emptyProfile(conversationTitle);
    baselineRef.current = JSON.stringify(nextDraft);
    setDraft(nextDraft);
    onDirtyChange?.(false);
    setNotice('');
    // 只在切换会话时重置，避免后台定时刷新覆盖用户正在编辑的内容。
  }, [conversationId]);

  useEffect(() => {
    onDirtyChange?.(JSON.stringify(draft) !== baselineRef.current);
  }, [draft, onDirtyChange]);

  const availableSuggestions = useMemo(() => Object.entries(suggestions)
    .filter((entry): entry is [SuggestionField, string] =>
      SUGGESTION_FIELDS.has(entry[0] as SuggestionField)
      && typeof entry[1] === 'string'
      && Boolean(entry[1].trim()))
    .filter(([field, value]) => String(draft[field] ?? '') !== value), [draft, suggestions]);

  function update<K extends keyof CooperationProfile>(field: K, value: CooperationProfile[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice('');
  }

  function applySuggestion(field: SuggestionField, value: string) {
    update(field, value);
  }

  async function save() {
    if (!conversationId || saving) return;
    setSaving(true);
    setNotice('');
    try {
      await onSave(draft);
      baselineRef.current = JSON.stringify(draft);
      onDirtyChange?.(false);
      setNotice('合作资料已保存并进入云端同步队列');
      onSaveSuccess?.();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '合作资料保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function copySpreadsheetRow() {
    if (!conversationId) return;
    setNotice('');
    try {
      await copyCooperationSpreadsheetRow(ownWhatsapp, draft, note);
      setNotice('已复制一行表格数据，可直接粘贴到对应表格中');
    } catch {
      setNotice('复制失败，请检查浏览器剪贴板权限');
    }
  }

  return (
    <section className="profile-view">
      <div className="profile-identity-card">
        <div className="profile-identity-icon"><AtSign size={20} /></div>
        <div>
          <span className="eyebrow">当前合作对象</span>
          <strong>{draft.contactWhatsapp || conversationTitle || '尚未选择会话'}</strong>
          <small>{operatorName || '未配置人员'} · {ownWhatsapp || '未配置我方 WhatsApp'}</small>
        </div>
      </div>

      {availableSuggestions.length ? (
        <section className="profile-suggestions-card">
          <div className="profile-suggestions-heading"><Sparkles size={15} /><div><strong>发现 {availableSuggestions.length} 项可补充资料</strong><span>点击单项填入，保存前仍可修改</span></div></div>
          <div className="profile-suggestion-list">
            {availableSuggestions.map(([field, value]) => (
              <button key={field} onClick={() => applySuggestion(field, value)}>
                <span><b>{SUGGESTION_LABELS[field]}</b><small>{value}</small></span><Check size={14} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="profile-form-card">
        <div className="section-heading"><div><span className="eyebrow">基础资料</span><h3>博主与合作信息</h3></div></div>
        <div className="profile-form-grid">
          <label className="profile-field wide"><span>博主 WhatsApp</span><input value={draft.contactWhatsapp} maxLength={64} onChange={(event) => update('contactWhatsapp', event.target.value)} placeholder="默认使用当前对话名称" /></label>
          <label className="profile-field wide"><span>平台账号</span><input value={draft.platformAccount} maxLength={120} onChange={(event) => update('platformAccount', event.target.value)} placeholder="填写博主在推广平台使用的账号" /></label>
          <label className="profile-field wide"><span>邀请链接</span><input type="url" value={draft.invitationUrl} maxLength={2000} onChange={(event) => update('invitationUrl', event.target.value)} placeholder="填写发给博主的注册或推广邀请链接" /></label>
          <label><span>国家</span><input value={draft.country} maxLength={80} onChange={(event) => update('country', event.target.value)} placeholder="例如：墨西哥" /></label>
          <label><span>添加来源</span><select value={draft.additionSource ?? ''} onChange={(event) => update('additionSource', normalizeAdditionSource(event.target.value))}>
            <option value="">未选择</option>
            {COOPERATION_ADDITION_SOURCES.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select></label>
          <label className="profile-field wide"><span>IG 主页链接（自动提取主页账号）</span><input type="url" value={draft.instagramProfileUrl} maxLength={2000} onChange={(event) => update('instagramProfileUrl', event.target.value)} placeholder="https://www.instagram.com/creator/" /></label>
          <label className="profile-field wide"><span>最终价格</span><input value={draft.finalPrice} maxLength={100} onChange={(event) => update('finalPrice', event.target.value)} placeholder="例如：400 MXN" /></label>
          <label className="profile-field wide"><span>粉丝数据</span><textarea value={draft.followerData} maxLength={4000} rows={4} onChange={(event) => update('followerData', event.target.value)} placeholder={'例如：\n53 posts\n89.1K followers\n320 following'} /></label>
        </div>
      </section>

      <section className="profile-form-card">
        <div className="section-heading"><div><span className="eyebrow">发布记录</span><h3>发布信息</h3></div></div>
        <div className="profile-form-grid">
          <label className="profile-field wide"><span>发布链接</span><input type="url" value={draft.publishedUrl} maxLength={2000} onChange={(event) => update('publishedUrl', event.target.value)} placeholder="Instagram Reel 或帖子链接" /></label>
        </div>
        <div className="profile-created-at"><span>创建时间（首条消息）</span><strong>{formatMessageTime(createdAt)}</strong></div>
        <div className="profile-created-at"><span>更新时间（最新消息）</span><strong>{formatMessageTime(lastMessageAt)}</strong></div>
        <p className="profile-save-notice">北京时间 · {hasHistoryStart ? '已到当前设备最早可见消息' : '首聊待确认：补齐历史后日期可能前移'}</p>
      </section>

      <div className="profile-actions">
        <button className="profile-copy-button" title="列顺序：我方 WhatsApp、IG 主页、博主 WhatsApp、平台账号、邀请链接、报价、粉丝数据、备注" disabled={!conversationId} onClick={() => void copySpreadsheetRow()}>
          <Copy size={16} />复制表格行
        </button>
        <button className="profile-save-button" disabled={!conversationId || saving} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? '保存中…' : '保存合作资料'}
        </button>
      </div>
      {notice ? <p className="profile-save-notice">{notice}</p> : null}
    </section>
  );
}

function formatMessageTime(value: number | null | undefined): string {
  return value == null ? '未知' : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
