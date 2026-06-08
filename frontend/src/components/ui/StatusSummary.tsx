import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusSummaryTone = 'ready' | 'warning' | 'blocked' | 'readonly' | 'empty';

export interface StatusSummaryItem {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: StatusSummaryTone;
}

interface StatusSummaryProps {
  badge: ReactNode;
  badgeTone?: StatusSummaryTone;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  items: StatusSummaryItem[];
  footer?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

const badgeToneClass: Record<StatusSummaryTone, string> = {
  ready: 'bg-success/12 text-success',
  warning: 'bg-warning/14 text-warning',
  blocked: 'bg-destructive/12 text-destructive',
  readonly: 'bg-muted text-muted-foreground',
  empty: 'bg-muted text-muted-foreground',
};

const itemToneClass: Record<StatusSummaryTone, string> = {
  ready: 'text-foreground',
  warning: 'text-warning',
  blocked: 'text-destructive',
  readonly: 'text-muted-foreground',
  empty: 'text-muted-foreground',
};

export function StatusSummary({
  badge,
  badgeTone = 'ready',
  title,
  description,
  actions,
  items,
  footer,
  className = '',
  ariaLabel,
}: StatusSummaryProps) {
  return (
    <section
      className={cn('rounded-xl border border-border bg-card p-5', className)}
      aria-label={ariaLabel}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
            badgeToneClass[badgeTone],
          )}
        >
          {badge}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-3"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {item.icon}
              {item.label}
            </span>
            <strong className={cn('text-xl font-semibold tracking-tight', itemToneClass[item.tone || 'ready'])}>
              {item.value}
            </strong>
            {item.detail ? <em className="text-xs not-italic text-muted-foreground">{item.detail}</em> : null}
          </div>
        ))}
      </div>
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">{footer}</div> : null}
    </section>
  );
}
