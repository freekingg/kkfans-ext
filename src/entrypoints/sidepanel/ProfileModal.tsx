import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface ProfileModalProps {
  title: string;
  subtitle: string;
  dirty: boolean;
  children: ReactNode;
  onClose: () => void;
}

export function ProfileModal({
  title,
  subtitle,
  dirty,
  children,
  onClose,
}: ProfileModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  function requestClose() {
    if (dirtyRef.current && !window.confirm('合作资料尚未保存，确定放弃本次修改吗？')) return;
    onClose();
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const fields = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, select, textarea, button') ?? [])];
      const firstEmptyField = fields.find((field) =>
        (field instanceof HTMLInputElement
          || field instanceof HTMLSelectElement
          || field instanceof HTMLTextAreaElement)
        && !field.hasAttribute('disabled')
        && !field.value.trim(),
      );
      (firstEmptyField ?? fields.find((field) => !field.hasAttribute('disabled')))?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="profile-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
      >
        <header className="profile-modal-header">
          <div>
            <h2 id="profile-modal-title">{title}</h2>
            <p title={subtitle}>{subtitle}</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="关闭合作资料">
            <X size={18} />
          </button>
        </header>
        <div className="profile-modal-body">{children}</div>
      </div>
    </div>
  );
}
