import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileText, PlayCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Confirm } from '@/components/ui/confirm';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  Agent,
  AgentRegressionCoverage,
  AgentTestAssertion,
  AgentTestCase,
  AgentTestRun,
  AgentTestSuiteRun,
  KnowledgeDocument,
  UploadQuota,
} from '../../types/domain';
import {
  deepAgentBuiltinTools,
  formatBytes,
  mergeAssertion,
  regressionFreshnessTag,
  regressionResultTag,
  runtimeEventOptions,
  shortHash,
  testCaseFreshness,
  testRunStatusTag,
} from './agentStudioModel';
import {
  StudioSelect,
  StudioSwitch,
  StudioNumber,
  StudioTags,
  StudioTextarea,
  MultiSelectControl,
  TagsControl,
  useFieldList,
  type Option,
  type StudioFormShim,
} from './studioForm';

const testStatusLabel: Record<AgentTestCase['last_status'], string> = {
  untested: '未运行',
  passed: '通过',
  failed: '未通过',
};

function SectionTitle({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-sm font-semibold text-foreground">{title}</span>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function MiniEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground', className)}>{children}</div>;
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '未运行';
}

function splitAssertionError(value?: string | null) {
  return (value || '')
    .split(/[；;]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function focusRunEvidence(runId?: string | null) {
  if (runId) sessionStorage.setItem('agent_forge_focus_run', runId);
  window.history.pushState({}, '', '/runs');
  window.dispatchEvent(new Event('popstate'));
}

interface KnowledgePanelProps {
  editingAgent: Agent | null;
  documents: KnowledgeDocument[];
  acceptExtensions: string;
  onUpload: (file: File) => void;
  uploadQuota?: UploadQuota;
  canEdit: boolean;
  onPreview: (documentId: string) => void;
  onDelete: (documentId: string) => void;
}

export function KnowledgePanel({
  editingAgent,
  documents,
  acceptExtensions,
  onUpload,
  uploadQuota,
  canEdit,
  onPreview,
  onDelete,
}: KnowledgePanelProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadExtensions = uploadQuota?.allowed_extensions?.length
    ? uploadQuota.allowed_extensions.join(' / ')
    : '文本类文件';
  const singleFileLimit = uploadQuota?.knowledge_upload_max_bytes
    ? formatBytes(uploadQuota.knowledge_upload_max_bytes)
    : '按组织策略限制';
  const remainingQuota = uploadQuota
    ? formatBytes(uploadQuota.remaining_bytes)
    : '读取中';

  return (
    <div className="space-y-4">
      <SectionTitle title="业务资料" description="上传服务专属业务资料，运行时会自动注入上下文。" />
      {editingAgent ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptExtensions}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = '';
            }}
          />
          <Button
            variant="outline"
            disabled={!canEdit}
            title={canEdit ? '上传业务资料' : '需编辑权限'}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText /> 上传业务资料
          </Button>
          <p className="text-xs text-muted-foreground">
            支持 {uploadExtensions}，单文件 {singleFileLimit}，组织剩余 {remainingQuota}。
          </p>
          <div className="space-y-2">
            {documents.map((item) => (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3" key={item.id}>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <strong className="block text-sm font-semibold text-foreground">{item.file_name}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {Math.ceil(item.size / 1024)} KB · {item.char_count || 0} 字符 · {item.chunk_count || 0} 片段 · {item.status}
                  </span>
                  {item.preview && <em className="block truncate text-xs text-muted-foreground">{item.preview}</em>}
                </div>
                <Button variant="outline" size="sm" onClick={() => onPreview(item.id)}>预览</Button>
                <Button
                  variant="destructive"
                  size="icon"
                  className="size-8"
                  disabled={!canEdit}
                  title={canEdit ? '删除业务资料' : '需编辑权限'}
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {!documents.length && <MiniEmpty>暂无业务资料</MiniEmpty>}
          </div>
        </>
      ) : (
        <MiniEmpty>保存配置后可上传业务资料</MiniEmpty>
      )}
    </div>
  );
}

interface RuntimePolicyPanelProps {
  form: StudioFormShim;
  editingAgent: Agent | null;
  agentOutputSchemaText: string;
  harnessToolDescriptionText: string;
  canEdit: boolean;
  onOutputSchemaChange: (value: string) => void;
  onHarnessToolDescriptionChange: (value: string) => void;
}

function FixedReplyRow({
  form,
  index,
  canEdit,
  onRemove,
}: {
  form: StudioFormShim;
  index: number;
  canEdit: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <StudioTags form={form} name={['routing', 'fixed_replies', index, 'keywords']} label="关键词" disabled={!canEdit} placeholder="输入后回车" />
      <StudioTextarea form={form} name={['routing', 'fixed_replies', index, 'reply']} label="回复" rows={2} disabled={!canEdit} />
      <Button variant="destructive" disabled={!canEdit} onClick={onRemove}>删除</Button>
    </div>
  );
}

export function RuntimePolicyPanel({
  form,
  agentOutputSchemaText,
  harnessToolDescriptionText,
  canEdit,
  onOutputSchemaChange,
  onHarnessToolDescriptionChange,
}: RuntimePolicyPanelProps) {
  const fixedReplies = useFieldList(form, ['routing', 'fixed_replies']);
  return (
    <div className="space-y-4">
      <SectionTitle title="运行策略" description="控制输出结构、人工确认和可访问路径；技术细节收进运行控制。" />
      <div className="grid gap-3 sm:grid-cols-3">
        <StudioSelect
          form={form}
          name={['output', 'mode']}
          label="输出模式"
          disabled={!canEdit}
          options={[
            { value: 'text', label: '文本' },
            { value: 'json_schema', label: '结构化输出' },
          ]}
        />
        <StudioSwitch form={form} name={['permissions', 'allow_write']} label="允许写入" disabled={!canEdit} />
        <StudioSwitch form={form} name={['filesystem', 'read_only']} label="文件只读" disabled={!canEdit} />
      </div>
      <details className="rounded-lg border border-border bg-muted/20 p-3.5">
        <summary className="cursor-pointer text-sm font-medium text-foreground">运行控制</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">输出结构 Schema</label>
            <Textarea
              rows={5}
              value={agentOutputSchemaText}
              disabled={!canEdit}
              onChange={(event) => onOutputSchemaChange(event.target.value)}
              placeholder='{"type":"object","properties":{"answer":{"type":"string"}}}'
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StudioTags form={form} name="interrupt_tools" label="人工确认工具" disabled={!canEdit} placeholder="选择需要人工确认的工具" />
            <StudioTags form={form} name={['permissions', 'allowed_paths']} label="可访问路径" disabled={!canEdit} placeholder="输入允许访问的服务工作区范围" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StudioSelect form={form} name="engine_mode" label="Agent 运行时" disabled options={[{ value: 'deepagents', label: 'Agent 生产运行时' }]} />
            <StudioSelect
              form={form}
              name={['runtime', 'backend_type']}
              label="状态后端"
              disabled={!canEdit}
              options={[
                { value: 'filesystem', label: '工作区文件系统' },
                { value: 'store', label: '持久状态库' },
                { value: 'state', label: '会话内状态' },
              ]}
            />
            <StudioNumber form={form} name={['context_config', 'max_rounds']} label="最大上下文轮次" disabled={!canEdit} min={1} max={100} />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <StudioNumber form={form} name={['model_override', 'temperature']} label="温度参数" disabled={!canEdit} min={0} max={2} step={0.1} />
            <StudioNumber form={form} name={['model_override', 'top_p']} label="Top-p 采样" disabled={!canEdit} min={0} max={1} step={0.1} />
            <StudioNumber form={form} name={['model_override', 'max_tokens']} label="最大输出 Token" disabled={!canEdit} min={1} max={200000} />
            <StudioNumber form={form} name="max_iterations" label="最大工具循环" disabled={!canEdit} min={1} max={60} />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <StudioSwitch form={form} name={['runtime', 'debug']} label="开启调试日志" disabled={!canEdit} />
            <StudioSwitch form={form} name={['runtime', 'checkpointing']} label="保存运行检查点" disabled={!canEdit} />
            <StudioSwitch form={form} name={['harness', 'disable_general_purpose_subagent']} label="禁用默认通用角色" disabled={!canEdit} />
            <StudioSwitch form={form} name={['filesystem', 'enabled']} label="工作区文件系统" disabled={!canEdit} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <StudioSelect
              form={form}
              name={['filesystem', 'mode']}
              label="文件系统模式"
              disabled={!canEdit}
              options={[
                { value: 'virtual', label: '隔离文件系统' },
                { value: 'state', label: '状态目录映射' },
              ]}
            />
          </div>
          <StudioTags
            form={form}
            name={['harness', 'excluded_tools']}
            label="屏蔽内置工具"
            disabled={!canEdit}
            options={deepAgentBuiltinTools}
            placeholder="选择要从运行时隐藏的内置工具"
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">工具说明覆盖</label>
            <Textarea
              rows={5}
              value={harnessToolDescriptionText}
              disabled={!canEdit}
              onChange={(event) => onHarnessToolDescriptionChange(event.target.value)}
              placeholder='{"协作调度":"仅使用已配置的协作角色"}'
            />
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">命中式回复规则</span>
              <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => fixedReplies.add({ keywords: [], reply: '' })}>添加规则</Button>
            </div>
            {fixedReplies.items.map((_, index) => (
              <FixedReplyRow key={index} form={form} index={index} canEdit={canEdit} onRemove={() => fixedReplies.remove(index)} />
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

interface EvaluationPanelProps {
  editingAgent: Agent | null;
  testInput: string;
  testOutput: string;
  testRunning: boolean;
  caseSchemaTexts: Record<string, string>;
  cases: AgentTestCase[];
  coverage?: AgentRegressionCoverage;
  suiteRuns: AgentTestSuiteRun[];
  runHistory: Record<string, AgentTestRun[]>;
  runtimePlanHash: string;
  passedCases: number;
  activeCases: number;
  regressionCoveragePercent: number;
  regressionFailed: number;
  regressionStale: number;
  regressionUntested: number;
  canPublish: boolean;
  publishDisabledReason: string;
  publishActionLabel: string;
  toolOptions: Option[];
  canEdit: boolean;
  isSuiteRunning: boolean;
  isPublishing: boolean;
  isCreatingCase: boolean;
  isUpdatingCase: boolean;
  isRunningCase: boolean;
  onTestInputChange: (value: string) => void;
  onRunBuilderTest: () => void;
  onRunSuite: () => void;
  onPublish: () => void;
  onCreateCase: () => void;
  onSetLocalCase: (caseId: string, patch: Record<string, unknown>) => void;
  onCaseSchemaTextChange: (caseId: string, value: string) => void;
  onUpdateCase: (caseId: string, values: {
    name: string;
    input_text: string;
    expected_keywords: string[];
    assertion: AgentTestAssertion;
    status: 'active' | 'inactive';
  }) => void;
  onRunCase: (caseId: string) => void;
  onDeleteCase: (caseId: string) => void;
}

interface EvaluationCaseRowProps {
  item: AgentTestCase;
  schemaText: string;
  recentRuns: AgentTestRun[];
  runtimePlanHash: string;
  toolOptions: Option[];
  canEdit: boolean;
  isUpdatingCase: boolean;
  isRunningCase: boolean;
  onSetLocalCase: (caseId: string, patch: Record<string, unknown>) => void;
  onCaseSchemaTextChange: (caseId: string, value: string) => void;
  onUpdateCase: (caseId: string, values: {
    name: string;
    input_text: string;
    expected_keywords: string[];
    assertion: AgentTestAssertion;
    status: 'active' | 'inactive';
  }) => void;
  onRunCase: (caseId: string) => void;
  onDeleteCase: (caseId: string) => void;
}

function EvaluationCaseRow({
  item,
  schemaText,
  recentRuns,
  runtimePlanHash,
  toolOptions,
  canEdit,
  isUpdatingCase,
  isRunningCase,
  onSetLocalCase,
  onCaseSchemaTextChange,
  onUpdateCase,
  onRunCase,
  onDeleteCase,
}: EvaluationCaseRowProps) {
  const assertion = mergeAssertion(item.assertion, item.expected_keywords);
  const freshness = testCaseFreshness(item, runtimePlanHash);
  const lastRunAt = formatDateTime(item.last_run_at);
  const hasRunEvidence = Boolean(item.last_output || item.last_error || recentRuns.length);
  const statusVariant: NonNullable<BadgeProps['variant']> = item.last_status === 'passed' ? 'success' : item.last_status === 'failed' ? 'destructive' : 'muted';
  const freshnessVariant: NonNullable<BadgeProps['variant']> = freshness.color === 'success' ? 'success' : freshness.color === 'warning' ? 'warning' : 'muted';
  const latestRun = recentRuns[0];
  const assertionErrors = splitAssertionError(item.last_error || latestRun?.error || latestRun?.assertion_errors?.join('；'));
  const isFailed = item.last_status === 'failed' || latestRun?.status === 'failed' || latestRun?.status === 'error';

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-3.5 lg:grid-cols-[1fr_auto]">
      <div className="space-y-3">
        {isFailed && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <strong className="font-semibold">验收未通过</strong>
              <Badge variant="destructive">配置 {shortHash(item.last_runtime_plan_hash || latestRun?.runtime_plan_hash)}</Badge>
              <span className="text-xs text-destructive/80">{lastRunAt}</span>
            </div>
            <div className="mt-2 grid gap-1.5">
              {assertionErrors.length ? assertionErrors.map((error) => (
                <span key={error} className="block">{error}</span>
              )) : (
                <span>本次运行未满足验收断言，请查看运行证据。</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {assertion.required_tools.length > 0 && <Badge variant="warning">要求工具 {assertion.required_tools.join('、')}</Badge>}
              {assertion.required_subagents.length > 0 && <Badge variant="warning">要求子代理 {assertion.required_subagents.join('、')}</Badge>}
              {assertion.required_event_types.length > 0 && <Badge variant="warning">要求事件 {assertion.required_event_types.join('、')}</Badge>}
              {(latestRun?.agent_run_id || item.last_run_id) && (
                <button
                  type="button"
                  className="ml-auto text-info hover:underline"
                  onClick={() => focusRunEvidence(latestRun?.agent_run_id || item.last_run_id)}
                >
                  打开 Run Evidence
                </button>
              )}
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Input
            value={item.name}
            disabled={!canEdit}
            placeholder="验收用例名称"
            onChange={(event) => onSetLocalCase(item.id, { name: event.target.value })}
          />
          <Textarea
            rows={2}
            value={item.input_text}
            disabled={!canEdit}
            placeholder="输入一条需要稳定通过的真实业务请求"
            onChange={(event) => onSetLocalCase(item.id, { input_text: event.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <TagsControl
              disabled={!canEdit}
              value={item.expected_keywords}
              onChange={(value) => onSetLocalCase(item.id, {
                expected_keywords: value,
                assertion: { ...assertion, required_keywords: value },
              })}
              placeholder="输出必须包含的关键词"
            />
            <Select
              disabled={!canEdit}
              value={item.status}
              onValueChange={(value) => onSetLocalCase(item.id, { status: value })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">纳入验收</SelectItem>
                <SelectItem value="inactive">停用验收</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <details className="rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer space-y-0.5 text-sm">
            <span className="font-medium text-foreground">高级断言</span>
            <em className="ml-2 text-xs not-italic text-muted-foreground">工具、协作角色、事件与结构约束</em>
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <MultiSelectControl
              disabled={!canEdit}
              value={assertion.required_tools}
              options={toolOptions}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_tools: value },
              })}
              placeholder="必须调用工具"
            />
            <TagsControl
              disabled={!canEdit}
              value={assertion.required_subagents}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_subagents: value },
              })}
              placeholder="必须委派协作角色"
            />
            <MultiSelectControl
              disabled={!canEdit}
              value={assertion.required_event_types}
              options={runtimeEventOptions}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_event_types: value },
              })}
              placeholder="必须出现事件"
            />
            <NumberInput
              disabled={!canEdit}
              min={1}
              value={assertion.max_duration_ms}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, max_duration_ms: value || null },
              })}
              placeholder="最大耗时 ms"
            />
          </div>
          <Textarea
            className="mt-2"
            rows={4}
            value={schemaText || '{}'}
            disabled={!canEdit}
            onChange={(event) => onCaseSchemaTextChange(item.id, event.target.value)}
            placeholder='结构化格式约束，例如 {"type":"object","required":["answer"]}'
          />
        </details>

        <details className="rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer space-y-0.5 text-sm">
            <span className="font-medium text-foreground">运行证据</span>
            <em className="ml-2 text-xs not-italic text-muted-foreground">{hasRunEvidence ? `最近结果 ${lastRunAt}` : '等待运行后生成证据'}</em>
          </summary>
          <div className="mt-3 space-y-2">
            {item.last_output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 font-mono text-xs text-foreground">{item.last_output}</pre>}
            {item.last_error && <em className="block text-xs not-italic text-destructive">{item.last_error}</em>}
            {recentRuns.length > 0 ? (
              <div className="space-y-1.5">
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {testRunStatusTag(run.status)}
                    <span>配置 {shortHash(run.runtime_plan_hash)}</span>
                    <span>{run.duration_ms || 0} ms</span>
                    <span>{run.ended_at ? new Date(run.ended_at).toLocaleString() : '运行中'}</span>
                    {run.agent_run_id && (
                      <button type="button" className="text-info hover:underline" onClick={() => focusRunEvidence(run.agent_run_id)}>{run.agent_run_id.slice(0, 12)}</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <MiniEmpty>暂无运行记录。</MiniEmpty>
            )}
          </div>
        </details>
      </div>

      <div className="flex flex-col gap-3 lg:w-48">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={statusVariant}>{testStatusLabel[item.last_status]}</Badge>
          <Badge variant={freshnessVariant}>{freshness.label}</Badge>
          {item.last_runtime_plan_hash && (
            <Badge variant="info">配置 {shortHash(item.last_runtime_plan_hash)}</Badge>
          )}
          <span className="text-xs text-muted-foreground">{lastRunAt}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || isUpdatingCase}
            onClick={() => onUpdateCase(item.id, {
              name: item.name,
              input_text: item.input_text,
              expected_keywords: item.expected_keywords,
              assertion,
              status: item.status,
            })}
          >
            {isUpdatingCase ? <Spinner className="text-current" /> : null} 保存
          </Button>
          <Button size="sm" variant="outline" disabled={!canEdit || isRunningCase} onClick={() => onRunCase(item.id)}>
            {isRunningCase ? <Spinner className="text-current" /> : null} 运行
          </Button>
          <Confirm title="确定删除该验收用例？" disabled={!canEdit} onConfirm={() => onDeleteCase(item.id)}>
            <Button size="sm" variant="destructive" disabled={!canEdit}>删除</Button>
          </Confirm>
        </div>
      </div>
    </div>
  );
}

