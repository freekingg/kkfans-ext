import {
  Archive,
  ArrowLeft,
  AtSign,
  BookOpenText,
  Check,
  ChevronRight,
  CirclePause,
  LoaderCircle,
  Languages,
  MessageCircleMore,
  MessageSquareText,
  Play,
  Pencil,
  RefreshCw,
  Sparkles,
  Tags,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendContent } from '../../core/content-connection';
import type {
  BackgroundRequest,
  BackgroundResponse,
  ContentCommand,
} from '../../core/runtime-messages';
import { analyzeAiConversation, chatAiConversation, testAiConnection } from '../../ai/ai-client';
import type {
  ActiveContext,
  AiAnalysisResult,
  AiChatTurn,
  AiSettings,
  CaptureState,
  ChatMessage,
  CloudSettings,
  CooperationProfile,
  CooperationProfileMap,
  ConversationNoteMap,
  ConversationRecord,
  ConversationSopStageMap,
  ConversationTagMap,
  SopSettings,
  TagDefinition,
} from '../../core/types';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_CLOUD_SETTINGS,
  DEFAULT_SOP_SETTINGS,
  DEFAULT_TAGS,
  getAiSettings,
  getCooperationProfiles,
  getConversationSopStages,
  getConversationNotes,
  getConversationTags,
  getCloudSettings,
  getTagDefinitions,
  getSopSettings,
  normalizeAiSettings,
  saveAiSettings,
  saveCooperationProfile,
  saveConversationNote,
  saveSopSettings,
  confirmConversationSopStage,
  toggleConversationTag,
  validateAiSettings,
  validateSopSettings,
} from '../../storage/settings';
import { getAiChatTurns, saveAiChatTurns } from '../../storage/ai-chat-store';
import { extractProfileSuggestions } from '../../business/profile-suggestions';
import {
  COOPERATION_PROFILE_FIELD_COUNT,
  countCompletedProfileFields,
} from '../../business/profile-completeness';
import { getSopStageTitle } from '../../sop/stages';
import { AiAnalysisResults } from './AiAnalysisResults';
import { AiChatPanel } from './AiChatPanel';
import { SettingsView, type SettingsSection } from './SettingsView';
import { CooperationProfileView } from './CooperationProfileView';
import { FollowerDataSummary } from './FollowerDataSummary';
import { CaptureLockedActions } from './CaptureLockedActions';
import { PersistentView } from './PersistentView';
import { ProfileModal } from './ProfileModal';
import { SopView } from './SopView';
import { TranslationView } from './TranslationView';

const IS_EXTENSION_RUNTIME = Boolean(
  (browser as unknown as { runtime?: { id?: string } }).runtime?.id,
);

const EMPTY_CAPTURE: CaptureState = {
  status: 'idle',
  conversationId: null,
  title: null,
  captured: 0,
  rounds: 0,
  startedAt: null,
  updatedAt: Date.now(),
  note: '等待选择会话',
};

const PROFILE_SUGGESTION_FIELDS = new Set([
  'instagramProfileUrl',
  'country',
  'finalPrice',
  'publishedUrl',
]);

type PrimaryView = 'overview' | 'sop' | 'translation';
type View = PrimaryView | 'settings' | 'ai-details';

function isPrimaryView(view: View): view is PrimaryView {
  return view === 'overview' || view === 'sop' || view === 'translation';
}

async function sendBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    const response = await browser.runtime.sendMessage(request) as BackgroundResponse | undefined;
    return response && typeof response.ok === 'boolean' ? response
      : { ok: false, error: '插件后台未返回有效响应，请在扩展管理页重新加载插件' };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : '无法连接插件后台' };
  }
}

function StatusDot({ status }: { status: CaptureState['status'] }) {
  return <span className={`status-dot status-${status}`} aria-hidden="true" />;
}

