import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, CircleDashed, ExternalLink } from 'lucide-react';
import type { RuntimeSummary, WorkspaceIssue, WorkspaceMetric, WorkspaceTone } from '../../types/domain';
import { cn } from '@/lib/utils';

const toneIcon: Record<WorkspaceTone, ReactNode> = {
  ready: <CheckCircle2 className="size-4" />,
  warning: <CircleAlert className="size-4" />,
  blocked: <AlertTriangle className="size-4" />,
  muted: <CircleDashed className="size-4" />,
  readonly: <CircleDashed className="size-4" />,
  loading: <CircleDashed className="size-4" />,
};

const metricTone: Record<WorkspaceTone, string> = {
  ready: 'text-success',
  warning: 'text-warning',
  blocked: 'text-destructive',
  muted: 'text-muted-foreground',
  readonly: 'text-muted-foreground',
  loading: 'text-muted-foreground',
};

export function WorkspaceMetricGrid({ items }: { items: WorkspaceMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
          <span className={cn('flex items-center gap-1.5 text-xs font-medium', metricTone[item.status_tone] || metricTone.muted)}>
            {toneIcon[item.status_tone] || toneIcon.muted}
            {item.label}
          </span>
          <strong className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</strong>
          <em className="text-xs not-italic text-muted-foreground">{item.detail}</em>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceIssueList({
  items,
  emptyLabel = '没有需要优先处理的事项。',
}: {
  items: WorkspaceIssue[];
  emptyLabel?: string;
}) {
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-success" />
        <span>{emptyLabel}</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          onClick={() => item.target && navigateTo(item.target)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors hover:bg-muted/50',
            item.severity === 'critical' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card',
          )}
        >
          {item.severity === 'critical' ? (
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
          ) : (
            <CircleAlert className="size-4 shrink-0 text-warning" />
          )}
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-medium text-foreground">{item.label}</strong>
            <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
          </div>
          {item.target ? <ExternalLink className="size-4 shrink-0 text-muted-foreground" /> : null}
        </button>
      ))}
    </div>
  );
}

export function RuntimeSummaryStrip({ summary }: { summary?: RuntimeSummary | null }) {
  if (!summary) return null;
  const blockers = [
    ...summary.missing_tools,
    ...summary.missing_skills,
    ...summary.inactive_tools,
    ...summary.inactive_skills,
  ];
  const cells = [
    { label: 'Runtime Manifest', value: summary.manifest_hash ? summary.manifest_hash.slice(0, 12) : '-' },
    { label: 'Direct Tools', value: summary.direct_tools.length },
    { label: 'Skill allowed tools', value: summary.skill_allowed_tools.length },
    { label: 'Runtime Tools', value: summary.runtime_tools.length },
    { label: '未通过项', value: blockers.length },
  ];
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-5',
        blockers.length ? 'border-destructive/30' : 'border-border',
      )}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1 bg-card p-3">
          <span className="text-xs text-muted-foreground">{cell.label}</span>
          <strong className="font-mono text-sm font-semibold text-foreground">{cell.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function navigateTo(path: string) {
  if (!path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}
