import type { ReactNode } from 'react';

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

export function MetricStrip({ items, columns = 4, className = '' }: MetricStripProps) {
  return (
    <div className={`metric-strip metric-strip-${columns} ${className}`.trim()}>
      {items.map((item, index) => (
        <div className={`metric-card tone-${item.tone || 'default'}`} key={`${item.label}-${index}`}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
          {item.hint && <small>{item.hint}</small>}
        </div>
      ))}
    </div>
  );
}
