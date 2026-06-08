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
      className={[
        'service-index-item',
        `service-index-item-${variant}`,
        active ? 'active' : '',
      ].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <div className="service-index-primary">
        <div className="service-index-name">
          <strong>{displayAgent.name}</strong>
          <span>{profile.scenario}</span>
        </div>
        <span className="service-status-pill success">{profile.versionLabel}</span>
      </div>
      {variant === 'ledger' ? (
        <div className="service-index-ledger-cells">
          <div><span>业务域</span><strong>{profile.domain}</strong></div>
          <div><span>归属</span><strong>{profile.department}</strong></div>
          <div><span>维护人</span><strong>{profile.serviceOwner}</strong></div>
          <div><span>SLA</span><strong>{profile.sla}</strong></div>
          <div><span>调用范围</span><strong>{profile.callerScope}</strong></div>
          <div><span>数据分级</span><strong>{profile.dataClassification}</strong></div>
          <div><span>接入状态</span><strong>{profile.integrationReady ? '可接入' : `${profile.catalogCompleteness}%`}</strong></div>
        </div>
      ) : (
        <div className="service-index-meta">
          <span>{profile.domain}</span>
          <span>{profile.department}</span>
          <span>{profile.serviceOwner}</span>
          <span>{profile.versionLabel}</span>
        </div>
      )}
    </button>
  );
}
