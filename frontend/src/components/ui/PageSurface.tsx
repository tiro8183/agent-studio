import type { ReactNode } from 'react';
import { SectionCard } from '@/components/layout';

interface PageSurfaceProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageSurface({ title, description, actions, children, className = '' }: PageSurfaceProps) {
  return (
    <SectionCard title={title} description={description} actions={actions} className={className}>
      {children}
    </SectionCard>
  );
}
