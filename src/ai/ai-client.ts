import type {
  AiAnalysisResult,
  AiChatResult,
  AiChatTurn,
  AiSettings,
  ChatMessage,
  CooperationProfile,
  ConversationIdentity,
} from '../core/types';
import { CLOUD_API_BASE_URL } from '../cloud/config';

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

async function request<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CLOUD_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      '无法连接 KKFans AI 服务。当前浏览器可能拦截了 kkfans.lllin.fun，请将该域名加入广告拦截或安全扩展的白名单后重试',
    );
  }
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !result || result.code !== 200) {
    throw new Error(result?.message || `AI 服务请求失败 (${response.status})`);
  }
  return result.data;
}

function provider(settings: AiSettings) {
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
  };
}

function conversationMessages(messages: ChatMessage[]) {
  return messages.slice(-120).map((message) => ({
    key: message.key,
    direction: message.direction,
    text: message.text || `[${message.kind}]`,
    quotedText: message.quotedText,
    sender: message.sender,
    timestamp: message.timestampRaw,
  }));
}

function cooperationProfile(profile?: CooperationProfile | null) {
  if (!profile) return null;
  return {
    contactWhatsapp: profile.contactWhatsapp,
    platformAccount: profile.platformAccount,
    invitationUrl: profile.invitationUrl,
    followerData: profile.followerData,
    instagramUsername: profile.instagramUsername,
    instagramProfileUrl: profile.instagramProfileUrl,
    country: profile.country,
    finalPrice: profile.finalPrice,
    specialStatus: profile.specialStatus,
    nextFollowUpAt: profile.nextFollowUpAt,
    registeredDate: profile.registeredDate,
    publishedDate: profile.publishedDate,
    publishedUrl: profile.publishedUrl,
  };
}

export function testAiConnection(settings: AiSettings) {
  return request<{ connected: boolean; model: string; reply: string }>(
    '/ai/openai-compatible/test',
    { provider: provider(settings) },
  );
}

export function analyzeAiConversation(input: {
  settings: AiSettings;
  username?: string;
  conversation: ConversationIdentity;
  messages: ChatMessage[];
  tags: string[];
  profile?: CooperationProfile | null;
  currentSopStageId?: string | null;
}) {
  return request<AiAnalysisResult>('/ai/openai-compatible/analyze', {
    provider: provider(input.settings),
    userKey: input.username?.trim() || undefined,
    context: {
      conversationId: input.conversation.id,
      title: input.conversation.title,
      tags: input.tags,
      profile: cooperationProfile(input.profile),
      currentSopStageId: input.currentSopStageId ?? null,
      messages: conversationMessages(input.messages),
    },
  });
}

export function chatAiConversation(input: {
  settings: AiSettings;
  username?: string;
  conversation: ConversationIdentity;
  messages: ChatMessage[];
  tags: string[];
  question: string;
  history: AiChatTurn[];
  analysis?: AiAnalysisResult | null;
  profile?: CooperationProfile | null;
  currentSopStageId?: string | null;
}) {
  return request<AiChatResult>('/ai/openai-compatible/chat', {
    provider: provider(input.settings),
    userKey: input.username?.trim() || undefined,
    context: {
      conversationId: input.conversation.id,
      title: input.conversation.title,
      tags: input.tags,
      profile: cooperationProfile(input.profile),
      currentSopStageId: input.currentSopStageId ?? null,
      messages: conversationMessages(input.messages),
    },
    analysis: input.analysis
      ? {
          summary: input.analysis.summary,
          stageId: input.analysis.stageId,
          intent: input.analysis.intent,
          nextActions: input.analysis.nextActions,
        }
      : null,
    history: input.history.slice(-20).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    question: input.question.trim(),
  });
}
