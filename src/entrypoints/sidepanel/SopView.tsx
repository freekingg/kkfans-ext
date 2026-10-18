import { BookOpenText, ExternalLink, RotateCcw, Save } from 'lucide-react';

interface SopViewProps {
  url: string;
  draftUrl: string;
  notice: string;
  noticeTone: 'success' | 'error' | 'info';
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onOpenExternal: () => void;
}

export function SopView({
  url,
  draftUrl,
  notice,
  noticeTone,
  onDraftChange,
  onSave,
  onReset,
  onOpenExternal,
}: SopViewProps) {
  return (
    <section className="sop-view">
      <div className="sop-toolbar">
        <div className="sop-toolbar-heading">
          <span className="sop-toolbar-icon"><BookOpenText size={17} /></span>
          <span><strong>SOP 工作台</strong><small>修改并保存后，页面会在下方重新加载</small></span>
          <button type="button" className="sop-external-button" onClick={onOpenExternal} title="在新标签页打开" aria-label="在新标签页打开 SOP"><ExternalLink size={15} /></button>
        </div>
        <div className="sop-url-row">
          <input
            type="url"
            value={draftUrl}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSave();
            }}
            placeholder="https://sop.example.com/?user=..."
            aria-label="SOP 页面地址"
          />
          <button type="button" className="sop-reset-button" onClick={onReset} title="恢复默认地址" aria-label="恢复默认 SOP 地址"><RotateCcw size={14} /></button>
          <button type="button" className="sop-save-button" onClick={onSave}><Save size={14} />保存</button>
        </div>
        {notice ? <p className={`sop-notice ${noticeTone}`}>{notice}</p> : null}
      </div>
      <div className="sop-frame-shell">
        <iframe src={url} title="SOP 工作台" referrerPolicy="no-referrer" />
      </div>
    </section>
  );
}
