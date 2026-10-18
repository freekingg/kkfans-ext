import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export function CaptureLockedActions({
  locked,
  children,
  restoring = false,
}: {
  locked: boolean;
  children: ReactNode;
  restoring?: boolean;
}) {
  return (
    <fieldset className="capture-locked-actions" disabled={locked}>
      {locked ? (
        <div className="capture-lock-notice" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={14} />
          <span><strong>{restoring ? '云端恢复中，下方操作已暂时锁定' : '消息读取中，下方操作已暂时锁定'}</strong><small>{restoring ? '恢复完成后自动解锁，避免覆盖正在编辑的资料' : '暂停或读取完成后会自动恢复'}</small></span>
        </div>
      ) : null}
      {children}
    </fieldset>
  );
}