export function EvaluationPanel({
  editingAgent,
  testInput,
  testOutput,
  testRunning,
  caseSchemaTexts,
  cases,
  coverage,
  suiteRuns,
  runHistory,
  runtimePlanHash,
  passedCases,
  activeCases,
  regressionCoveragePercent,
  regressionFailed,
  regressionStale,
  regressionUntested,
  canPublish,
  publishDisabledReason,
  publishActionLabel,
  toolOptions,
  canEdit,
  isSuiteRunning,
  isPublishing,
  isCreatingCase,
  isUpdatingCase,
  isRunningCase,
  onTestInputChange,
  onRunBuilderTest,
  onRunSuite,
  onPublish,
  onCreateCase,
  onSetLocalCase,
  onCaseSchemaTextChange,
  onUpdateCase,
  onRunCase,
  onDeleteCase,
}: EvaluationPanelProps) {
  const failedCoverageCases = (coverage?.cases || []).filter((item) => (
    item.status === 'active'
    && (item.freshness !== 'current' || ['failed', 'error', 'running', 'untested'].includes(item.result_status))
  ));
  const primaryFailure = failedCoverageCases.find((item) => item.result_status === 'failed' || item.result_status === 'error') || failedCoverageCases[0];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SectionTitle title="验证服务配置" description="用真实业务输入验证服务配置，输出和运行轨迹会形成证据。" />
        <div className="space-y-2">
          <Textarea
            rows={3}
            value={testInput}
            disabled={!canEdit}
            onChange={(event) => onTestInputChange(event.target.value)}
            placeholder="输入一条真实业务请求，例如：请整理这段材料中的风险点"
          />
          <Button variant="outline" disabled={!canEdit || testRunning} title={canEdit ? '提交业务验证任务' : '需编辑权限'} onClick={onRunBuilderTest}>
            {testRunning ? <Spinner className="text-current" /> : null} 提交
          </Button>
          <div className="min-h-[3rem] whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">{testOutput || '业务验证输出会显示在这里。'}</div>
        </div>
      </div>

      <div className="space-y-3">
        <SectionTitle title="验收套件" description="沉淀可重复运行的业务样本，用来判断当前配置是否可以生成上线版本。" />
        {editingAgent ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-3.5">
              <div>
                <strong className="block text-lg font-semibold text-foreground">{passedCases}/{activeCases}</strong>
                <span className="text-xs text-muted-foreground">纳入验收用例通过</span>
              </div>
              <div>
                <strong className="block text-lg font-semibold text-foreground">{regressionCoveragePercent}%</strong>
                <span className="text-xs text-muted-foreground">配置覆盖</span>
              </div>
              <div>
                <strong className="block text-lg font-semibold text-foreground">{regressionFailed + regressionStale + regressionUntested}</strong>
                <span className="text-xs text-muted-foreground">上线未通过用例</span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || isSuiteRunning || !cases.some((item) => item.status === 'active')}
                  title={canEdit ? '运行所有启用验收用例' : '需编辑权限'}
                  onClick={onRunSuite}
                >
                  {isSuiteRunning ? <Spinner className="text-current" /> : <PlayCircle />} 运行验收套件
                </Button>
                <Button
                  size="sm"
                  disabled={!canEdit || !canPublish || isPublishing}
                  onClick={onPublish}
                >
                  {isPublishing ? <Spinner className="text-current" /> : null} {publishActionLabel}
                </Button>
                <Button size="sm" variant="outline" disabled={!canEdit || isCreatingCase} onClick={onCreateCase}>
                  {isCreatingCase ? <Spinner className="text-current" /> : null} 添加验收用例
                </Button>
              </div>
            </div>
            <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', canPublish ? 'border-success/30 bg-success/8 text-success' : 'border-border bg-muted/30 text-muted-foreground')}>
              {canPublish ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
              <span>
                {canPublish
                  ? `${publishActionLabel}条件已满足。`
                  : publishDisabledReason || '完成验收并处理未通过项后，再生成上线版本。'}
              </span>
            </div>
            {coverage && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-3.5">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {[
                    { label: '失败', value: coverage.failed },
                    { label: '运行中', value: coverage.running },
                    { label: '需重跑', value: coverage.stale },
                    { label: '未运行', value: coverage.untested },
                    { label: '停用验收', value: coverage.inactive_cases },
                    { label: '配置版本', value: shortHash(coverage.runtime_plan_hash) },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
                      <span className="block text-xs text-muted-foreground">{stat.label}</span>
                      <strong className="text-sm font-semibold text-foreground">{stat.value}</strong>
                    </div>
                  ))}
                </div>
                {primaryFailure && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle className="size-4 shrink-0" />
                      <strong className="font-semibold">当前阻断：{primaryFailure.name}</strong>
                      {regressionResultTag(primaryFailure.result_status)}
                      {regressionFreshnessTag(primaryFailure.freshness)}
                      <Badge variant="info">配置 {shortHash(primaryFailure.last_runtime_plan_hash || coverage.runtime_plan_hash)}</Badge>
                    </div>
                    <div className="mt-2 grid gap-1.5">
                      {splitAssertionError(primaryFailure.last_error).map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                      {!primaryFailure.last_error && <span>该用例尚未产生可用通过结果，请重新运行验收套件。</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {primaryFailure.required_tools.length > 0 && <Badge variant="warning">要求工具 {primaryFailure.required_tools.join('、')}</Badge>}
                      {primaryFailure.required_subagents.length > 0 && <Badge variant="warning">要求子代理 {primaryFailure.required_subagents.join('、')}</Badge>}
                      {primaryFailure.required_event_types.length > 0 && <Badge variant="warning">要求事件 {primaryFailure.required_event_types.join('、')}</Badge>}
                      <span className="text-destructive/80">最近运行 {formatDateTime(primaryFailure.last_run_at)}</span>
                      {primaryFailure.agent_run_id && (
                        <button type="button" className="ml-auto text-info hover:underline" onClick={() => focusRunEvidence(primaryFailure.agent_run_id)}>
                          打开 Run Evidence
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {coverage.cases
                    .filter((item) => (
                      item.status === 'active'
                      && (item.freshness !== 'current'
                      || ['failed', 'error', 'running'].includes(item.result_status)
                      )
                    ))
                    .slice(0, 6)
                    .map((item) => (
                      <div key={item.id} className="space-y-1 rounded-md border border-border bg-background p-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {regressionResultTag(item.result_status)}
                          {regressionFreshnessTag(item.freshness)}
                          <strong className="text-sm font-semibold text-foreground">{item.name}</strong>
                        </div>
                        <span className="block text-xs text-muted-foreground">{item.input_preview || '无输入预览'}</span>
                        <em className="block text-xs not-italic text-muted-foreground">{item.last_run_at ? new Date(item.last_run_at).toLocaleString() : '未运行'}</em>
                      </div>
                    ))}
                  {!coverage.blockers.length && (
                    <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/8 px-2.5 py-2 text-sm text-success">
                      <CheckCircle2 className="size-4" />
                      <strong className="font-medium">纳入验收的用例均匹配服务配置</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
            {suiteRuns.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {suiteRuns.slice(0, 3).map((item) => {
                  const variant: NonNullable<BadgeProps['variant']> = item.status === 'completed' ? 'success' : item.status === 'failed' ? 'destructive' : 'info';
                  return (
                    <div key={item.id} className="space-y-1 rounded-lg border border-border bg-card p-3">
                      <strong className="block text-sm font-semibold text-foreground">{item.passed}/{item.total}</strong>
                      <span className="block text-xs text-muted-foreground">{item.status === 'completed' ? '通过' : item.status === 'failed' ? '失败' : '运行中'}</span>
                      <Badge variant={variant}>配置 {shortHash(item.runtime_plan_hash)}</Badge>
                      <em className="block text-xs not-italic text-muted-foreground">{item.ended_at ? new Date(item.ended_at).toLocaleString() : '运行中'}</em>
                    </div>
                  );
                })}
              </div>
            )}
            {cases.map((item) => (
              <EvaluationCaseRow
                key={item.id}
                item={item}
                schemaText={caseSchemaTexts[item.id] || '{}'}
                recentRuns={(runHistory[item.id] || []).slice(0, 3)}
                runtimePlanHash={runtimePlanHash}
                toolOptions={toolOptions}
                canEdit={canEdit}
                isUpdatingCase={isUpdatingCase}
                isRunningCase={isRunningCase}
                onSetLocalCase={onSetLocalCase}
                onCaseSchemaTextChange={onCaseSchemaTextChange}
                onUpdateCase={onUpdateCase}
                onRunCase={onRunCase}
                onDeleteCase={onDeleteCase}
              />
            ))}
            {!cases.length && <MiniEmpty>暂无验收用例</MiniEmpty>}
          </div>
        ) : (
          <MiniEmpty>保存配置后可创建验收用例。</MiniEmpty>
        )}
      </div>
    </div>
  );
}
