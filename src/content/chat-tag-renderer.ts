import { browser } from 'wxt/browser';
import type {
  ConversationNoteMap,
  CooperationProfileMap,
  ConversationSopStageMap,
  ConversationTagMap,
  TagDefinition,
} from '../core/types';
import { getSopStageBadge } from '../sop/stages';
import { getCooperationSpecialStatusLabel } from '../business/statuses';
import {
  getCooperationProfiles,
  getConversationNotes,
  getConversationSopStages,
  getConversationTags,
  getTagDefinitions,
} from '../storage/settings';
import { identityFromChatRow, refreshVisibleContactConflicts } from '../whatsapp/conversation-identity';
import { selectors } from '../whatsapp/selectors';
import { isMetaHost } from '../platforms/page-target';
import { metaTagPlacement } from '../meta-inbox/dom';

const HOST_ATTRIBUTE = 'data-kkfans-tag-host';

interface TagHostPlacement {
  container: HTMLElement;
  after: HTMLElement | null;
}

interface TagDataSnapshot {
  map: ConversationTagMap;
  stageMap: ConversationSopStageMap;
  noteMap: ConversationNoteMap;
  profileMap: CooperationProfileMap;
  tagById: Map<string, TagDefinition>;
}

function findCommonAncestor(
  first: HTMLElement,
  second: HTMLElement,
  boundary: HTMLElement,
): HTMLElement | null {
  let candidate: HTMLElement | null = first.parentElement;
  while (candidate && candidate !== boundary) {
    if (candidate.contains(second)) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

function directChildWithin(element: HTMLElement, ancestor: HTMLElement): HTMLElement | null {
  let branch: HTMLElement | null = element;
  while (branch?.parentElement && branch.parentElement !== ancestor) {
    branch = branch.parentElement;
  }
  return branch?.parentElement === ancestor ? branch : null;
}

export function resolveTagHostPlacement(
  row: HTMLElement,
  title: HTMLElement,
): TagHostPlacement {
  if (isMetaHost()) {
    const placement = metaTagPlacement(row, title);
    if (placement) return placement;
    return { container: row, after: row.lastElementChild as HTMLElement | null };
  }
  const preview = row.querySelector<HTMLElement>(selectors.chatRowPreview);
  if (preview) {
    const container = findCommonAncestor(title, preview, row);
    if (container) {
      return {
        container,
        after: directChildWithin(preview, container),
      };
    }
  }

  // WhatsApp occasionally changes its internal wrappers. Keep the fallback
  // outside the title node so labels never return to the first/title line.
  const titleLine = title.parentElement;
  const contentContainer = titleLine?.parentElement;
  if (contentContainer && contentContainer !== row) {
    return { container: contentContainer, after: contentContainer.lastElementChild as HTMLElement | null };
  }
  return { container: row, after: row.lastElementChild as HTMLElement | null };
}

export class ChatTagRenderer {
  private observer: MutationObserver | null = null;
  private timer = 0;
  private lifecycleGeneration = 0;
  private refreshSequence = 0;
  private snapshot: TagDataSnapshot | null = null;
  private pendingRows = new Set<HTMLElement>();
  private pendingFullRender = false;
  private pendingReload = false;
  private selfRemovedHosts = new WeakSet<Node>();

  start(): void {
    this.stopObserver();
    this.lifecycleGeneration += 1;
    this.snapshot = null;
    this.observer = new MutationObserver((mutations) => {
      this.queueMutationRows(mutations);
    });
    // WhatsApp can replace #app as well as virtualized rows. Observe its stable
    // parent, but only process list structure and identity-related changes.
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'src', 'data-testid', 'role'],
    });
    browser.storage.onChanged.removeListener(this.handleStorageChange);
    browser.storage.onChanged.addListener(this.handleStorageChange);
    void this.refresh();
  }

  stop(): void {
    this.lifecycleGeneration += 1;
    this.stopObserver();
    this.snapshot = null;
    browser.storage.onChanged.removeListener(this.handleStorageChange);
    document.querySelectorAll<HTMLElement>(`[${HOST_ATTRIBUTE}]`).forEach((host) => host.remove());
  }

  async refresh(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingRows.clear();
    this.pendingFullRender = false;
    this.pendingReload = false;
    const lifecycleGeneration = this.lifecycleGeneration;
    const refreshSequence = ++this.refreshSequence;
    const [tags, map, stageMap, noteMap, profileMap] = await Promise.all([
      getTagDefinitions(),
      getConversationTags(),
      getConversationSopStages(),
      getConversationNotes(),
      getCooperationProfiles(),
    ]);
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || refreshSequence !== this.refreshSequence
    ) return;
    this.snapshot = {
      map,
      stageMap,
      noteMap,
      profileMap,
      tagById: new Map(tags.map((tag) => [tag.id, tag])),
    };
    this.renderRows(document.querySelectorAll<HTMLElement>(selectors.chatRows));
  }

  reconcileVisibleRows(): void {
    if (!this.observer) return;
    // Safety pass after a confirmed switch: cached data only, unchanged hosts
    // are retained. Never turn a chat click into another storage/cloud reload.
    this.pendingFullRender = true;
    this.scheduleFlush();
  }

  private renderRows(rows: Iterable<HTMLElement>): void {
    if (!this.snapshot) return;
    if (refreshVisibleContactConflicts()) rows = document.querySelectorAll<HTMLElement>(selectors.chatRows);
    for (const row of rows) {
      if (row.isConnected && row.matches(selectors.chatRows)) this.renderRow(row, this.snapshot);
    }
  }

  private renderRow(row: HTMLElement, snapshot: TagDataSnapshot): void {
    const { map, stageMap, noteMap, profileMap, tagById } = snapshot;
    const identity = identityFromChatRow(row);
    const title = row.querySelector<HTMLElement>(selectors.chatRowTitle);
    const previousHost = row.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
    if (!identity || !title) {
      this.removeHost(previousHost);
      return;
    }

    const selectedTags = (map[identity.id] ?? [])
      .map((id) => tagById.get(id))
      .filter((tag): tag is TagDefinition => Boolean(tag));
    const stage = stageMap[identity.id] ?? null;
    const note = noteMap[identity.id] ?? null;
    const specialStatus = profileMap[identity.id]?.specialStatus ?? null;
    if (!selectedTags.length && !stage && !note && !specialStatus) {
      this.removeHost(previousHost);
      return;
    }
    const tagSignature = JSON.stringify([
      specialStatus ?? stage?.stageId ?? null,
      selectedTags.map((tag) => [tag.id, tag.name, tag.color]),
      note?.text ?? null,
    ]);
    if (
      previousHost?.dataset.conversationId === identity.id &&
      previousHost.dataset.tagSignature === tagSignature
    ) {
      return;
    }
    this.removeHost(previousHost);

    const host = document.createElement('div');
    host.setAttribute(HOST_ATTRIBUTE, 'true');
    host.dataset.conversationId = identity.id;
    host.dataset.tagSignature = tagSignature;
    host.style.cssText = 'display:block;width:100%;min-width:0;height:20px;margin-top:2px;overflow:hidden;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display:block;min-width:0; }
        .wrap { display:flex;align-items:center;gap:4px;width:100%;min-width:0;height:20px;font-family:Inter,"Segoe UI",sans-serif; }
        .labels { display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden; }
        .stage-pill { flex:0 0 auto;padding:2px 6px;border:1px solid #cfc5f4;border-radius:7px;background:#f2efff;color:#5d49b6;font-size:10px;font-weight:750;line-height:14px;white-space:nowrap; }
        .stage-pill.special { border-color:#efcfad;background:#fff4e8;color:#955515; }
        .pill { max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 6px;border:1px solid color-mix(in srgb,var(--tag) 34%,transparent);border-radius:999px;background:color-mix(in srgb,var(--tag) 12%,white);color:color-mix(in srgb,var(--tag) 72%,#0f172a);font-size:10px;font-weight:650;line-height:14px; }
        .note-pill { display:inline-flex;align-items:center;max-width:116px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border:1px solid #ead9a9;border-radius:7px;background:#fff9e9;color:#735c1f;font-size:10px;font-weight:650;line-height:14px;cursor:help; }
      </style>
      <div class="wrap"><span class="labels"></span></div>
    `;
    const labels = shadow.querySelector('.labels');
    if (specialStatus || stage) {
      const stagePill = document.createElement('span');
      stagePill.className = `stage-pill${specialStatus ? ' special' : ''}`;
      stagePill.textContent = specialStatus
        ? getCooperationSpecialStatusLabel(specialStatus)
        : getSopStageBadge(stage!.stageId);
      stagePill.title = specialStatus
        ? `当前特殊状态：${getCooperationSpecialStatusLabel(specialStatus)}`
        : `当前确认阶段：${getSopStageBadge(stage!.stageId)}`;
      labels?.append(stagePill);
    }
    const hasStatus = Boolean(specialStatus || stage);
    const visibleTagCount = note ? (hasStatus ? 2 : 3) : hasStatus ? 3 : 4;
    for (const tag of selectedTags.slice(0, visibleTagCount)) {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.style.setProperty('--tag', tag.color);
      pill.textContent = tag.name;
      labels?.append(pill);
    }
    if (selectedTags.length > visibleTagCount) {
      const more = document.createElement('span');
      more.className = 'pill';
      more.style.setProperty('--tag', '#64748b');
      more.textContent = `+${selectedTags.length - visibleTagCount}`;
      labels?.append(more);
    }
    if (note) {
      const notePill = document.createElement('span');
      notePill.className = 'note-pill';
      notePill.textContent = `备注：${note.text.replace(/\s+/g, ' ')}`;
      notePill.title = note.text;
      labels?.append(notePill);
    }
    const placement = resolveTagHostPlacement(row, title);
    if (placement.after?.parentElement === placement.container) {
      placement.after.insertAdjacentElement('afterend', host);
    } else {
      placement.container.append(host);
    }
  }

  private scheduleFlush(): void {
    // Do not indefinitely postpone a pending repair during continuous list updates.
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.pendingReload) {
        void this.refresh();
        return;
      }
      const rows = this.pendingFullRender
        ? document.querySelectorAll<HTMLElement>(selectors.chatRows)
        : [...this.pendingRows];
      this.pendingRows.clear();
      this.pendingFullRender = false;
      this.renderRows(rows);
    }, 120);
  }

  private queueMutationRows(mutations: MutationRecord[]): void {
    const relevant = mutations.filter((mutation) => this.isChatListMutation(mutation));
    if (!relevant.length) return;

    for (const mutation of relevant) {
      const target = mutation.target instanceof Element
        ? mutation.target
        : mutation.target.parentElement;
      const targetRow = target?.closest<HTMLElement>(selectors.chatRows);
      if (targetRow) this.pendingRows.add(targetRow);

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element) || node.hasAttribute(HOST_ATTRIBUTE)) continue;
        if (node.matches(selectors.chatRows)) this.pendingRows.add(node as HTMLElement);
        node.querySelectorAll<HTMLElement>(selectors.chatRows)
          .forEach((row) => this.pendingRows.add(row));
      }
    }

    // A full list container replacement may not expose a row as the mutation target.
    if (!this.pendingRows.size) this.pendingFullRender = true;
    this.scheduleFlush();
  }

  private isChatListMutation(mutation: MutationRecord): boolean {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (target?.closest(`[${HOST_ATTRIBUTE}]`)) return false;
    if (mutation.type === 'characterData') {
      return Boolean(target?.closest(selectors.chatRows) && target.closest(selectors.chatRowTitle));
    }
    if (mutation.type === 'attributes') {
      if (!target?.closest(selectors.chatList)) return false;
      switch (mutation.attributeName) {
        case 'title': return Boolean(target.closest(selectors.chatRowTitle));
        case 'src': return target.matches('img');
        case 'data-testid':
        case 'role': return true;
        default: return false;
      }
    }
    const addedNodes = [...mutation.addedNodes].filter(
      (node) => !(node instanceof Element && node.hasAttribute(HOST_ATTRIBUTE)),
    );
    // Only ignore removals performed by this renderer. A host removed by
    // WhatsApp must be restored even if the row's identity is unchanged.
    const removedNodes = [...mutation.removedNodes].filter(
      (node) => !this.selfRemovedHosts.delete(node),
    );
    const changedNodes = [...addedNodes, ...removedNodes];
    if (changedNodes.length === 0) return false;
    if (target?.closest(selectors.chatList)) return true;
    return changedNodes.some((node) => {
      if (!(node instanceof Element)) return false;
      return (
        node.matches(selectors.chatList) ||
        node.matches(selectors.chatRows) ||
        Boolean(node.querySelector(selectors.chatList)) ||
        Boolean(node.querySelector(selectors.chatRows))
      );
    });
  }

  private removeHost(host: HTMLElement | null): void {
    if (!host) return;
    if (this.observer && host.isConnected) this.selfRemovedHosts.add(host);
    host.remove();
  }

  private stopObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pendingRows.clear();
    this.pendingFullRender = false;
    this.pendingReload = false;
    this.selfRemovedHosts = new WeakSet<Node>();
  }

  private handleStorageChange = (changes: Record<string, unknown>) => {
    if (
      'tagDefinitions' in changes ||
      'conversationTags' in changes ||
      'conversationNotes' in changes ||
      'cooperationProfiles' in changes ||
      'conversationSopStages' in changes
    ) {
      this.pendingReload = true;
      this.scheduleFlush();
    }
  };
}
