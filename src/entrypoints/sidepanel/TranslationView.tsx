import { ExternalLink, Languages, LoaderCircle, Mic, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { QuickTranslationView } from './QuickTranslationView';

import { AI_TRANSLATION_URL } from '../../translation/fastgpt';
import { voiceSetupUrl } from '../../translation/voice-permission';
export { AI_TRANSLATION_URL } from '../../translation/fastgpt';

function AiTranslationView() {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [loading, revision]);
  return (
    <section className="ai-translation-view">
      <div className="ai-translation-toolbar">
        <div><strong>AI 翻译</strong></div>
        <div className="ai-translation-actions">
          <button type="button" onClick={() => { setLoading(true); setSlow(false); setRevision(value => value + 1); }} title="重新加载 AI 翻译页面"><RefreshCw size={14} />刷新</button>
          <a href={AI_TRANSLATION_URL} target="_blank" rel="noopener noreferrer" title="在新窗口打开 AI 翻译"><ExternalLink size={14} />新窗口</a>
        </div>
      </div>
      <div className="ai-translation-frame-shell">
        {loading && !slow ? <div className="ai-translation-loading" role="status"><LoaderCircle size={18} className="spin" />正在加载 AI 翻译…</div> : null}
        <iframe key={revision} src={AI_TRANSLATION_URL} title="FastGPT AI 翻译" referrerPolicy="no-referrer"
          allow="clipboard-write; microphone https://cloud.fastgpt.io" onLoad={() => { setLoading(false); setSlow(false); }} onError={() => { setLoading(false); setSlow(true); }} />
      </div>
      <div className="ai-translation-footer">
        {slow ? <p className="ai-translation-hint warning" role="status">页面加载较慢或不可用，请刷新或在新窗口打开。</p> : null}
        <a className="voice-check-icon" href={voiceSetupUrl(window.location.href)} target="_blank" rel="noopener noreferrer"
          aria-label="检查麦克风权限" title="检查麦克风权限（新标签页）"><Mic size={16} /></a>
      </div>
    </section>
  );
}

export function TranslationView() {
  const [mode, setMode] = useState<'quick' | 'ai'>('quick');
  const [openedAi, setOpenedAi] = useState(false);
  return (
    <section className="translation-workspace">
      <div className="translation-mode-switch" role="tablist" aria-label="翻译方式">
        <button id="quick-translation-tab" type="button" role="tab" aria-selected={mode === 'quick'} aria-controls="quick-translation-panel"
          onClick={() => setMode('quick')}><Languages size={16} />快速翻译</button>
        <button id="ai-translation-tab" type="button" role="tab" aria-selected={mode === 'ai'} aria-controls="ai-translation-panel"
          onClick={() => { setOpenedAi(true); setMode('ai'); }}><Sparkles size={16} />AI 翻译</button>
      </div>
      <div id="quick-translation-panel" role="tabpanel" aria-labelledby="quick-translation-tab" hidden={mode !== 'quick'}><QuickTranslationView /></div>
      <div id="ai-translation-panel" role="tabpanel" aria-labelledby="ai-translation-tab" hidden={mode !== 'ai'}>
        {openedAi ? <AiTranslationView /> : null}
      </div>
    </section>
  );
}
