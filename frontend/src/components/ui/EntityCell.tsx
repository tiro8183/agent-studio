import type { ReactNode } from 'react';

interface EntityCellProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
}

export function EntityCell({ icon, title, subtitle }: EntityCellProps) {
  return (
    <div className="flex items-center gap-2.5">
      {icon ? (
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <strong className="block truncate text-sm font-medium text-foreground">{title}</strong>
        {subtitle ? <span className="block truncate text-xs text-muted-foreground">{subtitle}</span> : null}
      </div>
    </div>
  );
}
