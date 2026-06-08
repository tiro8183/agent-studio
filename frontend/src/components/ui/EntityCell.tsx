import type { ReactNode } from 'react';

interface EntityCellProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
}

export function EntityCell({ icon, title, subtitle }: EntityCellProps) {
  return (
    <div className="entity-cell">
      {icon && <div className="entity-icon">{icon}</div>}
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
