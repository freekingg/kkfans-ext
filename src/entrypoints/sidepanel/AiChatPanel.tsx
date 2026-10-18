import { Check, CircleAlert, Copy, LoaderCircle, MessageCircleMore, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AiChatTurn } from '../../core/types';

const QUICK_QUESTIONS = [
  '客户现在最关心什么？',
  '我下一步应该怎么回复？',
  '判断对方的合作意向',
  '生成一条西语跟进消息',
];

interface AiChatPanelProps {
  turns: AiChatTurn[];
  question: string;
  loading: boolean;
  messageCount: number;
  onQuestionChange: (value: string) => void;
  onSubmit: (question: string) => void;
  onCopy: (text: string) => Promise<boolean>;
}

export function AiChatPanel({
  turns,
  question,
  loading,
  messageCount,
  onQuestionChange,
  onSubmit,
  onCopy,
}: AiChatPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<{ turnId: string; ok: boolean } | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, loading]);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copyAnswer(turnId: string, text: string) {
    const ok = await onCopy(text);
    setCopyState({ turnId, ok });
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState(null), 1800);
  }

  function submit() {
    const value = question.trim();
    if (!value || loading) return;
    onSubmit(value);
  }

  return (
    <section className="ai-chat-panel">
      <div className="section-heading ai-chat-heading">
        <div><span className="eyebrow">继续追问</span><h3>向 AI 询问当前聊天</h3></div>
        <MessageCircleMore size={18} />
      </div>
      <p className="ai-chat-context"><Sparkles size={13} />每次提问都会带上当前会话的 {Math.min(messageCount, 120)} 条最近消息和已有分析。</p>

      {turns.length === 0 ? (
        <div className="ai-chat-empty">
          <strong>你可以直接问任何问题</strong>
          <span>例如判断客户意图、查找聊天事实，或者生成可直接发送的回复。</span>
        </div>
      ) : (
        <div className="ai-chat-history" aria-live="polite">
          {turns.map((turn) => (
            <article className={`ai-chat-bubble ${turn.role}`} key={turn.id}>
              <span>{turn.role === 'user' ? '我' : `AI${turn.sopKnowledgeVersion ? ` · ${turn.sopKnowledgeVersion}` : ''}`}</span>
              <p>{turn.content}</p>
              {turn.role === 'assistant' ? (
                <button
                  className={copyState?.turnId === turn.id ? (copyState.ok ? 'copied' : 'copy-failed') : ''}
                  onClick={() => void copyAnswer(turn.id, turn.content)}
                  aria-label="复制 AI 回答"
                  aria-live="polite"
                >
                  {copyState?.turnId === turn.id ? (copyState.ok ? <Check size={14} /> : <CircleAlert size={14} />) : <Copy size={14} />}
                  {copyState?.turnId === turn.id ? (copyState.ok ? '已复制' : '复制失败') : '复制'}
                </button>
              ) : null}
            </article>
          ))}
          {loading ? <div className="ai-chat-thinking"><LoaderCircle className="spin" size={15} />正在结合聊天上下文思考…</div> : null}
          <div ref={endRef} />
        </div>
      )}

      <div className="quick-question-list">
        {QUICK_QUESTIONS.map((item) => <button key={item} onClick={() => onSubmit(item)} disabled={loading || messageCount === 0}>{item}</button>)}
      </div>

      <form className="ai-chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="输入你想问的问题…"
          rows={3}
          maxLength={4000}
          disabled={loading}
          aria-label="向 AI 提问"
        />
        <button type="submit" disabled={!question.trim() || loading || messageCount === 0} aria-label="发送问题">
          {loading ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
        </button>
      </form>
      <small className="composer-hint">Enter 发送，Shift + Enter 换行</small>
    </section>
  );
}
