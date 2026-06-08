import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TableToolbarProps {
  title?: ReactNode;
  description?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function TableToolbar({ title, description, filters, actions, className = '' }: TableToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0 space-y-0.5">
        {title ? <h2 className="text-sm font-semibold text-foreground">{title}</h2> : null}
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        {actions}
      </div>
    </div>
  );
}
