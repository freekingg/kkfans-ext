import { useEffect, useRef, useState } from 'react';
import { Cloud, LoaderCircle, X } from 'lucide-react';
import type { CloudSettings } from '../../core/types';

interface Props {
  account: CloudSettings;
  onConfirm: (account: CloudSettings) => Promise<void>;
  onCancel: () => void;
}

export function CloudAccountConfirmDialog({ account, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  async function confirm() {
    if (!checked || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await onConfirm({ ...account });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号保存失败，请重试');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="account-confirm-dialog" aria-labelledby="account-confirm-title"
      aria-describedby="account-confirm-description" onCancel={(event) => {
        event.preventDefault();
        if (!submitting.current) onCancel();
      }}>
      <header className="account-confirm-heading">
        <span className="account-confirm-icon"><Cloud size={21} /></span>
        <h2 id="account-confirm-title">确认云端账号</h2>
        <button className="icon-button" type="button" aria-label="关闭账号确认" disabled={saving} onClick={onCancel}><X size={18} /></button>
      </header>
      <p id="account-confirm-description">请核对操作员和本浏览器登录的 WhatsApp 账号，避免聊天资料同步到错误的数据空间。</p>
      <dl className="account-confirm-details">
        <div><dt>用户名</dt><dd>{account.username}</dd></div>
        <div><dt>WhatsApp 账号</dt><dd>{account.whatsappAccount}</dd></div>
      </dl>
      <p className="account-confirm-warning">确认后将保存配置并恢复此账号的云端资料。默认手动上报，请在当前会话点击“上报”上传。请勿填写聊天对方的号码。</p>
      <label className="account-confirm-check">
        <input type="checkbox" checked={checked} disabled={saving} onChange={(event) => setChecked(event.target.checked)} />
        <span>我已核对，以上是当前操作员和我方 WhatsApp 账号</span>
      </label>
      {error ? <p className="cloud-error" role="alert">{error}</p> : null}
      <div className="settings-actions">
        <button type="button" className="cloud-button secondary" disabled={saving} onClick={onCancel}>返回修改</button>
        <button type="button" className="cloud-button" disabled={!checked || saving} onClick={() => void confirm()}>
          {saving ? <LoaderCircle size={15} className="spin" /> : null}{saving ? '正在保存…' : '确认账号并同步'}
        </button>
      </div>
    </dialog>
  );
}
