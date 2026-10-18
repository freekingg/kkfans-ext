import type { ConversationIdentity, TagDefinition } from '../core/types';
import {
  getConversationTags,
  getTagDefinitions,
  toggleConversationTag,
} from '../storage/settings';

export class TagPopover {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private identity: ConversationIdentity | null = null;
  private onChanged: () => void;

  constructor(onChanged: () => void) {
    this.onChanged = onChanged;
    this.host = document.createElement('div');
    this.host.dataset.kkfansTagPopover = 'true';
    this.host.style.cssText = 'position:fixed;z-index:2147483646;display:none;';
    this.root = this.host.attachShadow({ mode: 'open' });
    document.documentElement.append(this.host);
    document.addEventListener('pointerdown', this.handleOutsideClick, true);
    document.addEventListener('keydown', this.handleKeydown, true);
  }

  async open(identity: ConversationIdentity, anchor: DOMRect): Promise<void> {
    this.identity = identity;
    const [tags, map] = await Promise.all([getTagDefinitions(), getConversationTags()]);
    const selected = new Set(map[identity.id] ?? []);
    this.render(tags, selected);
    this.host.style.display = 'block';
    const width = 244;
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, anchor.right - width));
    const top = Math.min(window.innerHeight - 260, anchor.bottom + 8);
    this.host.style.left = `${left}px`;
    this.host.style.top = `${Math.max(12, top)}px`;
  }

  close(): void {
    this.host.style.display = 'none';
    this.identity = null;
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.handleOutsideClick, true);
    document.removeEventListener('keydown', this.handleKeydown, true);
    this.host.remove();
  }

  private render(tags: TagDefinition[], selected: Set<string>): void {
    this.root.innerHTML = `
      <style>
        :host { color-scheme: light; }
        .panel { width:220px;padding:12px;border:1px solid rgba(15,23,42,.1);border-radius:14px;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.2);font-family:Inter,"Segoe UI",sans-serif; }
        .title { margin:0 0 9px;color:#0f172a;font-size:13px;font-weight:700; }
        .hint { margin:0 0 10px;color:#64748b;font-size:11px; }
        .options { display:flex;flex-direction:column;gap:5px; }
        button { display:flex;align-items:center;gap:9px;width:100%;padding:8px 9px;border:0;border-radius:9px;background:transparent;color:#334155;font:500 13px/1.2 Inter,"Segoe UI",sans-serif;cursor:pointer;text-align:left; }
        button:hover { background:#f1f5f9; }
        button[aria-pressed="true"] { background:#ecfdf5;color:#047857; }
        .dot { width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--color) 18%,transparent);background:var(--color); }
        .check { margin-left:auto;font-weight:800; }
      </style>
      <div class="panel" role="dialog" aria-label="设置会话标签">
        <p class="title">设置标签</p>
        <p class="hint">标签仅保存在当前浏览器配置中</p>
        <div class="options"></div>
      </div>
    `;
    const options = this.root.querySelector('.options');
    for (const tag of tags) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(selected.has(tag.id)));
      button.innerHTML = `<span class="dot" style="--color:${tag.color}"></span><span></span><span class="check">${selected.has(tag.id) ? '✓' : ''}</span>`;
      const label = button.children[1];
      if (label) label.textContent = tag.name;
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        if (!this.identity) return;
        const next = await toggleConversationTag(this.identity.id, tag.id);
        selected.clear();
        next.forEach((id) => selected.add(id));
        this.render(tags, selected);
        this.onChanged();
      });
      options?.append(button);
    }
  }

  private handleOutsideClick = (event: Event) => {
    if (this.host.style.display === 'none') return;
    const path = event.composedPath();
    if (!path.includes(this.host)) this.close();
  };

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.close();
  };
}

