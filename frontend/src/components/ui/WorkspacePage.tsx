import type { ReactNode } from 'react';

interface WorkspacePageProps {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkspacePage({ icon, eyebrow, title, description, actions, children, className = '' }: WorkspacePageProps) {
  return (
    <div className={`page workspace-page ${className}`.trim()}>
      <header className="page-header">
        <div>
          {eyebrow && (
            <div className="eyebrow">
              {icon}
              {eyebrow}
            </div>
          )}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
