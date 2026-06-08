import type { ReactNode } from 'react';

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
    <section className={`status-summary ${className}`.trim()} aria-label={ariaLabel}>
      <div className="status-summary-head">
        <span className={`status-summary-badge ${badgeTone}`}>{badge}</span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="status-summary-actions">{actions}</div>}
      </div>
      <div className="status-summary-grid">
        {items.map((item, index) => (
          <div className={item.tone || 'ready'} key={`${item.label}-${index}`}>
            {item.icon}
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.detail && <em>{item.detail}</em>}
          </div>
        ))}
      </div>
      {footer && <div className="status-summary-footer">{footer}</div>}
    </section>
  );
}
