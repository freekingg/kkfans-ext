import { LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import type { CloudSettings } from '../../core/types';
import { validateCloudSettings } from '../../storage/settings';

interface RequiredAccountSetupProps {
  draft: CloudSettings;
  onChange: (field: keyof CloudSettings, value: string) => void;
  onSave: () => void;
}

export function RequiredAccountSetup({
  draft,
  onChange,
  onSave,
}: RequiredAccountSetupProps) {
  const validationError = validateCloudSettings(draft);

  return (
    <section className="required-account-setup" aria-label="账号配置">
      <div className="required-setup-icon"><LockKeyhole size={25} /></div>
      <span className="required-setup-badge"><ShieldCheck size={13} />必须完成</span>
      <h2>配置账号数据空间</h2>
      <p>用户名和 WhatsApp 账号用于隔离你的聊天数据。完成配置后才能使用插件功能。</p>

      <div className="required-setup-form">
        <label>
          <span>用户名 <b>*</b></span>
          <input
            value={draft.username}
            onChange={(event) => onChange('username', event.target.value)}
            placeholder="例如：king"
            maxLength={64}
            autoFocus
          />
        </label>
        <label>
          <span>WhatsApp 账号 <b>*</b></span>
          <input
            value={draft.whatsappAccount}
            onChange={(event) => onChange('whatsappAccount', event.target.value.replace(/\s/g, ''))}
            onKeyDown={(event) => {
              if (event.key === ' ') event.preventDefault();
              if (event.key === 'Enter' && !validationError) onSave();
            }}
            placeholder="例如：+521234567890"
            inputMode="tel"
            autoComplete="off"
            maxLength={32}
          />
          <small>不允许空格，建议填写“+国家代码+手机号”</small>
        </label>
      </div>

      <p className={`required-setup-validation ${validationError ? 'error' : 'ready'}`}>
        {validationError ?? '配置完整，可以启用插件'}
      </p>
      <button type="button" disabled={Boolean(validationError)} onClick={onSave}>
        <Save size={16} />保存并启用插件
      </button>
    </section>
  );
}
