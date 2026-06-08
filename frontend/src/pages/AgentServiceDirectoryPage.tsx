import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from 'antd';
import {
  BookOpenCheck,
  CheckCircle2,
  Compass,
  ExternalLink,
  FileCheck2,
  PlayCircle,
  ShieldCheck,
  Copy,
  Search,
} from 'lucide-react';
import { WorkspacePage } from '../components/ui';
import { agentLifecycleMeta } from '../services/agentLifecycle';
import { canAtLeast } from '../services/authz';
import { ServiceIndexItem } from './ServiceIndexItem';
import {
  formatDate,
  goExperience,
  goStudio,
  serviceAgentFromRelease,
  serviceProfile,
  shortHash,
} from './agentServiceModel';
import type { WorkspacePageContext } from './pageContext';
import { useServiceDirectory } from './useServiceDirectory';

export default function AgentServiceDirectoryPage({ currentUser }: WorkspacePageContext) {
  const [selectedId, setSelectedId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>();
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [readinessFilter, setReadinessFilter] = useState<'all' | 'ready' | 'governance'>('all');

  const { agents, publishedAgents, entries: directoryEntries } = useServiceDirectory();
  const directoryFacets = useMemo(() => {
    const domains = new Set<string>();
    const departments = new Set<string>();
    directoryEntries.forEach((entry) => {
      const profile = serviceProfile(entry);
      if (profile.domain !== '业务域待完善') domains.add(profile.domain);
      if (profile.department !== '归属待完善') departments.add(profile.department);
    });
    return {
      domains: Array.from(domains).map((item) => ({ label: item, value: item })),
      departments: Array.from(departments).map((item) => ({ label: item, value: item })),
    };
  }, [directoryEntries]);
  const visibleAgents = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return directoryEntries.filter((entry) => {
      const displayAgent = serviceAgentFromRelease(entry.agent, entry.release);
      const profile = serviceProfile(entry);
      if (domainFilter && profile.domain !== domainFilter) return false;
      if (departmentFilter && profile.department !== departmentFilter) return false;
      if (readinessFilter === 'ready' && !profile.integrationReady) return false;
      if (readinessFilter === 'governance' && profile.integrationReady) return false;
      if (!normalized) return true;
      return (
        displayAgent.name.toLowerCase().includes(normalized)
        || displayAgent.description.toLowerCase().includes(normalized)
        || displayAgent.model.toLowerCase().includes(normalized)
        || profile.domain.toLowerCase().includes(normalized)
        || profile.department.toLowerCase().includes(normalized)
        || profile.serviceOwner.toLowerCase().includes(normalized)
      );
    });
  }, [departmentFilter, directoryEntries, domainFilter, keyword, readinessFilter]);
  const selectedEntry = useMemo(
    () => directoryEntries.find((entry) => entry.agent.id === selectedId) || directoryEntries[0] || null,
    [directoryEntries, selectedId],
  );
  const directoryStats = useMemo(() => {
    const owners = new Set<string>();
    let latestReleaseAt = '';
    let readyForIntegration = 0;
    let governancePending = 0;
    let servicesWithPrompts = 0;
    directoryEntries.forEach((entry) => {
      const profile = serviceProfile(entry);
      if (profile.serviceOwner !== '维护人待完善') owners.add(profile.serviceOwner);
      const releaseAt = entry.release?.created_at || entry.agent.published_at || '';
      if (releaseAt && (!latestReleaseAt || new Date(releaseAt).getTime() > new Date(latestReleaseAt).getTime())) {
        latestReleaseAt = releaseAt;
      }
      if (profile.integrationReady) readyForIntegration += 1;
      if (!profile.integrationReady) governancePending += 1;
      if (profile.trialCases.length) servicesWithPrompts += 1;
    });
    return {
      domains: directoryFacets.domains.length,
      departments: directoryFacets.departments.length,
      owners: owners.size,
      latestReleaseAt,
      governancePending,
      readyForIntegration,
      servicesWithPrompts,
    };
  }, [directoryEntries, directoryFacets.departments.length, directoryFacets.domains.length]);
  const selectedAgent = selectedEntry ? serviceAgentFromRelease(selectedEntry.agent, selectedEntry.release) : null;
  const latestRelease = selectedEntry?.release;
  const selectedProfile = selectedEntry ? serviceProfile(selectedEntry) : null;
  const selectedContractModel = selectedAgent ? `agent:${selectedAgent.slug || selectedAgent.id}` : '';
  const selectedCurl = selectedContractModel
    ? `curl -N /v1/responses \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${selectedContractModel}","input":"请在这里放入业务材料","stream":true}'`
    : '';
  const canCreateAgent = canAtLeast(currentUser?.membership.role, 'editor');

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard failure is non-blocking for service discovery.
    }
  };

  useEffect(() => {
    if (!selectedId && publishedAgents[0]) setSelectedId(publishedAgents[0].id);
  }, [publishedAgents, selectedId]);

  return (
    <WorkspacePage
      className="service-directory-page service-workspace-page"
      icon={<Compass size={14} />}
      eyebrow="运营"
      title="Agent 服务目录"
      description="面向业务使用方和外部系统接入方，只展示已上线 Agent，并给出验证入口与 API 调用信息。"
    >
      <section className="service-atlas">
        <div className="service-atlas-command">
          <div className="service-atlas-command-copy">
            <span>服务目录</span>
            <strong>{directoryStats.readyForIntegration} 个 Agent 可接入</strong>
            <p>按业务域、团队、维护人和上线版本筛选；调用标识用于 `POST /v1/responses` 的 model 字段。</p>
          </div>
          <div className="service-directory-controls">
            <Input.Search
              allowClear
              size="middle"
              value={keyword}
              className="service-atlas-search"
              placeholder="搜索 Agent、适用任务、业务域、团队或维护人"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              allowClear
              size="middle"
              placeholder="业务域"
              value={domainFilter}
              options={directoryFacets.domains}
              onChange={setDomainFilter}
            />
            <Select
              allowClear
              size="middle"
              placeholder="归属"
              value={departmentFilter}
              options={directoryFacets.departments}
              onChange={setDepartmentFilter}
            />
            <Select
              size="middle"
              value={readinessFilter}
              options={[
                { label: '全部状态', value: 'all' },
                { label: '仅看可接入', value: 'ready' },
                { label: '仅看待治理', value: 'governance' },
              ]}
              onChange={setReadinessFilter}
            />
          </div>
          <div className="service-directory-ledger" aria-label="Agent 服务目录摘要">
            <div><span>匹配 Agent</span><strong>{visibleAgents.length}</strong><em>{directoryStats.latestReleaseAt ? `${formatDate(directoryStats.latestReleaseAt)} 最近上线` : '暂无上线记录'}</em></div>
            <div><span>可接入</span><strong>{directoryStats.readyForIntegration}</strong><em>治理字段完整</em></div>
            <div><span>待治理</span><strong>{directoryStats.governancePending}</strong><em>需补齐目录信息</em></div>
            <div><span>维护人</span><strong>{directoryStats.owners}</strong><em>{directoryStats.departments} 个归属团队</em></div>
          </div>
          <div className="agent-market-actions" aria-label="Agent 广场入口">
            <button type="button" onClick={() => setReadinessFilter('ready')}>
              <CheckCircle2 size={14} />
              <span>只看可接入</span>
            </button>
            <button type="button" disabled={!selectedAgent} onClick={() => selectedAgent && goExperience(selectedAgent.id)}>
              <PlayCircle size={14} />
              <span>验证当前 Agent</span>
            </button>
            <button type="button" onClick={goStudio} disabled={!canCreateAgent}>
              <ExternalLink size={14} />
              <span>维护 Agent</span>
            </button>
          </div>
        </div>

        <div className="service-atlas-layout">
          <section className="service-map-board" aria-label="Agent 服务列表">
            <div className="service-list-head">
              <div>
                <Search size={15} />
                <span>Agent 列表</span>
                <strong>{visibleAgents.length} / {publishedAgents.length}</strong>
              </div>
              <em>先确认边界，再验证或接入</em>
            </div>
            {visibleAgents.map(({ agent, release }) => (
              <ServiceIndexItem
                key={agent.id}
                agent={agent}
                release={release}
                active={selectedAgent?.id === agent.id}
                variant="ledger"
                onSelect={() => setSelectedId(agent.id)}
              />
            ))}
            {!agents.isLoading && publishedAgents.length > 0 && visibleAgents.length === 0 && (
              <div className="service-workspace-empty">
                <CheckCircle2 size={18} />
                <strong>没有匹配的已上线 Agent</strong>
                <span>当前筛选条件下没有可用 Agent。</span>
              </div>
            )}
            {!agents.isLoading && !publishedAgents.length && (
              <div className="service-workspace-empty">
                <CheckCircle2 size={18} />
                <strong>暂无已上线 Agent</strong>
                <span>{canCreateAgent ? '在 Agent Studio 完成上线后会出现在这里。' : '请联系维护人完成 Agent 上线。'}</span>
                {canCreateAgent && <Button size="small" type="primary" onClick={goStudio}>进入 Agent Studio</Button>}
              </div>
            )}
          </section>

        {selectedAgent && selectedProfile ? (
          <aside className="service-brief-panel agent-profile-panel" aria-label="Agent 档案">
            <div className="agent-profile-head">
              <span>{selectedProfile.domain} · {selectedProfile.department}</span>
              <h2>{selectedAgent.name}</h2>
              <p>{selectedProfile.scenario}</p>
            </div>
            <div className="agent-profile-status">
              <span className={`service-status-pill ${agentLifecycleMeta[selectedAgent.status].tone}`}>
                {agentLifecycleMeta[selectedAgent.status].label}
              </span>
              {selectedProfile.displayTags.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className="agent-profile-actions">
              <Button type="primary" icon={<FileCheck2 size={15} />} disabled={!selectedProfile.integrationReady} onClick={() => copyText(selectedContractModel)}>
                {selectedProfile.integrationReady ? '复制 Agent 调用标识' : '接入信息待完善'}
              </Button>
              <Button icon={<PlayCircle size={15} />} onClick={() => goExperience(selectedAgent.id)}>验证</Button>
            </div>
            {!selectedProfile.integrationReady && (
              <div className="agent-profile-warning">
                <ShieldCheck size={14} />
                <span>待补齐：{selectedProfile.catalogGaps.join('、') || selectedProfile.approvalStatus}</span>
              </div>
            )}
            <section className="agent-profile-section">
              <div className="agent-profile-section-title">
                <FileCheck2 size={15} />
                <span>上线画像</span>
              </div>
              <div className="agent-profile-grid">
                <div><span>上线版本</span><strong>{selectedProfile.versionLabel}</strong></div>
                <div><span>最近上线</span><strong>{latestRelease ? formatDate(latestRelease.created_at) : selectedProfile.releaseText}</strong></div>
                <div><span>治理状态</span><strong>{selectedProfile.changeWindow}</strong></div>
                <div><span>维护人</span><strong>{selectedProfile.serviceOwner}</strong></div>
                <div><span>调用范围</span><strong>{selectedProfile.callerScope}</strong></div>
                <div><span>接入策略</span><strong>{selectedProfile.integrationPolicy}</strong></div>
                <div><span>目录完整度</span><strong>{selectedProfile.catalogCompleteness}%</strong></div>
              </div>
            </section>
            <section className="agent-profile-section">
              <div className="agent-profile-section-title">
                <ShieldCheck size={15} />
                <span>运行边界</span>
              </div>
              <div className="agent-boundary-list">
                <div><span>处理方式</span><strong>{selectedProfile.actionScope}</strong></div>
                <div><span>数据范围</span><strong>{selectedProfile.dataScope}</strong></div>
                <div><span>数据分级</span><strong>{selectedProfile.dataClassification}</strong></div>
                <div><span>风险等级</span><strong>{selectedProfile.riskLevel}</strong></div>
                <div><span>支持方式</span><strong>{selectedProfile.sla}</strong></div>
                <div><span>审批状态</span><strong>{selectedProfile.approvalStatus}</strong></div>
              </div>
            </section>
            <section className="agent-profile-section">
              <div className="agent-profile-section-title">
                <BookOpenCheck size={15} />
                <span>推荐验证任务</span>
                <strong>{selectedProfile.trialCases.length || 0}</strong>
              </div>
              {selectedProfile.trialCases.length > 0 ? (
                <div className="service-sample-strip">
                  {selectedProfile.trialCases.slice(0, 4).map((item) => (
                    <button type="button" key={item} onClick={() => goExperience(selectedAgent.id, item)}>
                      {item}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mini-empty compact">暂未维护推荐验证任务，可在体验台直接输入业务材料。</div>
              )}
            </section>
            <details className="service-integration-details">
              <summary>API 接入信息</summary>
              <div className="service-integration-grid">
                <div><span>执行入口</span><strong>POST /v1/responses</strong></div>
                <div><span>model 字段</span><strong>{selectedContractModel}</strong></div>
                <div><span>快照指纹</span><strong>{shortHash(selectedProfile.releaseSpecHash)}</strong></div>
              </div>
              <button type="button" disabled={!selectedProfile.integrationReady} onClick={() => copyText(selectedContractModel)}>
                <Copy size={13} />
                {selectedProfile.integrationReady ? '复制 Agent 调用标识' : '接入信息待完善'}
              </button>
              <button type="button" disabled={!selectedProfile.integrationReady} onClick={() => copyText(selectedCurl)}>
                <Copy size={13} />
                复制 curl 示例
              </button>
            </details>
          </aside>
        ) : (
          <section className="service-empty-pane">
            <div className="service-workspace-empty large">
              <CheckCircle2 size={20} />
              <strong>暂无已上线 Agent</strong>
              <span>{canCreateAgent ? 'Agent 上线后可进入体验台。' : '请联系维护人完成 Agent 上线。'}</span>
              {canCreateAgent && <Button type="primary" onClick={goStudio}>进入 Agent Studio</Button>}
            </div>
          </section>
        )}
        </div>
      </section>
    </WorkspacePage>
  );
}
