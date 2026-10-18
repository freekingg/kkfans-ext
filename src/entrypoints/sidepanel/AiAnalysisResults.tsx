import { Check, CircleAlert, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AiAnalysisResult, ConversationSopStage } from '../../core/types';
import { getSopStageTitle } from '../../sop/stages';

interface AiAnalysisResultsProps {
  result: AiAnalysisResult;
  confirmedStage: ConversationSopStage | null;
  onConfirmStage: () => Promise<void>;
  onCopyReply: (text: string) => Promise<boolean>;
}

export function AiAnalysisResults({ result, confirmedStage, onConfirmStage, onCopyReply }: AiAnalysisResultsProps) {
  const [copyState, setCopyState] = useState<{ index: number; ok: boolean } | null>(null);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  async function copyReply(index: number, text: string) {
    const ok = await onCopyReply(text);
    setCopyState({ index, ok });
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState(null), 1800);
  }

  return (
    <div className="ai-results">
      <div className="ai-stage-card">
        <div>
          <span>AI 判断阶段</span>
          <strong>{result.stageId ? getSopStageTitle(result.stageId) : '证据不足'}</strong>
          {result.sopKnowledgeVersion ? <small>SOP {result.sopKnowledgeVersion}</small> : null}
          <p className="ai-confidence-note">基于聊天证据的阶段判断把握度，仅供参考，不代表成交概率。</p>
        </div>
        <div className="ai-confidence" title="AI 对当前 SOP 阶段判断的把握程度">
          <b>{Math.round(result.confidence * 100)}%</b>
          <small>判断置信度</small>
        </div>
      </div>
      {result.stageId ? (
        <div className={`stage-confirmation ${confirmedStage?.stageId === result.stageId ? 'confirmed' : 'suggested'}`}>
          <div>
            <span>{confirmedStage ? '当前人工确认阶段' : '当前尚未确认阶段'}</span>
            <strong>{getSopStageTitle(confirmedStage?.stageId ?? null)}</strong>
          </div>
          {confirmedStage?.stageId === result.stageId ? (
            <span className="stage-confirmed-mark"><Check size={14} />已确认</span>
          ) : (
            <button onClick={() => void onConfirmStage()}><Check size={14} />确认 AI 建议</button>
          )}
        </div>
      ) : null}

      <div className="ai-result-card">
        <span className="eyebrow">沟通摘要</span>
        <p>{result.summary || '暂无摘要'}</p>
        {result.intent ? <div className="ai-intent"><b>对方意图</b>{result.intent}</div> : null}
      </div>

      {result.evidence.length ? (
        <div className="ai-result-card">
          <span className="eyebrow">判断依据</span>
          <ul>{result.evidence.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </div>
      ) : null}

      {result.risks.length ? (
        <div className="ai-result-card risk">
          <span className="eyebrow">风险与缺口</span>
          <ul>{result.risks.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </div>
      ) : null}

      {result.nextActions.length ? (
        <div className="ai-result-card next">
          <span className="eyebrow">建议下一步</span>
          <ol>{result.nextActions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol>
        </div>
      ) : null}

      {result.replySuggestions.length ? (
        <div className="reply-section">
          <span className="eyebrow">建议回复</span>
          {result.replySuggestions.map((reply, index) => (
            <article className="reply-card" key={`${reply.text}-${index}`}>
              <p className="reply-original" lang={reply.language}>{reply.text}</p>
              {reply.translation ? (
                <div className="reply-translation">
                  <span>中文对照</span>
                  <p lang="zh-CN">{reply.translation}</p>
                </div>
              ) : null}
              {reply.reason ? <small>{reply.reason}</small> : null}
              <button
                className={copyState?.index === index ? (copyState.ok ? 'copied' : 'copy-failed') : ''}
                onClick={() => void copyReply(index, reply.text)}
                aria-live="polite"
              >
                {copyState?.index === index ? (copyState.ok ? <Check size={15} /> : <CircleAlert size={15} />) : <Copy size={15} />}
                {copyState?.index === index ? (copyState.ok ? '已复制' : '复制失败') : '复制回复'}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
