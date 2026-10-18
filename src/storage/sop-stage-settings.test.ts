import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

import {
  confirmConversationSopStage,
  getConversationSopStageHistory,
  getConversationSopStages,
} from './settings';

describe('conversation SOP stage settings', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('保存单选当前阶段并记录阶段变化历史', async () => {
    await confirmConversationSopStage({
      conversationId: 'chat-1',
      stageId: '05',
      source: 'manual',
    });
    await confirmConversationSopStage({
      conversationId: 'chat-1',
      stageId: '06',
      source: 'ai-confirmed',
      confidence: 0.82,
      sopKnowledgeVersion: 'sop-v1',
    });

    await expect(getConversationSopStages()).resolves.toMatchObject({
      'chat-1': { stageId: '06', source: 'ai-confirmed', confidence: 0.82 },
    });
    await expect(getConversationSopStageHistory()).resolves.toEqual([
      expect.objectContaining({ fromStageId: null, toStageId: '05', source: 'manual' }),
      expect.objectContaining({ fromStageId: '05', toStageId: '06', source: 'ai-confirmed' }),
    ]);
  });

  it('拒绝无效阶段且重复确认同一阶段不新增历史', async () => {
    await expect(confirmConversationSopStage({
      conversationId: 'chat-1',
      stageId: '99',
      source: 'manual',
    })).rejects.toThrow('SOP 阶段无效');

    await confirmConversationSopStage({ conversationId: 'chat-1', stageId: '06', source: 'manual' });
    await confirmConversationSopStage({ conversationId: 'chat-1', stageId: '06', source: 'manual' });
    await expect(getConversationSopStageHistory()).resolves.toHaveLength(1);
  });
});