export function App() {
  const [view, setView] = useState<View>('overview');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [openedPersistentViews, setOpenedPersistentViews] = useState<Set<PrimaryView>>(
    () => new Set(),
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('ai');
  const previousPrimaryView = useRef<PrimaryView>('overview');
  const [context, setContext] = useState<ActiveContext | null>(null);
  const [capture, setCapture] = useState<CaptureState>(EMPTY_CAPTURE);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profileMessageSource, setProfileMessageSource] = useState<{ conversationId: string; messages: ChatMessage[] } | null>(null);
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [tagMap, setTagMap] = useState<ConversationTagMap>({});
  const [noteMap, setNoteMap] = useState<ConversationNoteMap>({});
  const [profileMap, setProfileMap] = useState<CooperationProfileMap>({});
  const [sopStageMap, setSopStageMap] = useState<ConversationSopStageMap>({});
  const [cloudSettings, setCloudSettings] = useState<CloudSettings>(DEFAULT_CLOUD_SETTINGS);
  const [aiDraft, setAiDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const aiDraftDirty = useRef(false);
  const [sopSettings, setSopSettings] = useState<SopSettings>(DEFAULT_SOP_SETTINGS);
  const [sopDraft, setSopDraft] = useState<SopSettings>(DEFAULT_SOP_SETTINGS);
  const sopDraftDirty = useRef(false);
  const [sopNotice, setSopNotice] = useState('');
  const [sopNoticeTone, setSopNoticeTone] = useState<'success' | 'error' | 'info'>('info');
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiNotice, setAiNotice] = useState('');
  const [aiSettingsNotice, setAiSettingsNotice] = useState('');
  const [aiSettingsNoticeTone, setAiSettingsNoticeTone] = useState<'info' | 'success' | 'error'>('info');
  const [aiChatTurns, setAiChatTurns] = useState<AiChatTurn[]>([]);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteNotice, setNoteNotice] = useState('');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [loading, setLoading] = useState(true);
  const refreshDataSequence = useRef(0);
  const refreshMessagesSequence = useRef(0);
  const noteDraftDirty = useRef(false);
  const noteConversationId = useRef<string | null>(null);

  const activeConversationId = context?.conversation?.id ?? null;
  const activeTags = useMemo(
    () => new Set(activeConversationId ? (tagMap[activeConversationId] ?? []) : []),
    [activeConversationId, tagMap],
  );
  const activeProfile = activeConversationId ? profileMap[activeConversationId] ?? null : null;
  const profileSuggestions = useMemo(() => {
    const sourceMessages = profileMessageSource?.conversationId === activeConversationId
      ? profileMessageSource.messages
      : messages;
    const deterministic = extractProfileSuggestions(sourceMessages);
    const ai = aiAnalysis?.profileSuggestions ?? {};
    const merged: Record<string, string> = Object.fromEntries(
      Object.entries(deterministic).filter((entry): entry is [string, string] =>
        PROFILE_SUGGESTION_FIELDS.has(entry[0])
        &&
        typeof entry[1] === 'string' && Boolean(entry[1].trim()),
      ),
    );
    for (const [field, value] of Object.entries(ai)) {
      if (PROFILE_SUGGESTION_FIELDS.has(field) && typeof value === 'string' && value.trim()) {
        merged[field] = value.trim();
      }
    }
    const aiInstagramUsername = aiAnalysis?.profileSuggestions?.instagramUsername;
    if (!merged.instagramProfileUrl && typeof aiInstagramUsername === 'string' && aiInstagramUsername.trim()) {
      const username = aiInstagramUsername.trim().replace(/^@+/, '');
      if (/^[a-zA-Z0-9._]{1,64}$/.test(username)) {
        merged.instagramProfileUrl = `https://www.instagram.com/${username}/`;
      }
    }
    return Object.fromEntries(
      Object.entries(merged).filter(([, value]) =>
        typeof value === 'string' && Boolean(value.trim()),
      ),
    );
  }, [activeConversationId, aiAnalysis, messages, profileMessageSource]);

  function openPrimaryView(nextView: PrimaryView) {
    if (nextView === 'sop' || nextView === 'translation') {
      setOpenedPersistentViews((current) => {
        if (current.has(nextView)) return current;
        return new Set([...current, nextView]);
      });
    }
    previousPrimaryView.current = nextView;
    setView(nextView);
  }

  function openSettings(section: SettingsSection = 'ai') {
    if (isPrimaryView(view)) {
      previousPrimaryView.current = view;
    }
    setSettingsSection(section);
    setView('settings');
  }

  function openProfile() {
    setProfileDirty(false);
    setProfileModalOpen(true);
    if (!activeConversationId || !IS_EXTENSION_RUNTIME) return;
    const conversationId = activeConversationId;
    void sendBackground({
      type: 'db:list-messages',
      conversationId,
      limit: 2000,
    }).then((response) => {
      if (response.ok && 'messages' in response) {
        setProfileMessageSource({ conversationId, messages: response.messages });
      }
    });
  }

  function closeSecondaryView() {
    setView(previousPrimaryView.current);
  }

  const refreshData = useCallback(async () => {
    const requestSequence = ++refreshDataSequence.current;
    if (!IS_EXTENSION_RUNTIME) {
      const previewConversation: ConversationRecord = {
        id: 'preview-chat',
        title: '+52 1 56 3561 8106',
        avatarKey: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastCapturedAt: Date.now(),
        messageCount: 246,
        oldestMessageId: 'oldest',
        newestMessageId: 'newest',
      };
      setContext({
        available: true,
        conversation: previewConversation,
        capture: { ...EMPTY_CAPTURE, status: 'complete', conversationId: previewConversation.id, title: previewConversation.title, captured: 246, rounds: 18, note: '读取完成，共保存 246 条消息' },
      });
      setCapture({ ...EMPTY_CAPTURE, status: 'complete', conversationId: previewConversation.id, title: previewConversation.title, captured: 246, rounds: 18, note: '读取完成，共保存 246 条消息' });
      setConversations([previewConversation]);
      setTags(DEFAULT_TAGS);
      setTagMap({ 'preview-chat': ['follow-up'] });
      setNoteMap({ 'preview-chat': { text: '已确认合作意向，等待对方提供最终发布时间。', updatedAt: Date.now() } });
      setProfileMap({
        'preview-chat': {
          additionSource: 'direct-message',
          contactWhatsapp: '+52 1 56 3561 8106', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator-demo', followerData: '53 posts\n89.1K followers\n320 following', instagramUsername: 'creator_demo',
          instagramProfileUrl: 'https://www.instagram.com/creator_demo/', country: '墨西哥',
          finalPrice: '400 USD', specialStatus: null, nextFollowUpAt: Date.now() + 86_400_000,
          registeredDate: new Date().toISOString().slice(0, 10), publishedDate: '', publishedUrl: '', updatedAt: Date.now(),
        },
      });
      setSopStageMap({
        'preview-chat': {
          stageId: '06', source: 'ai-confirmed', confidence: 0.82,
          confirmedAt: Date.now(), updatedAt: Date.now(), sopKnowledgeVersion: 'preview',
        },
      });
      setCloudSettings({ username: 'king', whatsappAccount: '+52 123 456 7890' });
      setAiDraft({ baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-chat' });
      setSopSettings(DEFAULT_SOP_SETTINGS);
      setSopDraft(DEFAULT_SOP_SETTINGS);
      setLoading(false);
      return;
    }
    const [
      contextResponse,
      conversationResponse,
      definitions,
      map,
      storedNotes,
      storedProfiles,
      storedSopStages,
      storedCapture,
      storedCloudSettings,
      storedAiSettings,
      storedSopSettings,
    ] =
      await Promise.all([
        sendContent({ type: 'content:get-context' }),
        sendBackground({ type: 'db:list-conversations' }),
        getTagDefinitions(),
        getConversationTags(),
        getConversationNotes(),
        getCooperationProfiles(),
        getConversationSopStages(),
        browser.storage.local.get('captureState'),
        getCloudSettings(),
        getAiSettings(),
        getSopSettings(),
      ]);

    if (requestSequence !== refreshDataSequence.current) return;

    if (contextResponse.ok && 'context' in contextResponse) {
      setConnectionError('');
      setContext(contextResponse.context);
      setCapture((storedCapture.captureState as CaptureState | undefined) ?? contextResponse.context.capture);
    } else if (!contextResponse.ok) {
      setConnectionError(contextResponse.error);
    }
    if (conversationResponse.ok && 'conversations' in conversationResponse) {
      setConversations(conversationResponse.conversations);
    }
    setTags(definitions);
    setTagMap(map);
    setNoteMap(storedNotes);
    setProfileMap(storedProfiles);
    setSopStageMap(storedSopStages);
    setCloudSettings(storedCloudSettings);
    if (!aiDraftDirty.current) setAiDraft(storedAiSettings);
    setSopSettings(storedSopSettings);
    if (!sopDraftDirty.current) setSopDraft(storedSopSettings);
    setLoading(false);
  }, []);

  const refreshMessages = useCallback(async () => {
    const requestSequence = ++refreshMessagesSequence.current;
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    if (!IS_EXTENSION_RUNTIME) {
      setMessages([]);
      return;
    }
    const response = await sendBackground({
      type: 'db:list-messages',
      conversationId: activeConversationId,
      limit: 120,
    });
    if (
      requestSequence === refreshMessagesSequence.current &&
      response.ok &&
      'messages' in response
    ) {
      setMessages(response.messages);
    }
  }, [activeConversationId]);

  useEffect(() => {
    void refreshData();
    if (!IS_EXTENSION_RUNTIME) return undefined;
    const interval = window.setInterval(() => void refreshData(), 1800);
    const listener = (changes: Record<string, Browser.storage.StorageChange>) => {
      if (changes.captureState?.newValue) {
        setCapture(changes.captureState.newValue as CaptureState);
        void refreshMessages();
      }
      if (changes.cloudRestoreApplied) {
        void refreshData();
        void refreshMessages();
      }
      if (
        changes.tagDefinitions ||
        changes.conversationTags ||
        changes.conversationNotes ||
        changes.cooperationProfiles ||
        changes.conversationSopStages
      ) void refreshData();
      if (changes.cloudSettings) void refreshData();
      if (changes.aiSettings) void refreshData();
      if (changes.sopSettings) void refreshData();
    };
    browser.storage.onChanged.addListener(listener);
    return () => {
      window.clearInterval(interval);
      browser.storage.onChanged.removeListener(listener);
    };
  }, [refreshData, refreshMessages]);

  useEffect(() => {
    setMessages([]);
    void refreshMessages();
  }, [refreshMessages]);

  useEffect(() => {
    if (capture.status === 'reading' && view !== 'overview') {
      previousPrimaryView.current = 'overview';
      setView('overview');
    }
  }, [capture.status, view]);

  useEffect(() => {
    const savedText = activeConversationId ? noteMap[activeConversationId]?.text ?? '' : '';
    if (noteConversationId.current !== activeConversationId) {
      noteConversationId.current = activeConversationId;
      noteDraftDirty.current = false;
      setNoteDraft(savedText);
      setNoteNotice('');
      return;
    }
    if (!noteDraftDirty.current) setNoteDraft(savedText);
  }, [activeConversationId, noteMap]);

  useEffect(() => {
    setAiAnalysis(null);
    setAiNotice('');
    setAiQuestion('');
    if (!activeConversationId || !IS_EXTENSION_RUNTIME) {
      setAiChatTurns([]);
      return;
    }
    let cancelled = false;
    void getAiChatTurns(activeConversationId).then((turns) => {
      if (!cancelled) setAiChatTurns(turns);
    });
    return () => {
      cancelled = true;
    };
  }, [activeConversationId]);

  async function runCommand(command: ContentCommand) {
    setError('');
    const response = await sendContent(command);
    if (!response.ok) setError(response.error);
    window.setTimeout(() => void refreshData(), 180);
  }

  async function toggleTag(tagId: string) {
    if (!activeConversationId) return;
    if (!IS_EXTENSION_RUNTIME) {
      setTagMap((current) => {
        const selected = new Set(current[activeConversationId] ?? []);
        selected.has(tagId) ? selected.delete(tagId) : selected.add(tagId);
        return { ...current, [activeConversationId]: [...selected] };
      });
      return;
    }
    try {
      const selected = await toggleConversationTag(activeConversationId, tagId);
      setTagMap((current) => ({ ...current, [activeConversationId]: selected }));
      await sendContent({ type: 'content:refresh-tags' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '标签保存失败');
    }
  }

  async function persistConversationNote(value = noteDraft, propagateError = false) {
    if (!activeConversationId) return;
    setNoteSaving(true);
    setNoteNotice('');
    try {
      const note = await saveConversationNote(activeConversationId, value);
      setNoteMap((current) => {
        const next = { ...current };
        if (note) next[activeConversationId] = note;
        else delete next[activeConversationId];
        return next;
      });
      const normalized = note?.text ?? '';
      setNoteDraft(normalized);
      noteDraftDirty.current = false;
      setNoteNotice(note ? '备注已保存，并已显示在会话列表' : '备注已清空');
      await sendContent({ type: 'content:refresh-tags' });
    } catch (cause) {
      setNoteNotice(cause instanceof Error ? cause.message : '备注保存失败');
      if (propagateError) throw cause;
    } finally {
      setNoteSaving(false);
    }
  }

  async function persistCooperationProfile(value: CooperationProfile) {
    if (!activeConversationId) return;
    const profile = await saveCooperationProfile(activeConversationId, value);
    setProfileMap((current) => {
      const next = { ...current };
      if (profile) next[activeConversationId] = profile;
      else delete next[activeConversationId];
      return next;
    });
  }

  function updateSopDraft(value: string) {
    sopDraftDirty.current = true;
    setSopDraft({ url: value });
    setSopNotice('');
    setSopNoticeTone('info');
  }

  async function saveSopConfiguration() {
    const validationError = validateSopSettings(sopDraft);
    if (validationError) {
      setSopNoticeTone('error');
      setSopNotice(validationError);
      return;
    }
    try {
      if (IS_EXTENSION_RUNTIME) await saveSopSettings(sopDraft);
      const saved = { url: sopDraft.url.trim() };
      sopDraftDirty.current = false;
      setSopSettings(saved);
      setSopDraft(saved);
      setSopNoticeTone('success');
      setSopNotice('SOP 地址已保存并重新加载');
    } catch (cause) {
      setSopNoticeTone('error');
      setSopNotice(cause instanceof Error ? cause.message : '保存 SOP 地址失败');
    }
  }

  function resetSopDraft() {
    sopDraftDirty.current = true;
    setSopDraft(DEFAULT_SOP_SETTINGS);
    setSopNoticeTone('info');
    setSopNotice('已恢复默认地址，点击保存后生效');
  }

  function openSopExternally() {
    if (IS_EXTENSION_RUNTIME) {
      void browser.tabs.create({ url: sopSettings.url });
      return;
    }
    window.open(sopSettings.url, '_blank', 'noopener,noreferrer');
  }

  function updateAiDraft(field: keyof AiSettings, value: string) {
    aiDraftDirty.current = true;
    setAiSettingsNotice('');
    setAiSettingsNoticeTone('info');
    setAiDraft((current) => ({ ...current, [field]: value }));
  }

  async function persistAiDraft(errorTarget: 'global' | 'inline' = 'global'): Promise<AiSettings | null> {
    const validationError = validateAiSettings(aiDraft);
    if (validationError) {
      if (errorTarget === 'inline') {
        setAiSettingsNoticeTone('error');
        setAiSettingsNotice(validationError);
      } else {
        setError(validationError);
      }
      return null;
    }
    const normalized = normalizeAiSettings(aiDraft);
    if (IS_EXTENSION_RUNTIME) await saveAiSettings(normalized);
    aiDraftDirty.current = false;
    setAiDraft(normalized);
    return normalized;
  }

  async function saveAiConfiguration() {
    setError('');
    setAiSettingsNotice('');
    setAiSettingsNoticeTone('info');
    try {
      const saved = await persistAiDraft();
      if (saved) {
        setAiSettingsNoticeTone('success');
        setAiSettingsNotice('AI 配置已保存在当前浏览器');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存 AI 配置失败');
    }
  }

  async function testConfiguredAi() {
    setError('');
    setAiSettingsNotice('');
    setAiSettingsNoticeTone('info');
    setAiTesting(true);
    try {
      const saved = await persistAiDraft('inline');
      if (!saved) return;
      const result = await testAiConnection(saved);
      setAiSettingsNoticeTone('success');
      setAiSettingsNotice(`连接成功 · ${result.model}${result.reply ? ` · ${result.reply}` : ''}`);
    } catch (cause) {
      setAiSettingsNoticeTone('error');
      setAiSettingsNotice(cause instanceof Error ? cause.message : '模型连接测试失败');
    } finally {
      setAiTesting(false);
    }
  }

  async function loadMessagesForAi(): Promise<ChatMessage[]> {
    if (!activeConversationId) return [];
    if (!IS_EXTENSION_RUNTIME) return messages;
    const response = await sendBackground({
      type: 'db:list-messages',
      conversationId: activeConversationId,
      limit: 120,
    });
    if (!response.ok) throw new Error(response.error);
    const latestMessages = 'messages' in response ? response.messages : [];
    setMessages(latestMessages);
    return latestMessages;
  }

  async function analyzeCurrentConversation(openDetails = false) {
    setError('');
    setAiNotice('');
    setAiAnalyzing(true);
    try {
      const saved = await persistAiDraft();
      if (!saved) return;
      const conversation = context?.conversation ?? currentRecord;
      if (!conversation || !activeConversationId) throw new Error('请先选择一个 WhatsApp 会话');
      const currentMessages = await loadMessagesForAi();
      if (currentMessages.length === 0) throw new Error('当前会话还没有可分析的消息');
      const selectedTagIds = new Set(tagMap[activeConversationId] ?? []);
      const result = await analyzeAiConversation({
        settings: saved,
        username: cloudSettings.username,
        conversation,
        messages: currentMessages,
        tags: tags.filter((tag) => selectedTagIds.has(tag.id)).map((tag) => tag.name),
        profile: activeProfile,
        currentSopStageId: activeProfile?.specialStatus ? null : activeSopStage?.stageId ?? null,
      });
      setAiAnalysis(result);
      setAiNotice(`已使用 ${result.model} 分析 ${currentMessages.length} 条最近消息`);
      if (openDetails) setView('ai-details');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 分析失败');
    } finally {
      setAiAnalyzing(false);
    }
  }

  async function copyReply(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      setAiNotice('内容已复制到剪贴板');
      return true;
    } catch {
      setAiNotice('复制失败，请检查浏览器剪贴板权限');
      return false;
    }
  }

  function requestAiAnalysis(openDetails = false) {
    if (validateAiSettings(aiDraft)) {
      setAiSettingsNoticeTone('info');
      setAiSettingsNotice('请先完成模型配置并测试连接');
      openSettings('ai');
      return;
    }
    void analyzeCurrentConversation(openDetails);
  }

  function openAiChat() {
    if (validateAiSettings(aiDraft)) {
      setAiSettingsNoticeTone('info');
      setAiSettingsNotice('请先完成模型配置并测试连接');
      openSettings('ai');
      return;
    }
    if (isPrimaryView(view)) {
      previousPrimaryView.current = view;
    }
    setView('ai-details');
  }

  async function confirmSopStage(
    stageId: string,
    source: 'manual' | 'ai-confirmed',
    confidence: number | null = null,
    sopKnowledgeVersion: string | null = null,
  ) {
    if (!activeConversationId) return;
    try {
      const stage = IS_EXTENSION_RUNTIME
        ? await confirmConversationSopStage({
            conversationId: activeConversationId,
            stageId,
            source,
            confidence,
            sopKnowledgeVersion,
          })
        : {
            stageId,
            source,
            confidence,
            confirmedAt: Date.now(),
            updatedAt: Date.now(),
            sopKnowledgeVersion,
          };
      setSopStageMap((current) => ({ ...current, [activeConversationId]: stage }));
      if (activeProfile?.specialStatus) {
        await persistCooperationProfile({ ...activeProfile, specialStatus: null });
      }
      if (IS_EXTENSION_RUNTIME) await sendContent({ type: 'content:refresh-tags' });
      setAiNotice(`已确认当前阶段：${getSopStageTitle(stageId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存 SOP 阶段失败');
    }
  }

  async function askAiQuestion(question: string) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || aiChatLoading) return;
    if (validateAiSettings(aiDraft)) {
      setAiSettingsNoticeTone('info');
      setAiSettingsNotice('请先完成模型配置并测试连接');
      openSettings('ai');
      return;
    }
    const conversation = context?.conversation ?? currentRecord;
    if (!conversation || !activeConversationId) {
      setError('请先选择一个 WhatsApp 会话');
      return;
    }

    setError('');
    setAiNotice('');
    setAiChatLoading(true);
    try {
      const currentMessages = await loadMessagesForAi();
      if (currentMessages.length === 0) throw new Error('当前会话还没有可询问的消息');
      const selectedTagIds = new Set(tagMap[activeConversationId] ?? []);
      const result = await chatAiConversation({
        settings: aiDraft,
        username: cloudSettings.username,
        conversation,
        messages: currentMessages,
        tags: tags.filter((tag) => selectedTagIds.has(tag.id)).map((tag) => tag.name),
        question: normalizedQuestion,
        history: aiChatTurns,
        analysis: aiAnalysis,
        profile: activeProfile,
        currentSopStageId: activeProfile?.specialStatus ? null : activeSopStage?.stageId ?? null,
      });
      const userTurn: AiChatTurn = {
        id: crypto.randomUUID(),
        role: 'user',
        content: normalizedQuestion,
        createdAt: new Date().toISOString(),
      };
      const assistantTurn: AiChatTurn = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer,
        createdAt: result.answeredAt,
        model: result.model,
        ...(result.sopKnowledgeVersion
          ? { sopKnowledgeVersion: result.sopKnowledgeVersion }
          : {}),
      };
      const nextTurns = [...aiChatTurns, userTurn, assistantTurn].slice(-40);
      setAiChatTurns(nextTurns);
      setAiQuestion('');
      setAiNotice(`已使用 ${result.model} 回答`);
      if (IS_EXTENSION_RUNTIME) await saveAiChatTurns(activeConversationId, nextTurns);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 问答失败');
    } finally {
      setAiChatLoading(false);
    }
  }

  const isReading = capture.status === 'reading';
  const isRestoring = false;
  const currentRecord = conversations.find((item) => item.id === activeConversationId);
  const activeSopStage = activeConversationId ? sopStageMap[activeConversationId] ?? null : null;
  const activeNote = activeConversationId ? noteMap[activeConversationId] ?? null : null;
  const noteChanged = noteDraft.trim() !== (activeNote?.text ?? '');
  const aiConfigured = validateAiSettings(aiDraft) === null;
  const currentMessageCount = messages.length || currentRecord?.messageCount || capture.captured;
  const isSecondaryView = (view === 'settings' || view === 'ai-details');
  const profileCompleteness = countCompletedProfileFields(activeProfile);
  const profileSuggestionCount = Object.entries(profileSuggestions).filter(([field, value]) => {
    if (!value) return false;
    return String(activeProfile?.[field as keyof CooperationProfile] ?? '') !== value;
  }).length;
  const secondaryTitle = view === 'settings' ? '设置' : 'AI 分析详情';
  const secondarySubtitle = view === 'settings'
    ? 'AI 模型配置'
    : context?.conversation?.title ?? '当前会话';

  return (
    <div className="app-shell">
      {isSecondaryView ? (
        <header className="topbar secondary-topbar">
          <button className="icon-button back-button" onClick={closeSecondaryView} aria-label="返回"><ArrowLeft size={18} /></button>
          <div>
            <h1>{secondaryTitle}</h1>
            <p>{secondarySubtitle}</p>
          </div>
        </header>
      ) : null}

      {!isSecondaryView ? <nav className="tabs" aria-label="功能导航">
        <button className={view === 'overview' ? 'active' : ''} disabled={isReading} onClick={() => openPrimaryView('overview')}>
          <Archive size={15} />概览
        </button>
        <button className={view === 'sop' ? 'active' : ''} disabled={isReading} onClick={() => openPrimaryView('sop')}>
          <BookOpenText size={15} />SOP
        </button>
        <button className={view === 'translation' ? 'active' : ''} disabled={isReading} onClick={() => openPrimaryView('translation')}>
          <Languages size={15} />翻译
        </button>
      </nav> : null}

      <main>
        {loading ? (
          <div className="empty-state"><LoaderCircle className="spin" size={24} /><p>正在连接 WhatsApp…</p></div>
        ) : null}

        {connectionError ? <div className="error-banner" role="alert"><span>{connectionError}</span><button onClick={() => void refreshData()} aria-label="重新连接 WhatsApp"><RefreshCw size={14} /></button></div> : null}
        {error ? <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div> : null}

        {!loading && view === 'overview' ? (
          <>
            <section className="conversation-card compact-conversation-card">
              <div className="compact-conversation-main">
                <div className="compact-conversation-copy">
                  <div className="eyebrow"><StatusDot status={capture.status} />当前会话</div>
                  <h2 title={context?.conversation?.title}>{context?.conversation?.title ?? '尚未选择会话'}</h2>
                  <div className="compact-conversation-meta">
                    <span>{currentRecord?.messageCount ?? capture.captured} 条消息</span>
                    {capture.rounds > 0 ? <span>{capture.rounds} 轮扫描</span> : null}
                  </div>
                </div>
                {isReading ? (
                  <button className="compact-capture-button pause" onClick={() => void runCommand({ type: 'content:pause-capture' })}>
                    <CirclePause size={15} />暂停
                  </button>
                ) : (
                  <button className="compact-capture-button" disabled={!context?.conversation || isRestoring} onClick={() => void runCommand({ type: 'content:start-capture' })}>
                    <RefreshCw size={15} />{capture.status === 'paused' ? '继续补齐' : '补齐历史'}
                  </button>
                )}
              </div>
              <div className="compact-capture-status">
                <span title={capture.note}>{capture.note}</span>
                {isReading ? <b>进行中</b> : null}
              </div>
              {isReading ? <div className="progress-track indeterminate"><span /></div> : null}
            </section>

            <CaptureLockedActions locked={isReading || isRestoring} restoring={isRestoring}>

            <section className="panel-section conversation-note-section">
              <div className="section-heading">
                <div><span className="eyebrow">会话记录</span><h3>备注</h3></div>
                <MessageSquareText size={18} />
              </div>
              <textarea
                value={noteDraft}
                disabled={!activeConversationId || noteSaving}
                maxLength={2000}
                rows={4}
                placeholder="记录合作细节、特殊要求、下次跟进事项……"
                onChange={(event) => {
                  noteDraftDirty.current = true;
                  setNoteDraft(event.target.value);
                  setNoteNotice('');
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && noteChanged) {
                    event.preventDefault();
                    void persistConversationNote();
                  }
                }}
              />
              <div className="note-footer">
                <span>{noteDraft.length}/2000 · Ctrl+Enter 保存</span>
                <div>
                  <button className="note-clear-button" disabled={noteSaving || !activeNote} onClick={() => void persistConversationNote('')}>清空</button>
                  <button className="note-save-button" disabled={noteSaving || !activeConversationId || !noteChanged} onClick={() => void persistConversationNote()}>
                    {noteSaving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{noteSaving ? '保存中' : '保存备注'}
                  </button>
                </div>
              </div>
              {noteNotice ? <p className="note-notice">{noteNotice}</p> : null}
            </section>

            <button className="profile-summary-card" onClick={openProfile} disabled={!activeConversationId}>
              <span className="profile-summary-icon"><AtSign size={17} /></span>
              <span className="profile-summary-copy">
                <span className="profile-summary-heading"><strong>合作资料</strong><small title={`统计合作资料页中的 ${COOPERATION_PROFILE_FIELD_COUNT} 个字段`}>已填 {profileCompleteness}/{COOPERATION_PROFILE_FIELD_COUNT}</small></span>
                <span className="profile-summary-title">
                  {activeProfile?.instagramUsername ? `@${activeProfile.instagramUsername}` : activeProfile?.instagramProfileUrl || '待补充 IG 主页'}
                </span>
                <span className="profile-summary-meta">
                  {[activeProfile?.country, activeProfile?.finalPrice].filter(Boolean).join(' · ') || '填写国家和最终价格'}
                </span>
                <FollowerDataSummary value={activeProfile?.followerData} />
                {profileSuggestionCount ? <span className="profile-suggestion-badge"><Sparkles size={11} />发现 {profileSuggestionCount} 项可补充</span> : null}
              </span>
              <Pencil size={15} />
            </button>

            <section className="panel-section">
              <div className="section-heading"><div><span className="eyebrow">快速标签</span><h3>标记当前会话</h3></div><Tags size={18} /></div>
              <div className="tag-grid">
                {tags.map((tag) => (
                  <button key={tag.id} className={`tag-chip ${activeTags.has(tag.id) ? 'selected' : ''}`} style={{ '--tag-color': tag.color } as React.CSSProperties} disabled={!activeConversationId} onClick={() => void toggleTag(tag.id)}>
                    <span className="tag-dot" />{tag.name}{activeTags.has(tag.id) ? <Check size={13} /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel-section ai-overview-card">
              <div className="section-heading">
                <div><span className="eyebrow">AI 助手</span><h3>当前会话分析</h3></div>
                <span className={`config-pill ${aiConfigured ? 'ready' : 'needed'}`}>{aiConfigured ? '模型就绪' : '需要配置'}</span>
              </div>
              {aiAnalysis ? (
                <>
                  <div className="ai-overview-result">
                    <div className="ai-stage-summary">
                      <span>SOP 阶段</span>
                      <strong>{getSopStageTitle(aiAnalysis.stageId)}</strong>
                      <div className="overview-confidence" title="AI 对当前 SOP 阶段判断的把握程度，不代表成交概率">
                        <b>{Math.round(aiAnalysis.confidence * 100)}%</b>
                        <small>阶段置信度</small>
                      </div>
                    </div>
                    <p>{aiAnalysis.summary || '暂无摘要'}</p>
                    {aiAnalysis.nextActions[0] ? <div className="next-action-preview"><span>建议下一步</span>{aiAnalysis.nextActions[0]}</div> : null}
                  </div>
                  <div className="ai-overview-actions">
                    <button className="cloud-button secondary" onClick={() => requestAiAnalysis()} disabled={aiAnalyzing}>{aiAnalyzing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}重新分析</button>
                    <button className="cloud-button ai-detail-button" onClick={openAiChat}>分析与追问<ChevronRight size={15} /></button>
                  </div>
                </>
              ) : (
                <>
                  <div className="ai-empty-copy">
                    <div className="ai-overview-icon"><Sparkles size={18} /></div>
                    <p>{aiConfigured ? `基于当前会话最近 ${Math.min(currentMessageCount, 120)} 条消息，判断 SOP 阶段并生成回复建议。` : '配置兼容 OpenAI 协议的模型后，即可分析当前聊天上下文。'}</p>
                  </div>
                  {aiConfigured ? (
                    <div className="ai-entry-actions">
                      <button className="primary-button ai-analyze-button" onClick={() => requestAiAnalysis()} disabled={aiAnalyzing || !activeConversationId || currentMessageCount === 0}>
                        {aiAnalyzing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{aiAnalyzing ? '正在分析…' : '智能分析'}
                      </button>
                      <button className="primary-button ai-question-button" onClick={openAiChat} disabled={!activeConversationId || currentMessageCount === 0}><MessageCircleMore size={17} />向 AI 提问</button>
                    </div>
                  ) : (
                    <button className="primary-button ai-analyze-button" onClick={() => openSettings('ai')}><Sparkles size={17} />配置 AI 模型</button>
                  )}
                </>
              )}
              {aiNotice && view === 'overview' ? <p className="ai-notice compact-notice">{aiNotice}</p> : null}
            </section>
            </CaptureLockedActions>
          </>
        ) : null}

        {!loading && openedPersistentViews.has('sop') ? (
          <PersistentView active={view === 'sop'}>
            <SopView
              url={sopSettings.url}
              draftUrl={sopDraft.url}
              notice={sopNotice}
              noticeTone={sopNoticeTone}
              onDraftChange={updateSopDraft}
              onSave={() => void saveSopConfiguration()}
              onReset={resetSopDraft}
              onOpenExternal={openSopExternally}
            />
          </PersistentView>
        ) : null}

        {!loading && openedPersistentViews.has('translation') ? (
          <PersistentView active={view === 'translation'}>
            <TranslationView />
          </PersistentView>
        ) : null}

        {!loading && view === 'settings' ? (
          <SettingsView
            focusSection={settingsSection}
            aiDraft={aiDraft}
            aiConfigured={aiConfigured}
            aiTesting={aiTesting}
            aiNotice={aiSettingsNotice}
            aiNoticeTone={aiSettingsNoticeTone}
            onAiChange={updateAiDraft}
            onSaveAi={() => void saveAiConfiguration()}
            onTestAi={() => void testConfiguredAi()}
          />
        ) : null}

        {!loading && view === 'ai-details' ? (
          <section className="ai-detail-view">
            <div className="ai-detail-hero">
              <div className="ai-overview-icon"><Sparkles size={19} /></div>
              <div><span className="eyebrow">会话智能分析</span><h2>{context?.conversation?.title ?? '当前会话'}</h2><p>{aiNotice || `基于 ${Math.min(currentMessageCount, 120)} 条最近消息`}</p></div>
              <button className="icon-button" onClick={() => requestAiAnalysis(true)} disabled={aiAnalyzing} aria-label="重新分析"><RefreshCw className={aiAnalyzing ? 'spin' : ''} size={16} /></button>
            </div>
            {aiAnalysis ? (
              <AiAnalysisResults
                result={aiAnalysis}
                confirmedStage={activeSopStage}
                onConfirmStage={() => aiAnalysis.stageId
                  ? confirmSopStage(
                      aiAnalysis.stageId,
                      'ai-confirmed',
                      aiAnalysis.confidence,
                      aiAnalysis.sopKnowledgeVersion ?? null,
                    )
                  : Promise.resolve()}
                onCopyReply={copyReply}
              />
            ) : (
              <div className="empty-state ai-detail-empty"><MessageCircleMore size={25} /><p>还没有结构化分析</p><span>可以直接在下方询问当前聊天</span></div>
            )}
            <AiChatPanel
              turns={aiChatTurns}
              question={aiQuestion}
              loading={aiChatLoading}
              messageCount={currentMessageCount}
              onQuestionChange={setAiQuestion}
              onSubmit={(question) => void askAiQuestion(question)}
              onCopy={copyReply}
            />
          </section>
        ) : null}

      </main>
      {profileModalOpen ? (
        <ProfileModal
          title="合作资料"
          subtitle={context?.conversation?.title ?? '当前会话'}
          dirty={profileDirty}
          onClose={() => {
            setProfileModalOpen(false);
            setProfileDirty(false);
          }}
        >
          <CaptureLockedActions locked={isRestoring} restoring={isRestoring}>
          <CooperationProfileView
            conversationId={activeConversationId}
            conversationTitle={context?.conversation?.title ?? ''}
            createdAt={currentRecord?.firstMessageAt ?? null}
            lastMessageAt={currentRecord?.lastMessageAt ?? null}
            hasHistoryStart={currentRecord?.hasHistoryStart ?? false}
            operatorName={cloudSettings.username}
            ownWhatsapp={cloudSettings.whatsappAccount}
            note={noteDraft}
            profile={activeProfile}
            suggestions={profileSuggestions}
            onSave={persistCooperationProfile}
            onDirtyChange={setProfileDirty}
            onSaveSuccess={() => {
              setProfileDirty(false);
              setProfileModalOpen(false);
            }}
          />
          </CaptureLockedActions>
        </ProfileModal>
      ) : null}
    </div>
  );
}
