import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AiAnalysisResult, AiChatTurn } from '../../core/types';
import { AiAnalysisResults } from './AiAnalysisResults';
import { AiChatPanel } from './AiChatPanel';

describe('AI 复制反馈', () => {
  it('复制建议回复后应在当前按钮显示成功反馈', async () => {
    const onCopyReply = vi.fn().mockResolvedValue(true);
    const result: AiAnalysisResult = {
      summary: '摘要',
      stageId: '06',
      confidence: 0.9,
      intent: '议价',
      evidence: [],
      risks: [],
      nextActions: [],
      replySuggestions: [{ language: 'es', text: 'Podemos hablarlo.', translation: '我们可以谈谈。', reason: '继续沟通' }],
      model: 'chat',
      usage: null,
      analyzedAt: '2026-08-29T00:00:00.000Z',
    };

    render(
      <AiAnalysisResults
        result={result}
        confirmedStage={null}
        onConfirmStage={vi.fn().mockResolvedValue(undefined)}
        onCopyReply={onCopyReply}
      />,
    );
    expect(screen.getByText('中文对照')).toBeInTheDocument();
    expect(screen.getByText('我们可以谈谈。')).toBeInTheDocument();
    expect(screen.getByText('判断置信度')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制回复' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument());
    expect(onCopyReply).toHaveBeenCalledWith('Podemos hablarlo.');
  });

  it('复制 AI 回答失败时应在当前按钮显示失败反馈', async () => {
    const onCopy = vi.fn().mockResolvedValue(false);
    const turns: AiChatTurn[] = [{
      id: 'assistant-1',
      role: 'assistant',
      content: '建议先确认预算。',
      createdAt: '2026-08-29T00:00:00.000Z',
    }];

    render(
      <AiChatPanel
        turns={turns}
        question=""
        loading={false}
        messageCount={10}
        onQuestionChange={vi.fn()}
        onSubmit={vi.fn()}
        onCopy={onCopy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制 AI 回答' }));

    await waitFor(() => expect(screen.getByText('复制失败')).toBeInTheDocument());
    expect(onCopy).toHaveBeenCalledWith('建议先确认预算。');
  });
});
