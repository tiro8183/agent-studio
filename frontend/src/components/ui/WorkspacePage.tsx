import type { ReactNode } from 'react';
import { PageContainer, PageHeader } from '@/components/layout';

interface WorkspacePageProps {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WorkspacePage({ eyebrow, title, description, actions, children, className = '' }: WorkspacePageProps) {
  return (
    <PageContainer className={className}>
      <PageHeader
        title={
          <span className="flex flex-col gap-1">
            {eyebrow ? (
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</span>
            ) : null}
            <span>{title}</span>
          </span>
        }
        description={description}
        actions={actions}
      />
      {children}
    </PageContainer>
  );
}
