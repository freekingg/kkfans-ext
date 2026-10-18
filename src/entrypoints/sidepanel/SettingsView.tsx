import {
  BrainCircuit,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Play,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  AiSettings,
} from '../../core/types';

export type SettingsSection = 'ai';

interface SettingsViewProps {
  focusSection: SettingsSection;
  aiDraft: AiSettings;
  aiConfigured: boolean;
  aiTesting: boolean;
  aiNotice: string;
  aiNoticeTone: 'info' | 'success' | 'error';
  onAiChange: (field: keyof AiSettings, value: string) => void;
  onSaveAi: () => void;
  onTestAi: () => void;
}

export function SettingsView({
  focusSection,
  aiDraft,
  aiConfigured,
  aiTesting,
  aiNotice,
  aiNoticeTone,
  onAiChange,
  onSaveAi,
  onTestAi,
}: SettingsViewProps) {
  const aiRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const sections = { ai: aiRef };
    const target = sections[focusSection].current;
    window.setTimeout(() => target?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [focusSection]);

  return (
    <section className="settings-view">
      <div className="settings-intro">
        <div className="settings-intro-icon"><SlidersHorizontal size={19} /></div>
        <div>
          <h2>集中管理工作环境</h2>
          <p>这些设置只需配置一次，日常操作回到概览完成。</p>
        </div>
      </div>

      <section ref={aiRef} className={`settings-card ai-settings-card ${focusSection === 'ai' ? 'focused' : ''}`}>
        <div className="section-heading">
          <div><span className="eyebrow">OpenAI Compatible</span><h3>AI 模型</h3></div>
          <span className={`config-pill ${aiConfigured ? 'ready' : 'needed'}`}>{aiConfigured ? '已配置' : '待配置'}</span>
        </div>
        <p className="settings-description">兼容 OpenAI Chat Completions 协议，可连接 DeepSeek 等模型厂商。</p>
        <div className="settings-form">
          <label><span>接口地址</span><input value={aiDraft.baseUrl} onChange={(event) => onAiChange('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label><span>API Key</span><input type="password" value={aiDraft.apiKey} onChange={(event) => onAiChange('apiKey', event.target.value)} placeholder="输入厂商密钥" autoComplete="off" /></label>
          <label><span>模型名称</span><input value={aiDraft.model} onChange={(event) => onAiChange('model', event.target.value)} placeholder="例如：deepseek-chat" /></label>
        </div>
        <div className="settings-actions">
          <button className="cloud-button secondary" onClick={onTestAi} disabled={aiTesting}>{aiTesting ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}测试连接</button>
          <button className="cloud-button" onClick={onSaveAi} disabled={aiTesting}><Save size={15} />保存配置</button>
        </div>
        {aiTesting ? (
          <div className="ai-test-result testing" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={16} />
            <div><strong>正在测试连接</strong><span>正在请求 {aiDraft.model.trim() || '当前模型'}，请稍候…</span></div>
          </div>
        ) : aiNotice ? (
          <div className={`ai-test-result ${aiNoticeTone}`} role={aiNoticeTone === 'error' ? 'alert' : 'status'} aria-live="polite">
            {aiNoticeTone === 'error' ? <CircleAlert size={16} /> : aiNoticeTone === 'success' ? <CircleCheck size={16} /> : <BrainCircuit size={16} />}
            <div><strong>{aiNoticeTone === 'error' ? '连接失败' : aiNoticeTone === 'success' ? '连接正常' : '配置提示'}</strong><span>{aiNotice}</span></div>
          </div>
        ) : null}
      </section>

      <div className="settings-footnote">配置与会话资料保存在当前浏览器，不再自动上报。</div>
    </section>
  );
}
