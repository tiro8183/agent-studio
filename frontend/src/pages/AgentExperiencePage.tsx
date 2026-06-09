import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  History,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { canAtLeast } from '../services/authz';
import { toast } from '@/lib/toast';
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
  const [showDetails, setShowDetails] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preserveNextInputReset = useRef(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const { agents, publishedAgents, entries: directoryEntries } = useServiceDirectory();
  const selectedEntry = useMemo(
    () => directoryEntries.find((entry) => entry.agent.id === selectedId) || directoryEntries[0] || null,
    [directoryEntries, selectedId],
  );
  const selectedAgent = selectedEntry ? serviceAgentFromRelease(selectedEntry.agent, selectedEntry.release) : null;
  const selectedProfile = selectedEntry ? serviceProfile(selectedEntry) : null;
  const experienceSession = useAgentExperienceSession({ selectedAgent });
  const canCreateAgent = canAtLeast(currentUser?.membership.role, 'editor');
  const canViewIntegration = canAtLeast(currentUser?.membership.role, 'viewer');

  const suggestions = useMemo(() => {
    if (selectedProfile?.trialCases.length) return selectedProfile.trialCases.slice(0, 4);
    return [
      `请基于业务材料输出${selectedProfile?.output || '结论与依据'}`,
      '请判断业务材料是否存在风险，并按严重程度排序',
      '请整理成可交付摘要，并保留关键事实依据',
    ];
  }, [selectedProfile]);

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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [experienceSession.turns]);

  const copyText = async (value: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制`);
    } catch {
      toast.warning('复制失败，请手动复制');
    }
  };

  const canSubmit =
    !experienceSession.running && (Boolean(experienceSession.input.trim()) || Boolean(experienceSession.taskBrief.trim()));

  // Empty state — no published agents at all
  if (!agents.isLoading && (!selectedAgent || !selectedProfile)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <Sparkles className="size-5" />
          </div>
          <strong className="text-base text-foreground">暂无可验证 Agent</strong>
          <span className="text-sm text-muted-foreground">
            {canCreateAgent ? 'Agent 上线后会进入体验台，用真实业务材料做一次可留痕运行。' : '请联系维护人完成 Agent 上线。'}
          </span>
          {canCreateAgent && <Button onClick={goStudio}>进入 Agent Studio</Button>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-foreground">体验台</h1>
              <span className="text-xs text-muted-foreground">用真实业务材料做一次可留痕运行</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Select value={selectedAgent?.id} onValueChange={setSelectedId}>
                <SelectTrigger className="h-8 w-[260px]">
                  <SelectValue placeholder="选择已上线 Agent" />
                </SelectTrigger>
                <SelectContent>
                  {directoryEntries.map((entry) => {
                    const display = serviceAgentFromRelease(entry.agent, entry.release);
                    const profile = serviceProfile(entry);
                    return (
                      <SelectItem key={entry.agent.id} value={entry.agent.id}>
                        {display.name} · {profile.versionLabel}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Badge variant="secondary" className="font-mono">
                {experienceSession.currentRunModel}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={goRuns} className="gap-1.5">
            <History className="size-4" />
            运行记录
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={experienceSession.running || (!experienceSession.turns.length && !experienceSession.conversationId)}
            onClick={() => experienceSession.resetSession({ keepInput: true })}
            className="gap-1.5"
          >
            <RotateCcw className="size-4" />
            新对话
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title={showDetails ? '收起详情' : '展开详情'}
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Body: conversation + details */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Conversation column — the hero */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          {/* Thread */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {experienceSession.turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
                <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="size-6" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">向「{selectedAgent!.name}」提交一次业务任务</div>
                  <p className="max-w-md text-xs text-muted-foreground">
                    粘贴真实材料、明确期望结果；输出按「{selectedProfile!.output}」，上线版本 {selectedProfile!.versionLabel}。每次提交都会生成可复核的运行证据。
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {suggestions.map((item) => (
                    <button
                      type="button"
                      key={item}
                      disabled={experienceSession.running}
                      onClick={() => experienceSession.setTaskBrief(item)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-5 p-5">
                {experienceSession.turns.map((turn, index) => {
                  const isUser = turn.role === 'user';
                  const isStreaming =
                    experienceSession.running && index === experienceSession.turns.length - 1 && !isUser;
                  return (
                    <div key={`${turn.role}-${index}`} className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
                      {!isUser && (
                        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                          <Sparkles className="size-3.5" />
                        </div>
                      )}
                      <div
                        className={cn(
                          'max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                          isUser
                            ? 'rounded-br-sm bg-primary text-primary-foreground'
                            : 'rounded-bl-sm border border-border bg-muted/40 text-foreground',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {turn.content || (isStreaming ? '' : '')}
                          {isStreaming && (
                            <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-current align-middle" />
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border bg-card p-3">
            {/* Advanced fields: task brief + acceptance criteria */}
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown className={cn('size-3.5 transition-transform', showAdvanced && 'rotate-180')} />
                任务目标 / 验收口径
                {(experienceSession.taskBrief || experienceSession.acceptanceCriteria) && (
                  <span className="ml-1 size-1.5 rounded-full bg-primary" />
                )}
              </button>
              {showAdvanced && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input
                    value={experienceSession.taskBrief}
                    disabled={experienceSession.running}
                    onChange={(e) => experienceSession.setTaskBrief(e.target.value)}
                    placeholder="任务目标，例如：整理风险点、依据和待确认事项"
                  />
                  <Input
                    value={experienceSession.acceptanceCriteria}
                    disabled={experienceSession.running}
                    onChange={(e) => experienceSession.setAcceptanceCriteria(e.target.value)}
                    placeholder="验收口径，例如：必须给出结论、依据、风险点"
                  />
                </div>
              )}
            </div>

            <div className="relative">
              <Textarea
                value={experienceSession.input}
                disabled={experienceSession.running}
                onChange={(e) => experienceSession.setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
                    e.preventDefault();
                    experienceSession.runExperience();
                  }
                }}
                placeholder="粘贴合同、审批意见、客户诉求或其他真实业务材料…"
                className="max-h-48 min-h-[88px] resize-none pr-28"
              />
              <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                <span className="hidden text-[11px] text-muted-foreground sm:inline">⌘/Ctrl + ↵</span>
                <Button size="sm" disabled={!canSubmit} onClick={experienceSession.runExperience} className="gap-1.5">
                  {experienceSession.running ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  提交运行
                </Button>
              </div>
            </div>
          </div>
        </main>

        {/* Details panel — secondary, collapsible */}
        {showDetails && (
          <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto lg:flex" aria-label="服务详情">
            {/* Service summary */}
            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <span className="text-sm font-semibold text-foreground">服务说明</span>
                <Badge variant="secondary">{selectedProfile!.versionLabel}</Badge>
              </div>
              <div className="flex flex-col divide-y divide-border">
                {[
                  { label: '业务域', value: selectedProfile!.domain },
                  { label: '归属', value: selectedProfile!.department },
                  { label: '维护人', value: selectedProfile!.serviceOwner },
                  { label: '调用范围', value: selectedProfile!.callerScope },
                  { label: '数据范围', value: selectedProfile!.dataScope },
                  { label: '输出', value: selectedProfile!.output },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-2 px-4 py-2">
                    <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                    <strong className="text-right text-xs font-medium text-foreground">{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            {/* Business boundary */}
            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
                <ShieldCheck className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">业务边界</span>
              </div>
              <div className="flex flex-col divide-y divide-border">
                {[
                  { label: '处理方式', value: selectedProfile!.actionScope },
                  { label: '支持方式', value: selectedProfile!.sla },
                  { label: '执行入口', value: 'POST /v1/responses' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-2 px-4 py-2">
                    <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
                    <strong className="text-right text-xs font-medium text-foreground">{value}</strong>
                  </div>
                ))}
              </div>
            </section>

            {/* Evidence status */}
            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
                <History className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">证据状态</span>
              </div>
              <div className="flex flex-col gap-3 p-3">
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-md px-3 py-2',
                    experienceSession.hasRunEvidence ? 'bg-success/10 text-success' : 'bg-muted/50 text-muted-foreground',
                  )}
                >
                  {experienceSession.hasRunEvidence ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <History className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <strong className="block text-xs font-semibold">
                      {experienceSession.hasRunEvidence ? '已生成运行记录' : '等待业务任务'}
                    </strong>
                    <span className="text-[11px]">
                      {experienceSession.hasRunEvidence ? '可查看轨迹、输出和异常' : '提交后生成可复核证据'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {[
                    { label: '运行记录', value: experienceSession.shortEvidence(experienceSession.lastRunId), title: experienceSession.lastRunId },
                    { label: '任务记录', value: experienceSession.conversationId ? '已留痕' : '单次运行', title: experienceSession.conversationId },
                    { label: '响应', value: experienceSession.shortEvidence(experienceSession.lastResponseId), title: experienceSession.lastResponseId },
                  ].map(({ label, value, title }) => (
                    <div key={label} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                      <strong className="font-mono text-[11px] font-medium text-foreground" title={title || undefined}>
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
                  <History className="size-3.5" />
                  查看运行证据
                </Button>
              </div>
            </section>

            {/* API integration */}
            {canViewIntegration && (
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <span className="text-sm font-semibold text-foreground">API 接入</span>
                  <button
                    type="button"
                    onClick={() => copyText(experienceSession.curlPreview, '调用示例')}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Copy className="size-3" />
                    复制 cURL
                  </button>
                </div>
                <div className="p-3">
                  <div className="rounded-md border border-border bg-muted/30">
                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                      <span className="text-[11px] font-medium text-foreground">协议请求</span>
                      <button
                        type="button"
                        onClick={() => copyText(JSON.stringify(experienceSession.requestPreview, null, 2), '协议请求')}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Copy className="size-3" />
                        复制
                      </button>
                    </div>
                    <pre className="max-h-48 overflow-auto p-3 text-[11px] leading-relaxed text-foreground">
                      {JSON.stringify(experienceSession.requestPreview, null, 2)}
                    </pre>
                  </div>
                </div>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
