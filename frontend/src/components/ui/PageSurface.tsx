import type { ReactNode } from 'react';

interface PageSurfaceProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageSurface({ title, description, actions, children, className = '' }: PageSurfaceProps) {
  const hasHeader = title || description || actions;

  return (
    <section className={`surface page-surface ${className}`.trim()}>
      {hasHeader && (
        <div className="surface-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="surface-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
