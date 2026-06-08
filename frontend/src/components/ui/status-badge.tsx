import { Badge, type BadgeProps } from './badge';
import { agentLifecycleLabel } from '@/services/agentLifecycle';

type Variant = NonNullable<BadgeProps['variant']>;

const statusMeta: Record<string, { label: string; variant: Variant }> = {
  active: { label: '启用', variant: 'success' },
  disabled: { label: '停用', variant: 'muted' },
  inactive: { label: '停用', variant: 'muted' },
  revoked: { label: '已撤销', variant: 'muted' },
  expired: { label: '已过期', variant: 'warning' },
  unpublished: { label: agentLifecycleLabel('unpublished'), variant: 'warning' },
  published: { label: agentLifecycleLabel('published'), variant: 'success' },
  success: { label: '成功', variant: 'success' },
  completed: { label: '完成', variant: 'success' },
  failed: { label: '失败', variant: 'destructive' },
  error: { label: '错误', variant: 'destructive' },
  blocked: { label: '已阻断', variant: 'destructive' },
  cancelled: { label: '已取消', variant: 'muted' },
  stale: { label: '超时', variant: 'warning' },
  healthy: { label: '可用', variant: 'success' },
  unchecked: { label: '未检测', variant: 'muted' },
  running: { label: '运行中', variant: 'info' },
  pending: { label: '待处理', variant: 'warning' },
  ready: { label: '就绪', variant: 'success' },
};

interface StatusBadgeProps {
  status?: string | boolean | null;
  trueLabel?: string;
  falseLabel?: string;
  className?: string;
}

export function StatusBadge({ status, trueLabel = '是', falseLabel = '否', className }: StatusBadgeProps) {
  if (typeof status === 'boolean') {
    return (
      <Badge variant={status ? 'success' : 'warning'} className={className}>
        {status ? trueLabel : falseLabel}
      </Badge>
    );
  }
  const value = (status || '').toString();
  const meta = statusMeta[value] || { label: value || '-', variant: 'muted' as Variant };
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}

export function HealthBadges({
  ready,
  score,
  blockers,
  warnings,
}: {
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={ready ? 'success' : 'destructive'}>{ready ? '就绪' : '未通过'}</Badge>
      <Badge variant={score >= 80 ? 'success' : score >= 60 ? 'warning' : 'destructive'}>{score}</Badge>
      {blockers > 0 ? <Badge variant="destructive">{blockers} 未通过项</Badge> : null}
      {warnings > 0 ? <Badge variant="warning">{warnings} 风险提示</Badge> : null}
    </span>
  );
}
