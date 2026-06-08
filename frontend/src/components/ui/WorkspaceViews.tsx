import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, CircleDashed, ExternalLink } from 'lucide-react';
import type { RuntimeSummary, WorkspaceIssue, WorkspaceMetric, WorkspaceTone } from '../../types/domain';

const toneIcon: Record<WorkspaceTone, ReactNode> = {
  ready: <CheckCircle2 size={15} />,
  warning: <CircleAlert size={15} />,
  blocked: <AlertTriangle size={15} />,
  muted: <CircleDashed size={15} />,
  readonly: <CircleDashed size={15} />,
  loading: <CircleDashed size={15} />,
};

export function WorkspaceMetricGrid({ items }: { items: WorkspaceMetric[] }) {
  return (
    <div className="workspace-metric-grid">
      {items.map((item) => (
        <div className={`workspace-metric ${item.status_tone}`} key={item.key}>
          {toneIcon[item.status_tone] || toneIcon.muted}
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.detail}</em>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceIssueList({ items, emptyLabel = '没有需要优先处理的事项。' }: { items: WorkspaceIssue[]; emptyLabel?: string }) {
  if (!items.length) {
    return (
      <div className="workspace-issue-empty">
        <CheckCircle2 size={15} />
        <span>{emptyLabel}</span>
      </div>
    );
  }
  return (
    <div className="workspace-issue-list">
      {items.map((item) => (
        <button
          type="button"
          className={`workspace-issue ${item.severity}`}
          key={item.key}
          onClick={() => item.target && navigateTo(item.target)}
        >
          {item.severity === 'critical' ? <AlertTriangle size={15} /> : <CircleAlert size={15} />}
          <div>
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </div>
          {item.target && <ExternalLink size={14} />}
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
  return (
    <div className={`runtime-summary-strip ${blockers.length ? 'blocked' : 'ready'}`}>
      <div>
        <span>Runtime Manifest</span>
        <strong>{summary.manifest_hash ? summary.manifest_hash.slice(0, 12) : '-'}</strong>
      </div>
      <div>
        <span>Direct Tools</span>
        <strong>{summary.direct_tools.length}</strong>
      </div>
      <div>
        <span>Skill allowed tools</span>
        <strong>{summary.skill_allowed_tools.length}</strong>
      </div>
      <div>
        <span>Runtime Tools</span>
        <strong>{summary.runtime_tools.length}</strong>
      </div>
      <div>
        <span>未通过项</span>
        <strong>{blockers.length}</strong>
      </div>
    </div>
  );
}

export function navigateTo(path: string) {
  if (!path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}
