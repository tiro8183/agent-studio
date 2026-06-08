import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Agent, AgentReleaseSnapshot } from '../types/domain';
import { serviceAgentFromRelease, serviceProfile } from './agentServiceModel';

interface ServiceIndexItemProps {
  agent: Agent;
  release?: AgentReleaseSnapshot;
  active: boolean;
  onSelect: () => void;
  variant?: 'rail' | 'ledger';
}

export function ServiceIndexItem({ agent, release, active, onSelect, variant = 'rail' }: ServiceIndexItemProps) {
  const displayAgent = serviceAgentFromRelease(agent, release);
  const profile = serviceProfile({ agent, release });

  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-lg border px-4 py-3 text-left transition-colors',
        'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary/40 bg-primary/5'
          : 'border-border bg-card',
        variant === 'ledger' ? 'space-y-2' : 'space-y-1.5',
      )}
      onClick={onSelect}
    >
      {/* Primary row: name + version badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <strong className="block truncate text-sm font-semibold text-foreground">
            {displayAgent.name}
          </strong>
          <span className="block truncate text-xs text-muted-foreground">{profile.scenario}</span>
        </div>
        <Badge variant="success" className="shrink-0">
          {profile.versionLabel}
        </Badge>
      </div>

      {/* Ledger variant: data grid cells */}
      {variant === 'ledger' ? (
        <div className="grid grid-cols-4 gap-x-4 gap-y-1 pt-1">
          {[
            { label: '业务域', value: profile.domain },
            { label: '归属', value: profile.department },
            { label: '维护人', value: profile.serviceOwner },
            { label: 'SLA', value: profile.sla },
            { label: '调用范围', value: profile.callerScope },
            { label: '数据分级', value: profile.dataClassification },
            {
              label: '接入状态',
              value: profile.integrationReady ? '可接入' : `${profile.catalogCompleteness}%`,
            },
          ].map(({ label, value }) => (
            <div key={label} className="min-w-0 space-y-0.5">
              <span className="block text-[10px] text-muted-foreground">{label}</span>
              <strong
                className={cn(
                  'block truncate text-xs font-medium',
                  label === '接入状态' && profile.integrationReady
                    ? 'text-success'
                    : 'text-foreground',
                )}
              >
                {value}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        /* Rail variant: inline meta tags */
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {[profile.domain, profile.department, profile.serviceOwner, profile.versionLabel]
            .filter(Boolean)
            .map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
        </div>
      )}
    </button>
  );
}
