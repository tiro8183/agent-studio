import type { ReactNode } from 'react';

interface TableToolbarProps {
  title?: ReactNode;
  description?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function TableToolbar({ title, description, filters, actions, className = '' }: TableToolbarProps) {
  return (
    <div className={`table-toolbar split ${className}`.trim()}>
      <div className="toolbar-copy">
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
      </div>
      <div className="toolbar-controls">
        {filters}
        {actions}
      </div>
    </div>
  );
}
