import { StatusBadge } from './status-badge';

interface StatusTagProps {
  status?: string | boolean | null;
  trueLabel?: string;
  falseLabel?: string;
}

export function StatusTag({ status, trueLabel = '是', falseLabel = '否' }: StatusTagProps) {
  return <StatusBadge status={status} trueLabel={trueLabel} falseLabel={falseLabel} />;
}
