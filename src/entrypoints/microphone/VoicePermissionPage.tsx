import { useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Mic, RefreshCw } from 'lucide-react';
import { microphoneErrorMessage, testMicrophoneAccess } from '../../translation/voice-permission';
import { AI_TRANSLATION_URL } from '../../translation/fastgpt';

export function VoicePermissionPage() {
  const [state, setState] = useState<'idle' | 'checking' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  async function authorize() {
    setState('checking');
    setError('');
    try {
      await testMicrophoneAccess();
      setState('success');
    } catch (cause) {
      setError(microphoneErrorMessage(cause));
      setState('error');
    }
  }
  return <main className="voice-setup">
    <iframe key={revision} src={AI_TRANSLATION_URL} title="FastGPT 语音授权验证" allow="microphone https://cloud.fastgpt.io; clipboard-write" referrerPolicy="no-referrer" />
    <footer className="voice-footer">
      <div className="voice-feedback">
        {state === 'checking' ? <p role="status">请在浏览器提示中允许麦克风…</p> : null}
        {state === 'success' ? <p className="success" role="status">插件麦克风可用，请返回面板刷新。</p> : null}
        {state === 'error' ? <p className="error" role="alert">{error}</p> : null}
      </div>
      <div className="voice-actions">
        <button onClick={() => void authorize()} disabled={state === 'checking'} aria-label="检查麦克风权限"
          title="检查麦克风权限（不录制、不上传）">
          {state === 'checking' ? <LoaderCircle size={16} className="spin" /> : state === 'success' ? <Check size={16} /> : <Mic size={16} />}
        </button>
        <button onClick={() => setRevision(value => value + 1)} aria-label="刷新页面" title="刷新页面"><RefreshCw size={15} /></button>
        <a href={AI_TRANSLATION_URL} target="_blank" rel="noopener noreferrer" aria-label="独立打开 FastGPT" title="独立打开 FastGPT"><ExternalLink size={15} /></a>
      </div>
    </footer>
  </main>;
}
