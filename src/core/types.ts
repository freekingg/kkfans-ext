export type MessageDirection = 'incoming' | 'outgoing' | 'unknown';

export type MessageKind =
  | 'text'
  | 'link'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'deleted'
  | 'system'
  | 'unknown';

export interface ConversationIdentity {
  id: string;
  title: string;
  avatarKey: string | null;
}

export interface ConversationRecord extends ConversationIdentity {
  /** Explicit page start marker; absence means earliest chat date is unconfirmed. */
  historyStart?: { messageId: string; detectedAt: number } | null;
  firstMessageAt?: number | null;
  lastMessageAt?: number | null;
  hasHistoryStart?: boolean;
  createdAt: number;
  updatedAt: number;
  lastCapturedAt: number | null;
  messageCount: number;
  oldestMessageId: string | null;
  newestMessageId: string | null;
}

export interface ChatMessage {
  key: string;
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  text: string;
  quotedText: string | null;
  sender: string | null;
  timestampRaw: string | null;
  timestampMs: number | null;
  urls: string[];
  mediaCount: number;
  capturedAt: number;
  domOrder: number;
  /** Stable visual order merged across overlapping WhatsApp DOM snapshots. */
  orderIndex?: number;
  /** Downloaded from the cloud; cleared on a new local semantic edit. */
  cloudSynced?: boolean;
  /** Local aliases for the same message rendered with a different surface ID. */
  sourceAliases?: string[];
}

export interface TagDefinition {
  id: string;
  name: string;
  color: string;
}

export interface ConversationTagMap {
  [conversationId: string]: string[];
}

export interface ConversationNote {
  text: string;
  updatedAt: number;
}

export interface ConversationNoteMap {
  [conversationId: string]: ConversationNote;
}

export type CooperationSpecialStatus =
  | 'paused'
  | 'rejected'
  | 'lost-contact'
  | 'abandoned'
  | 'completed';

export type CooperationAdditionSource = 'comment' | 'direct-message' | 'email' | 'referral';

export interface CooperationProfile {
  contactWhatsapp: string;
  platformAccount: string;
  additionSource: CooperationAdditionSource | '';
  invitationUrl: string;
  followerData: string;
  instagramUsername: string;
  instagramProfileUrl: string;
  country: string;
  finalPrice: string;
  specialStatus: CooperationSpecialStatus | null;
  nextFollowUpAt: number | null;
  registeredDate: string;
  publishedDate: string;
  publishedUrl: string;
  updatedAt: number;
}

export interface CooperationProfileMap {
  [conversationId: string]: CooperationProfile;
}

export interface AiProfileSuggestions {
  instagramUsername: string | null;
  instagramProfileUrl: string | null;
  country: string | null;
  finalPrice: string | null;
  nextFollowUpAt: string | null;
  publishedDate: string | null;
  publishedUrl: string | null;
}

export type SopStageSource = 'manual' | 'ai-confirmed';

export interface ConversationSopStage {
  stageId: string;
  source: SopStageSource;
  confidence: number | null;
  confirmedAt: number;
  updatedAt: number;
  sopKnowledgeVersion: string | null;
}

export interface ConversationSopStageMap {
  [conversationId: string]: ConversationSopStage;
}

export interface SopStageHistoryEntry {
  eventId: string;
  conversationId: string;
  fromStageId: string | null;
  toStageId: string;
  source: SopStageSource;
  confidence: number | null;
  sopKnowledgeVersion: string | null;
  changedAt: number;
}

export type CaptureStatus =
  | 'idle'
  | 'reading'
  | 'paused'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface CaptureState {
  status: CaptureStatus;
  conversationId: string | null;
  title: string | null;
  captured: number;
  rounds: number;
  startedAt: number | null;
  updatedAt: number;
  note: string;
}

export interface CaptureSettings {
  maxRounds: number;
  settleMs: number;
}

export interface CloudSettings {
  username: string;
  whatsappAccount: string;
}

export type CloudSyncStatus = 'idle' | 'pending' | 'restoring' | 'syncing' | 'success' | 'error';

export interface CloudSyncState {
  status: CloudSyncStatus;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastDownloadedAt?: number;
  phase?: string;
  error: string | null;
  restoredConversations?: number;
  restoredMessages?: number;
  conflictCount?: number;
  skippedConversations?: number;
}

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SopSettings {
  url: string;
}

export interface AiReplySuggestion {
  language: string;
  text: string;
  translation?: string;
  reason: string;
}

export interface AiAnalysisResult {
  summary: string;
  stageId: string | null;
  confidence: number;
  intent: string;
  evidence: string[];
  risks: string[];
  nextActions: string[];
  replySuggestions: AiReplySuggestion[];
  profileSuggestions?: AiProfileSuggestions;
  model: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  analyzedAt: string;
  sopKnowledgeVersion?: string;
}

export type AiChatRole = 'user' | 'assistant';

export interface AiChatTurn {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: string;
  model?: string;
  sopKnowledgeVersion?: string;
}

export interface AiChatResult {
  answer: string;
  model: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  answeredAt: string;
  sopKnowledgeVersion?: string;
}

export interface ActiveContext {
  available: boolean;
  conversation: ConversationIdentity | null;
  capture: CaptureState;
}
