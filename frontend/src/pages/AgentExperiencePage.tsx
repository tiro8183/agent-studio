import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Braces,
  FileText,
  History,
  PlayCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/layout';
import { WorkspacePage } from '../components/ui';
import { canAtLeast } from '../services/authz';
import { toast } from '@/lib/toast';
import { ServiceIndexItem } from './ServiceIndexItem';
import {
  goRuns,
  goStudio,
  serviceAgentFromRelease,
  serviceProfile,
} from './agentServiceModel';
import type { WorkspacePageContext } from './pageContext';
import { useAgentExperienceSession } from './useAgentExperienceSession';
import { useServiceDirectory } from './useServiceDirectory';

export default function AgentExperiencePage({ currentUser }: WorkspacePageContext) {
  const [selectedId, setSelectedId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const preserveNextInputReset = useRef(false);

  const { agents, publishedAgents, entries: directoryEntries } = useServiceDirectory();
  const visibleAgents = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return directoryEntries;
    return directoryEntries.filter((entry) => {
      const displayAgent = serviceAgentFromRelease(entry.agent, entry.release);
      const profile = serviceProfile(entry);
      return (
        displayAgent.name.toLowerCase().includes(normalized)
        || displayAgent.description.toLowerCase().includes(normalized)
        || displayAgent.model.toLowerCase().includes(normalized)
        || profile.domain.toLowerCase().includes(normalized)
        || profile.department.toLowerCase().includes(normalized)
      );
    });
  }, [directoryEntries, keyword]);
  const selectedEntry = useMemo(
    () => directoryEntries.find((entry) => entry.agent.id === selectedId) || directoryEntries[0] || null,
    [directoryEntries, selectedId],
  );
  const selectedAgent = selectedEntry ? serviceAgentFromRelease(selectedEntry.agent, selectedEntry.release) : null;
  const selectedProfile = selectedEntry ? serviceProfile(selectedEntry) : null;
  const experienceSession = useAgentExperienceSession({ selectedAgent });
  const canCreateAgent = canAtLeast(currentUser?.membership.role, 'editor');
  const canViewIntegration = canAtLeast(currentUser?.membership.role, 'viewer');
  const experienceFacts = selectedProfile
    ? [
      { label: '上线版本', value: selectedProfile.versionLabel },
      { label: '业务域', value: selectedProfile.domain },
      { label: '处理边界', value: selectedProfile.actionScope },
      { label: '体验记录', value: experienceSession.hasRunEvidence ? '已生成' : '待生成' },
    ]
    : [];

  useEffect(() => {
    const focusedAgentId = sessionStorage.getItem('agent_forge_experience_agent');
    const focusedPrompt = sessionStorage.getItem('agent_forge_experience_prompt');
    if (focusedAgentId) sessionStorage.removeItem('agent_forge_experience_agent');
    if (focusedPrompt) {
      sessionStorage.removeItem('agent_forge_experience_prompt');
      preserveNextInputReset.current = true;
      experienceSession.setTaskBrief(focusedPrompt);
    }
    if (!selectedId && publishedAgents.length) {
      setSelectedId(publishedAgents.find((agent) => agent.id === focusedAgentId)?.id || publishedAgents[0].id);
    }
  }, [publishedAgents, selectedId]);

  useEffect(() => {
    if (preserveNextInputReset.current) {
      preserveNextInputReset.current = false;
      return;
    }
    experienceSession.resetSession();
  }, [selectedAgent?.id]);

  const copyText = async (value: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.warning('复制失败，请手动复制');
    }
  };

  return (
    <WorkspacePage
      icon={<PlayCircle size={14} />}
      eyebrow="运营"
      title="体验验证"
      description="选择已上线 Agent，用真实业务材料提交一次可留痕运行；页面验证和外部系统调用走同一套 `POST /v1/responses` 协议。"
    >
      <div className="flex min-h-0 gap-4">
        {/* Left rail: service list */}
        <aside className="flex w-60 shrink-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">选择服务</div>
              <div className="text-xs text-muted-foreground">仅展示已上线 Agent</div>
            </div>
            <Badge variant="secondary">{publishedAgents.length} 个</Badge>
          </div>
          <Input
            value={keyword}
            placeholder="搜索 Agent、适用任务或业务域"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="flex flex-col gap-2 overflow-y-auto">
            {visibleAgents.map(({ agent, release }) => (
              <ServiceIndexItem
                key={agent.id}
                agent={agent}
                release={release}
                active={selectedAgent?.id === agent.id}
                onSelect={() => setSelectedId(agent.id)}
              />
            ))}
            {!agents.isLoading && !publishedAgents.length && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-center">
                <CheckCircle2 size={18} className="text-muted-foreground" />
                <strong className="text-sm text-foreground">暂无可验证 Agent</strong>
                <span className="text-xs text-muted-foreground">
                  {canCreateAgent ? 'Agent 上线后会进入体验台。' : '请联系维护人完成 Agent 上线。'}
                </span>
                {canCreateAgent && (
                  <Button size="sm" onClick={goStudio}>
                    进入 Agent Studio
                  </Button>
                )}
              </div>
            )}
          </div>
        </aside>

        {selectedAgent && selectedProfile ? (
          <>
            {/* Main stage */}
            <main className="flex min-w-0 flex-1 flex-col gap-4">
              {/* Task board / current service header */}
              <SectionCard
                title={
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={15} className="shrink-0 text-muted-foreground" />
                    <span>当前服务</span>
                    <strong className="font-semibold text-foreground">{selectedAgent.name}</strong>
                    <span className="text-xs text-muted-foreground">{selectedProfile.scenario}</span>
                  </div>
                }
                actions={
                  <div className="flex items-center gap-1.5">
                    {[selectedProfile.domain, selectedProfile.department, selectedProfile.versionLabel].filter(Boolean).map((tag) => (
                      <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                    <Button variant="ghost" size="sm" onClick={goRuns} className="gap-1 text-xs">
                      <History size={13} />
                      运行记录
                    </Button>
                  </div>
                }
              >
                {/* Validation ledger */}
                <div className="grid grid-cols-4 gap-3 border-b border-border pb-4">
                  {experienceFacts.map((item) => (
                    <div key={item.label} className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-muted-foreground">{item.label}</span>
                      <strong className="text-sm font-medium text-foreground">{item.value}</strong>
                    </div>
                  ))}
                </div>

                {/* Protocol ribbon */}
                <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md bg-muted/40 px-4 py-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Braces size={13} className="text-muted-foreground" />
                    <span className="text-muted-foreground">执行协议</span>
                    <strong className="font-medium text-foreground">POST /v1/responses</strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Copy size={13} className="text-muted-foreground" />
                    <span className="text-muted-foreground">model 字段</span>
                    <strong className="font-medium text-foreground">{experienceSession.currentRunModel}</strong>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <History size={13} className="text-muted-foreground" />
                    <span className="text-muted-foreground">运行记录</span>
                    <strong
                      className="font-medium text-foreground"
                      title={experienceSession.lastRunId || undefined}
                    >
                      {experienceSession.shortEvidence(experienceSession.lastRunId)}
                    </strong>
                  </div>
                </div>
              </SectionCard>

              {/* Trial task bank */}
              <SectionCard
                title={
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-muted-foreground" />
                    <span>推荐验证任务</span>
                    <span className="text-xs text-muted-foreground">
                      {selectedProfile.trialCases.length ? '点击后写入任务目标' : '待维护'}
                    </span>
                  </div>
                }
              >
                <div className="flex flex-wrap gap-2">
                  {selectedProfile.trialCases.length > 0 ? (
                    selectedProfile.trialCases.slice(0, 4).map((item) => (
                      <button
                        type="button"
                        key={item}
                        disabled={experienceSession.running}
                        onClick={() => experienceSession.setTaskBrief(item)}
                        className="rounded-md border border-border bg-card px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {item}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      当前服务还没有推荐验证任务，可直接粘贴真实业务材料运行。
                    </span>
                  )}
                </div>
              </SectionCard>

              {/* Results board */}
              <SectionCard title="运行结果" contentPadding={false}>
                <div className="min-h-[200px] p-4">
                  {experienceSession.turns.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-8 text-center">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <PlayCircle size={16} />
                        <div className="text-left">
                          <div className="text-sm font-medium text-foreground">选择任务提交运行</div>
                          <div className="text-xs text-muted-foreground">
                            {selectedProfile.output} · 上线版本 {selectedProfile.versionLabel}
                          </div>
                        </div>
                      </div>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        建议粘贴真实材料、明确期望结果和业务边界；每次提交都会生成运行记录，便于复核。
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {[
                          { label: '复核清单', prompt: `请基于业务材料输出${selectedProfile.output}` },
                          { label: '风险排序', prompt: '请判断业务材料是否存在风险，并按严重程度排序' },
                          { label: '业务摘要', prompt: '请整理成可交付摘要，并保留关键事实依据' },
                        ].map(({ label, prompt }) => (
                          <button
                            type="button"
                            key={label}
                            disabled={experienceSession.running}
                            onClick={() => experienceSession.setTaskBrief(prompt)}
                            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {experienceSession.turns.map((item, index) => (
                        <div
                          key={`${item.role}-${index}`}
                          className={`flex flex-col gap-1 rounded-lg border p-3 ${
                            item.role === 'user'
                              ? 'border-border bg-muted/30'
                              : 'border-primary/20 bg-primary/5'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-muted-foreground">
                              {item.role === 'user' ? '任务输入' : '输出结果'}
                            </span>
                            <strong className="text-[11px] text-muted-foreground">
                              {item.role === 'user'
                                ? '业务材料'
                                : experienceSession.running && index === experienceSession.turns.length - 1
                                  ? '生成中'
                                  : '运行输出'}
                            </strong>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-foreground">
                            {item.content
                              || (experienceSession.running && index === experienceSession.turns.length - 1
                                ? '运行中...'
                                : '')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* Composer / submit panel */}
              <SectionCard
                title={
                  <div className="flex items-center gap-2">
                    <span>提交任务</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {experienceSession.running ? '服务处理中' : '等待业务材料'}
                    </span>
                  </div>
                }
              >
                <div className="flex gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Input
                      value={experienceSession.taskBrief}
                      disabled={experienceSession.running}
                      onChange={(e) => experienceSession.setTaskBrief(e.target.value)}
                      placeholder="任务目标，例如：整理风险点、依据和待确认事项"
                    />
                    <Textarea
                      rows={4}
                      value={experienceSession.input}
                      disabled={experienceSession.running}
                      onChange={(e) => experienceSession.setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && experienceSession.input.trim()) {
                          experienceSession.runExperience();
                        }
                      }}
                      placeholder="业务材料：粘贴合同、审批意见、客户诉求或其他真实材料"
                    />
                    <Input
                      value={experienceSession.acceptanceCriteria}
                      disabled={experienceSession.running}
                      onChange={(e) => experienceSession.setAcceptanceCriteria(e.target.value)}
                      placeholder="验收口径，例如：必须给出结论、依据、风险点和待确认事项"
                    />
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <Button
                      disabled={
                        experienceSession.running
                        || (!experienceSession.input.trim() && !experienceSession.taskBrief.trim())
                      }
                      onClick={experienceSession.runExperience}
                    >
                      {experienceSession.running ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          提交运行
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Send size={14} />
                          提交运行
                        </span>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        experienceSession.running
                        || (!experienceSession.turns.length && !experienceSession.conversationId)
                      }
                      onClick={() => experienceSession.resetSession({ keepInput: true })}
                    >
                      <RotateCcw size={14} />
                      重置
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </main>

            {/* Right inspector */}
            <aside className="flex w-56 shrink-0 flex-col gap-3" aria-label="Agent 说明">
              <SectionCard
                title={
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span>服务说明</span>
                    <span className="text-xs font-normal text-muted-foreground">{selectedProfile.versionLabel}</span>
                  </div>
                }
                contentPadding={false}
              >
                <div className="flex flex-col divide-y divide-border">
                  {[
                    { label: '业务域', value: selectedProfile.domain },
                    { label: '归属', value: selectedProfile.department },
                    { label: '维护人', value: selectedProfile.serviceOwner },
                    { label: '调用范围', value: selectedProfile.callerScope },
                    { label: '数据范围', value: selectedProfile.dataScope },
                    { label: '输出', value: selectedProfile.output },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2 px-4 py-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                      <strong className="text-right text-xs font-medium text-foreground">{value}</strong>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* Business boundary */}
              <SectionCard
                title={
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-muted-foreground" />
                    <span>业务边界</span>
                  </div>
                }
                contentPadding={false}
              >
                <div className="flex flex-col divide-y divide-border">
                  {[
                    { label: '处理方式', value: selectedProfile.actionScope },
                    { label: '支持方式', value: selectedProfile.sla },
                    { label: '执行入口', value: 'POST /v1/responses' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2 px-4 py-2">
                      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                      <strong className="text-right text-xs font-medium text-foreground">{value}</strong>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* Evidence status */}
              <SectionCard
                title={
                  <div className="flex items-center gap-1.5">
                    <History size={13} className="text-muted-foreground" />
                    <span>证据状态</span>
                  </div>
                }
              >
                <div className="flex flex-col gap-3">
                  <div
                    className={`flex items-start gap-2 rounded-md px-3 py-2 ${
                      experienceSession.hasRunEvidence
                        ? 'bg-success/10 text-success'
                        : 'bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    {experienceSession.hasRunEvidence ? (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    ) : (
                      <History size={14} className="mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <strong className="block text-xs font-semibold">
                        {experienceSession.hasRunEvidence ? '已生成运行记录' : '等待业务任务'}
                      </strong>
                      <span className="text-[11px]">
                        {experienceSession.hasRunEvidence
                          ? '可查看轨迹、输出和异常'
                          : '提交后生成可复核证据'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {[
                      {
                        label: '运行记录',
                        value: experienceSession.shortEvidence(experienceSession.lastRunId),
                        title: experienceSession.lastRunId || undefined,
                      },
                      {
                        label: '任务记录',
                        value: experienceSession.conversationId ? '已留痕' : '单次运行',
                        title: experienceSession.conversationId || undefined,
                      },
                      {
                        label: '响应',
                        value: experienceSession.shortEvidence(experienceSession.lastResponseId),
                        title: experienceSession.lastResponseId || undefined,
                      },
                    ].map(({ label, value, title }) => (
                      <div key={label} className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="text-[11px] text-muted-foreground">{label}</span>
                        <strong className="text-[11px] font-medium text-foreground" title={title}>
                          {value}
                        </strong>
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5"
                    disabled={!experienceSession.lastRunId}
                    onClick={goRuns}
                  >
                    <History size={13} />
                    查看运行证据
                  </Button>
                </div>
              </SectionCard>

              {/* API integration info */}
              {canViewIntegration && (
                <SectionCard
                  title="API 接入信息"
                  contentPadding={false}
                >
                  <div className="flex flex-col gap-3 p-4">
                    <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                      {[
                        { label: '标准入口', value: 'POST /v1/responses' },
                        { label: 'model 字段', value: experienceSession.currentRunModel },
                        { label: '上线版本', value: selectedProfile.versionLabel },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between gap-2 px-3 py-1.5">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <strong className="text-[11px] font-medium text-foreground">{value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-md border border-border bg-muted/30">
                      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <span className="text-xs font-medium text-foreground">协议请求</span>
                        <button
                          type="button"
                          onClick={() =>
                            copyText(JSON.stringify(experienceSession.requestPreview, null, 2), '协议请求')
                          }
                          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Copy size={11} />
                          复制
                        </button>
                      </div>
                      <pre className="overflow-x-auto p-3 text-[11px] text-foreground">
                        {JSON.stringify(experienceSession.requestPreview, null, 2)}
                      </pre>
                      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                        <span className="text-xs text-muted-foreground">流式响应</span>
                        <Switch checked disabled />
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => copyText(experienceSession.curlPreview, '调用示例')}
                    >
                      <Copy size={13} />
                      复制调用示例
                    </Button>
                  </div>
                </SectionCard>
              )}
            </aside>
          </>
        ) : (
          <section className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={20} className="text-muted-foreground" />
              <strong className="text-base text-foreground">暂无可验证 Agent</strong>
              <span className="text-sm text-muted-foreground">
                {canCreateAgent ? 'Agent 上线后会进入体验台。' : '请联系维护人完成 Agent 上线。'}
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
