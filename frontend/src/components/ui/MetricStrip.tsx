import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MetricItem {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'brand';
  hint?: ReactNode;
}

interface MetricStripProps {
  items: MetricItem[];
  columns?: 3 | 4 | 5 | 6;
  className?: string;
}

const toneText: Record<NonNullable<MetricItem['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  brand: 'text-primary',
};

const colClass: Record<3 | 4 | 5 | 6, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export function MetricStrip({ items, columns = 4, className = '' }: MetricStripProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', colClass[columns], className)}>
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
        >
          <strong className={cn('text-2xl font-semibold tracking-tight', toneText[item.tone || 'default'])}>
            {item.value}
          </strong>
          <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
          {item.hint ? <small className="text-xs text-muted-foreground">{item.hint}</small> : null}
        </div>
      ))}
    </div>
  );
}
