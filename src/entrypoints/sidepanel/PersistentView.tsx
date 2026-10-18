import type { ReactNode } from 'react';

interface PersistentViewProps {
  active: boolean;
  children: ReactNode;
}

/** Keep an opened tab mounted while removing it from layout and accessibility navigation. */
export function PersistentView({ active, children }: PersistentViewProps) {
  return (
    <div className="persistent-view" hidden={!active} aria-hidden={!active}>
      {children}
    </div>
  );
}
