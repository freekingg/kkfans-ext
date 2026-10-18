import { ArrowRightLeft, Check, Copy, History, Languages, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { translateWithGoogleFree } from '../../translation/google-free-client';
import {
  addTranslationHistory,
  deleteTranslationHistory,
  getTranslationHistory,
  type TranslationHistoryEntry,
} from '../../storage/translation-history';

export function QuickTranslationView() {
  const [source, setSource] = useState<'zh-CN' | 'es'>('zh-CN');
  const [target, setTarget] = useState<'zh-CN' | 'es'>('es');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<TranslationHistoryEntry[]>([]);

  useEffect(() => {
    let active = true;
    void getTranslationHistory().then((entries) => {
      if (active) setHistory(entries);
    });
    return () => { active = false; };
  }, []);

  const translate = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setNotice('');
    setCopied(false);
    try {
      const translated = await translateWithGoogleFree(input, source, target);
      setOutput(translated);
      setHistory(await addTranslationHistory({
        source,
        target,
        input,
        output: translated,
      }));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : '翻译失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const swapLanguages = () => {
    setSource(target);
    setTarget(source);
    setOutput('');
    setNotice('');
    setCopied(false);
  };

  const copyResult = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const restoreHistory = (entry: TranslationHistoryEntry) => {
    setSource(entry.source);
    setTarget(entry.target);
    setInput(entry.input);
    setOutput(entry.output);
    setNotice('');
    setCopied(false);
  };

  const removeHistory = async (id: string) => {
    setHistory(await deleteTranslationHistory(id));
  };

  const languageName = (value: 'zh-CN' | 'es') => value === 'zh-CN' ? '中文' : '西班牙语';
  const formatHistoryTime = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);

  return (
    <section className="translation-view">
      <div className="translation-toolbar">
        <div className="translation-toolbar-heading">
          <span className="translation-toolbar-icon"><Languages size={17} /></span>
          <span><strong>快速翻译</strong></span>
        </div>
        <div className="translation-language-row">
          <strong>{source === 'zh-CN' ? '中文' : '西班牙语'}</strong>
          <button type="button" onClick={swapLanguages} aria-label="交换翻译语言"><ArrowRightLeft size={15} /></button>
          <strong>{target === 'es' ? '西班牙语' : '中文'}</strong>
        </div>
      </div>
      <div className="translation-card">
        <div className="translation-field-heading">
          <span>{source === 'zh-CN' ? '中文原文' : 'Texto en español'}</span>
          <button type="button" disabled={!input} onClick={() => { setInput(''); setOutput(''); setNotice(''); }}><Trash2 size={13} />清空</button>
        </div>
        <textarea
          value={input}
          autoFocus
          placeholder={source === 'zh-CN' ? '输入或粘贴需要翻译的中文……' : 'Escribe o pega el texto en español…'}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void translate();
            }
          }}
        />
        <div className="translation-action-row">
          <span>{input.length} 字符 · Enter 翻译 · Shift+Enter 换行</span>
          <button type="button" className="translation-submit" disabled={!input.trim() || loading} onClick={() => void translate()}>
            {loading ? <LoaderCircle className="spin" size={15} /> : <Languages size={15} />}{loading ? '翻译中…' : '翻译'}
          </button>
        </div>
      </div>
      <div className="translation-card translation-result-card">
        <div className="translation-field-heading">
          <span>{target === 'es' ? 'Traducción al español' : '中文翻译'}</span>
          <button
            type="button"
            className={`translation-copy-button ${copied ? 'copied' : ''}`}
            disabled={!output}
            onClick={() => void copyResult()}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制译文'}
          </button>
        </div>
        <textarea value={output} readOnly placeholder="翻译结果会显示在这里" />
        {notice ? <p className="translation-notice error">{notice}</p> : null}
      </div>
      <p className="translation-quota-note">长文本会自动分段翻译；请求过快时 Google 可能临时限制当前网络。</p>
      <section className="translation-history-section">
        <div className="translation-history-heading">
          <span><History size={15} /><strong>最近翻译</strong></span>
          <small>{history.length}/50</small>
        </div>
        {history.length ? (
          <div className="translation-history-list">
            {history.map((entry) => (
              <article className="translation-history-item" key={entry.id}>
                <button type="button" className="translation-history-content" onClick={() => restoreHistory(entry)} title="载入这条翻译">
                  <span className="translation-history-meta">
                    <b>{languageName(entry.source)} → {languageName(entry.target)}</b>
                    <time>{formatHistoryTime(entry.createdAt)}</time>
                  </span>
                  <span className="translation-history-text source">{entry.input}</span>
                  <span className="translation-history-text target">{entry.output}</span>
                </button>
                <button type="button" className="translation-history-delete" onClick={() => void removeHistory(entry.id)} title="删除记录" aria-label="删除这条翻译记录"><Trash2 size={14} /></button>
              </article>
            ))}
          </div>
        ) : (
          <div className="translation-history-empty">翻译成功后会自动保存在这里</div>
        )}
      </section>
    </section>
  );
}
