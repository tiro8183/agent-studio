import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  CheckCircle2,
  Compass,
  Copy,
  ExternalLink,
  FileCheck2,
  PlayCircle,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WorkspacePage } from '../components/ui';
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
      icon={<Compass size={14} />}
      eyebrow="运营"
      title="Agent 服务目录"
      description="面向业务使用方和外部系统接入方，只展示已上线 Agent，并给出验证入口与 API 调用信息。"
    >
      {/* Command / header strip */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        {/* Title + summary */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <span className="text-sm font-semibold text-foreground">服务目录</span>
            <p className="text-xs text-muted-foreground">
              按业务域、团队、维护人和上线版本筛选；调用标识用于 `POST /v1/responses` 的 model 字段。
            </p>
          </div>
          <Badge variant="success" className="shrink-0">
            {directoryStats.readyForIntegration} 个 Agent 可接入
          </Badge>
        </div>

        {/* Filters toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search with clear */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              placeholder="搜索 Agent、适用任务、业务域、团队或维护人"
              className="pl-8 pr-8"
              onChange={(e) => setKeyword(e.target.value)}
            />
            {keyword && (
              <button
                type="button"
                onClick={() => setKeyword('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Domain filter */}
          <Select
            value={domainFilter ?? '__all__'}
            onValueChange={(v) => setDomainFilter(v === '__all__' ? undefined : v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="业务域" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部业务域</SelectItem>
              {directoryFacets.domains.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Department filter */}
          <Select
            value={departmentFilter ?? '__all__'}
            onValueChange={(v) => setDepartmentFilter(v === '__all__' ? undefined : v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="归属" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">全部归属</SelectItem>
              {directoryFacets.departments.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Readiness filter */}
          <Select
            value={readinessFilter}
            onValueChange={(v) => setReadinessFilter(v as 'all' | 'ready' | 'governance')}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="ready">仅看可接入</SelectItem>
              <SelectItem value="governance">仅看待治理</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Stats ledger */}
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          aria-label="Agent 服务目录摘要"
        >
          {[
            {
              label: '匹配 Agent',
              value: visibleAgents.length,
              note: directoryStats.latestReleaseAt
                ? `${formatDate(directoryStats.latestReleaseAt)} 最近上线`
                : '暂无上线记录',
            },
            { label: '可接入', value: directoryStats.readyForIntegration, note: '治理字段完整' },
            { label: '待治理', value: directoryStats.governancePending, note: '需补齐目录信息' },
            {
              label: '维护人',
              value: directoryStats.owners,
              note: `${directoryStats.departments} 个归属团队`,
            },
          ].map(({ label, value, note }) => (
            <div
              key={label}
              className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2"
            >
              <span className="text-[11px] text-muted-foreground">{label}</span>
              <strong className="text-base font-semibold text-foreground">{value}</strong>
              <em className="text-[10px] not-italic text-muted-foreground">{note}</em>
            </div>
          ))}
        </div>

        {/* Quick-action buttons */}
        <div className="flex flex-wrap items-center gap-2" aria-label="Agent 广场入口">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReadinessFilter('ready')}
          >
            <CheckCircle2 className="size-3.5" />
            只看可接入
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!selectedAgent}
            onClick={() => selectedAgent && goExperience(selectedAgent.id)}
          >
            <PlayCircle className="size-3.5" />
            验证当前 Agent
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goStudio}
            disabled={!canCreateAgent}
          >
            <ExternalLink className="size-3.5" />
            维护 Agent
          </Button>
        </div>
      </div>

      {/* Main split layout: list + detail panel */}
      <div className="flex min-h-0 gap-4">
        {/* Left: Agent list */}
        <section
          className="flex w-[340px] shrink-0 flex-col gap-2 overflow-y-auto"
          aria-label="Agent 服务列表"
        >
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <Search className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Agent 列表</span>
              <strong className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {visibleAgents.length} / {publishedAgents.length}
              </strong>
            </div>
            <em className="text-[11px] not-italic text-muted-foreground">先确认边界，再验证或接入</em>
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
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-center">
              <CheckCircle2 className="size-5 text-muted-foreground" />
              <strong className="text-sm text-foreground">没有匹配的已上线 Agent</strong>
              <span className="text-xs text-muted-foreground">当前筛选条件下没有可用 Agent。</span>
            </div>
          )}

          {!agents.isLoading && !publishedAgents.length && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-center">
              <CheckCircle2 className="size-5 text-muted-foreground" />
              <strong className="text-sm text-foreground">暂无已上线 Agent</strong>
              <span className="text-xs text-muted-foreground">
                {canCreateAgent ? '在 Agent Studio 完成上线后会出现在这里。' : '请联系维护人完成 Agent 上线。'}
              </span>
              {canCreateAgent && (
                <Button size="sm" onClick={goStudio}>进入 Agent Studio</Button>
              )}
            </div>
          )}
        </section>

        {/* Right: Agent detail panel or empty state */}
        {selectedAgent && selectedProfile ? (
          <aside
            className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-5"
            aria-label="Agent 档案"
          >
            {/* Profile head */}
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">
                {selectedProfile.domain} · {selectedProfile.department}
              </span>
              <h2 className="text-base font-semibold text-foreground">{selectedAgent.name}</h2>
              <p className="text-sm text-muted-foreground">{selectedProfile.scenario}</p>
            </div>

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={selectedAgent.status} />
              {selectedProfile.displayTags.slice(0, 4).map((item) => (
                <Badge key={item} variant="secondary">{item}</Badge>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!selectedProfile.integrationReady}
                onClick={() => copyText(selectedContractModel)}
              >
                <FileCheck2 className="size-4" />
                {selectedProfile.integrationReady ? '复制 Agent 调用标识' : '接入信息待完善'}
              </Button>
              <Button
                variant="outline"
                onClick={() => goExperience(selectedAgent.id)}
              >
                <PlayCircle className="size-4" />
                验证
              </Button>
            </div>

            {/* Governance warning */}
            {!selectedProfile.integrationReady && (
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>
                  待补齐：{selectedProfile.catalogGaps.join('、') || selectedProfile.approvalStatus}
                </span>
              </div>
            )}

            {/* Release profile grid */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <FileCheck2 className="size-4 text-muted-foreground" />
                <span>上线画像</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {[
                  { label: '上线版本', value: selectedProfile.versionLabel },
                  {
                    label: '最近上线',
                    value: latestRelease
                      ? formatDate(latestRelease.created_at)
                      : selectedProfile.releaseText,
                  },
                  { label: '治理状态', value: selectedProfile.changeWindow },
                  { label: '维护人', value: selectedProfile.serviceOwner },
                  { label: '调用范围', value: selectedProfile.callerScope },
                  { label: '接入策略', value: selectedProfile.integrationPolicy },
                  { label: '目录完整度', value: `${selectedProfile.catalogCompleteness}%` },
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <strong className="block text-xs font-medium text-foreground">{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            {/* Boundary section */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <span>运行边界</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {[
                  { label: '处理方式', value: selectedProfile.actionScope },
                  { label: '数据范围', value: selectedProfile.dataScope },
                  { label: '数据分级', value: selectedProfile.dataClassification },
                  { label: '风险等级', value: selectedProfile.riskLevel },
                  { label: '支持方式', value: selectedProfile.sla },
                  { label: '审批状态', value: selectedProfile.approvalStatus },
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <strong className="block text-xs font-medium text-foreground">{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            {/* Trial tasks section */}
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <BookOpenCheck className="size-4 text-muted-foreground" />
                <span>推荐验证任务</span>
                <Badge variant="muted">{selectedProfile.trialCases.length || 0}</Badge>
              </div>
              {selectedProfile.trialCases.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.trialCases.slice(0, 4).map((item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => goExperience(selectedAgent.id, item)}
                      className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  暂未维护推荐验证任务，可在体验台直接输入业务材料。
                </p>
              )}
            </section>

            {/* API integration details (collapsible) */}
            <details className="group rounded-lg border border-border">
              <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors">
                API 接入信息
              </summary>
              <div className="border-t border-border px-4 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    { label: '执行入口', value: 'POST /v1/responses' },
                    { label: 'model 字段', value: selectedContractModel },
                    { label: '快照指纹', value: shortHash(selectedProfile.releaseSpecHash) },
                  ].map(({ label, value }) => (
                    <div key={label} className="space-y-0.5">
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                      <strong className="block truncate text-xs font-medium text-foreground font-mono">{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedProfile.integrationReady}
                    onClick={() => copyText(selectedContractModel)}
                  >
                    <Copy className="size-3.5" />
                    {selectedProfile.integrationReady ? '复制 Agent 调用标识' : '接入信息待完善'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedProfile.integrationReady}
                    onClick={() => copyText(selectedCurl)}
                  >
                    <Copy className="size-3.5" />
                    复制 curl 示例
                  </Button>
                </div>
              </div>
            </details>
          </aside>
        ) : (
          <section className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card">
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <CheckCircle2 className="size-6 text-muted-foreground" />
              <strong className="text-sm font-semibold text-foreground">暂无已上线 Agent</strong>
              <span className="text-xs text-muted-foreground">
                {canCreateAgent ? 'Agent 上线后可进入体验台。' : '请联系维护人完成 Agent 上线。'}
              </span>
              {canCreateAgent && (
                <Button onClick={goStudio}>进入 Agent Studio</Button>
              )}
            </div>
          </section>
        )}
      </div>
    </WorkspacePage>
  );
}
