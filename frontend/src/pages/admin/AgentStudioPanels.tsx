import { Button, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { CheckCircle2, FileText, PlayCircle, Trash2 } from 'lucide-react';
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

const testStatusLabel: Record<AgentTestCase['last_status'], string> = {
  untested: '未运行',
  passed: '通过',
  failed: '未通过',
};

interface KnowledgePanelProps {
  editingAgent: Agent | null;
  documents: KnowledgeDocument[];
  uploadProps: UploadProps;
  uploadQuota?: UploadQuota;
  canEdit: boolean;
  onPreview: (documentId: string) => void;
  onDelete: (documentId: string) => void;
}

export function KnowledgePanel({
  editingAgent,
  documents,
  uploadProps,
  uploadQuota,
  canEdit,
  onPreview,
  onDelete,
}: KnowledgePanelProps) {
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
    <>
      <div className="builder-section-title">
        <span>业务资料</span>
        <p>上传服务专属业务资料，运行时会自动注入上下文。</p>
      </div>
      {editingAgent ? (
        <>
          <Upload {...uploadProps}>
            <Button
              icon={<FileText size={16} />}
              disabled={!canEdit}
              title={canEdit ? '上传业务资料' : '需编辑权限'}
            >
              上传业务资料
            </Button>
          </Upload>
          <p className="upload-policy-note">
            支持 {uploadExtensions}，单文件 {singleFileLimit}，组织剩余 {remainingQuota}。
          </p>
          <div className="knowledge-list">
            {documents.map((item) => (
              <div className="knowledge-row" key={item.id}>
                <div>
                  <strong>{item.file_name}</strong>
                  <span>
                    {Math.ceil(item.size / 1024)} KB · {item.char_count || 0} 字符 · {item.chunk_count || 0} 片段 · {item.status}
                  </span>
                  {item.preview && <em>{item.preview}</em>}
                </div>
                <Button
                  className="knowledge-preview-button"
                  size="small"
                  onClick={() => onPreview(item.id)}
                >
                  预览
                </Button>
                <Button
                  danger
                  size="small"
                  icon={<Trash2 size={14} />}
                  disabled={!canEdit}
                  title={canEdit ? '删除业务资料' : '需编辑权限'}
                  onClick={() => onDelete(item.id)}
                />
              </div>
            ))}
            {!documents.length && <div className="mini-empty">暂无业务资料</div>}
          </div>
        </>
      ) : (
        <div className="mini-empty">保存配置后可上传业务资料</div>
      )}
    </>
  );
}

interface RuntimePolicyPanelProps {
  editingAgent: Agent | null;
  agentOutputSchemaText: string;
  harnessToolDescriptionText: string;
  canEdit: boolean;
  onOutputSchemaChange: (value: string) => void;
  onHarnessToolDescriptionChange: (value: string) => void;
}

export function RuntimePolicyPanel({
  editingAgent,
  agentOutputSchemaText,
  harnessToolDescriptionText,
  canEdit,
  onOutputSchemaChange,
  onHarnessToolDescriptionChange,
}: RuntimePolicyPanelProps) {
  return (
    <>
      <div className="builder-section-title">
        <span>运行策略</span>
        <p>控制输出结构、人工确认和可访问路径；技术细节收进运行控制。</p>
      </div>
      <Space.Compact block>
        <Form.Item name={['output', 'mode']} label="输出模式" className="compact-field">
          <Select disabled={!canEdit} options={[
            { value: 'text', label: '文本' },
            { value: 'json_schema', label: '结构化输出' },
          ]} />
        </Form.Item>
        <Form.Item name={['permissions', 'allow_write']} label="允许写入" valuePropName="checked" className="compact-field">
          <Switch disabled={!canEdit} />
        </Form.Item>
        <Form.Item name={['filesystem', 'read_only']} label="文件只读" valuePropName="checked" className="compact-field">
          <Switch disabled={!canEdit} />
        </Form.Item>
      </Space.Compact>
      <details className="studio-expert-settings">
        <summary>运行控制</summary>
        <div className="studio-expert-grid">
          <Form.Item label="输出结构 Schema">
            <Input.TextArea
              rows={5}
              value={agentOutputSchemaText}
              disabled={!canEdit}
              onChange={(event) => onOutputSchemaChange(event.target.value)}
              placeholder='{"type":"object","properties":{"answer":{"type":"string"}}}'
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="interrupt_tools" label="人工确认工具" className="compact-field">
              <Select
                disabled={!canEdit}
                mode="tags"
                tokenSeparators={[',', '，']}
                placeholder="选择需要人工确认的工具"
              />
            </Form.Item>
            <Form.Item name={['permissions', 'allowed_paths']} label="可访问路径" className="compact-field">
              <Select disabled={!canEdit} mode="tags" tokenSeparators={[',', '，']} placeholder="输入允许访问的服务工作区范围" />
            </Form.Item>
          </Space.Compact>
          <div className="runtime-field-grid">
            <Form.Item name="engine_mode" label="Agent 运行时" className="compact-field">
              <Select disabled options={[{ value: 'deepagents', label: 'Agent 生产运行时' }]} />
            </Form.Item>
            <Form.Item name={['runtime', 'backend_type']} label="状态后端" className="compact-field">
              <Select disabled={!canEdit} options={[
                { value: 'filesystem', label: '工作区文件系统' },
                { value: 'store', label: '持久状态库' },
                { value: 'state', label: '会话内状态' },
              ]} />
            </Form.Item>
            <Form.Item name={['context_config', 'max_rounds']} label="最大上下文轮次" className="compact-field">
              <InputNumber disabled={!canEdit} min={1} max={100} />
            </Form.Item>
          </div>
          <div className="runtime-field-grid">
            <Form.Item name={['model_override', 'temperature']} label="温度参数" className="compact-field"><InputNumber disabled={!canEdit} min={0} max={2} step={0.1} /></Form.Item>
            <Form.Item name={['model_override', 'top_p']} label="Top-p 采样" className="compact-field"><InputNumber disabled={!canEdit} min={0} max={1} step={0.1} /></Form.Item>
            <Form.Item name={['model_override', 'max_tokens']} label="最大输出 Token" className="compact-field"><InputNumber disabled={!canEdit} min={1} max={200000} /></Form.Item>
            <Form.Item name="max_iterations" label="最大工具循环" className="compact-field"><InputNumber disabled={!canEdit} min={1} max={60} /></Form.Item>
          </div>
          <div className="runtime-field-grid">
            <Form.Item name={['runtime', 'debug']} label="开启调试日志" valuePropName="checked" className="compact-field">
              <Switch disabled={!canEdit} />
            </Form.Item>
            <Form.Item name={['runtime', 'checkpointing']} label="保存运行检查点" valuePropName="checked" className="compact-field">
              <Switch disabled={!canEdit} />
            </Form.Item>
            <Form.Item name={['harness', 'disable_general_purpose_subagent']} label="禁用默认通用角色" valuePropName="checked" className="compact-field">
              <Switch disabled={!canEdit} />
            </Form.Item>
            <Form.Item name={['filesystem', 'enabled']} label="工作区文件系统" valuePropName="checked" className="compact-field">
              <Switch disabled={!canEdit} />
            </Form.Item>
          </div>
          <div className="runtime-field-grid compact">
            <Form.Item name={['filesystem', 'mode']} label="文件系统模式" className="compact-field">
              <Select disabled={!canEdit} options={[
                { value: 'virtual', label: '隔离文件系统' },
                { value: 'state', label: '状态目录映射' },
              ]} />
            </Form.Item>
          </div>
          <Form.Item name={['harness', 'excluded_tools']} label="屏蔽内置工具">
            <Select
              disabled={!canEdit}
              mode="tags"
              tokenSeparators={[',', '，']}
              options={deepAgentBuiltinTools}
              placeholder="选择要从运行时隐藏的内置工具"
            />
          </Form.Item>
          <Form.Item label="工具说明覆盖">
            <Input.TextArea
              rows={5}
              value={harnessToolDescriptionText}
              disabled={!canEdit}
              onChange={(event) => onHarnessToolDescriptionChange(event.target.value)}
              placeholder='{"协作调度":"仅使用已配置的协作角色"}'
            />
          </Form.Item>
          <Form.List name={['routing', 'fixed_replies']}>
            {(fields, { add, remove }) => (
              <div className="rules-box">
                <div className="rules-title">
                  <span>命中式回复规则</span>
                  <Button size="small" disabled={!canEdit} onClick={() => add({ keywords: [], reply: '' })}>添加规则</Button>
                </div>
                {fields.map((field) => (
                  <div className="rule-row" key={field.key}>
                    <Form.Item name={[field.name, 'keywords']} label="关键词">
                      <Select disabled={!canEdit} mode="tags" tokenSeparators={[',', '，']} placeholder="输入后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'reply']} label="回复">
                      <Input.TextArea rows={2} disabled={!canEdit} />
                    </Form.Item>
                    <Button danger disabled={!canEdit} onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
              </div>
            )}
          </Form.List>
        </div>
      </details>
    </>
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
  toolOptions: Array<{ value: string; label: string }>;
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
  toolOptions: Array<{ value: string; label: string }>;
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
  const lastRunAt = item.last_run_at ? new Date(item.last_run_at).toLocaleString() : '未运行';
  const hasRunEvidence = Boolean(item.last_output || item.last_error || recentRuns.length);

  return (
    <div className="case-row">
      <div className="case-editor">
        <div className="case-main-fields">
          <Input
            value={item.name}
            disabled={!canEdit}
            placeholder="验收用例名称"
            onChange={(event) => onSetLocalCase(item.id, { name: event.target.value })}
          />
          <Input.TextArea
            rows={2}
            value={item.input_text}
            disabled={!canEdit}
            placeholder="输入一条需要稳定通过的真实业务请求"
            onChange={(event) => onSetLocalCase(item.id, { input_text: event.target.value })}
          />
          <div className="case-row-controls">
            <Select
              disabled={!canEdit}
              mode="tags"
              value={item.expected_keywords}
              tokenSeparators={[',', '，']}
              onChange={(value) => onSetLocalCase(item.id, {
                expected_keywords: value,
                assertion: { ...assertion, required_keywords: value },
              })}
              placeholder="输出必须包含的关键词"
            />
            <Select
              disabled={!canEdit}
              value={item.status}
              options={[
                { value: 'active', label: '纳入验收' },
                { value: 'inactive', label: '停用验收' },
              ]}
              onChange={(value) => onSetLocalCase(item.id, { status: value })}
            />
          </div>
        </div>

        <details className="case-advanced-details">
          <summary>
            <span>高级断言</span>
            <em>工具、协作角色、事件与结构约束</em>
          </summary>
          <div className="case-assertion-grid">
            <Select
              disabled={!canEdit}
              mode="multiple"
              value={assertion.required_tools}
              options={toolOptions}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_tools: value },
              })}
              placeholder="必须调用工具"
            />
            <Select
              disabled={!canEdit}
              mode="tags"
              value={assertion.required_subagents}
              tokenSeparators={[',', '，']}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_subagents: value },
              })}
              placeholder="必须委派协作角色"
            />
            <Select
              disabled={!canEdit}
              mode="multiple"
              value={assertion.required_event_types}
              options={runtimeEventOptions}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, required_event_types: value },
              })}
              placeholder="必须出现事件"
            />
            <InputNumber
              disabled={!canEdit}
              min={1}
              value={assertion.max_duration_ms}
              onChange={(value) => onSetLocalCase(item.id, {
                assertion: { ...assertion, max_duration_ms: value || null },
              })}
              placeholder="最大耗时 ms"
            />
          </div>
          <Input.TextArea
            rows={4}
            value={schemaText || '{}'}
            disabled={!canEdit}
            onChange={(event) => onCaseSchemaTextChange(item.id, event.target.value)}
            placeholder='结构化格式约束，例如 {"type":"object","required":["answer"]}'
          />
        </details>

        <details className="case-run-details">
          <summary>
            <span>运行证据</span>
            <em>{hasRunEvidence ? `最近结果 ${lastRunAt}` : '等待运行后生成证据'}</em>
          </summary>
          {item.last_output && <pre>{item.last_output}</pre>}
          {item.last_error && <em className="case-error">{item.last_error}</em>}
          {recentRuns.length > 0 ? (
            <div className="test-run-history">
              {recentRuns.map((run) => (
                <div key={run.id}>
                  {testRunStatusTag(run.status)}
                  <span>配置 {shortHash(run.runtime_plan_hash)}</span>
                  <span>{run.duration_ms || 0} ms</span>
                  <span>{run.ended_at ? new Date(run.ended_at).toLocaleString() : '运行中'}</span>
                  {run.agent_run_id && <button type="button" onClick={() => window.location.assign('/runs')}>{run.agent_run_id.slice(0, 12)}</button>}
                </div>
              ))}
            </div>
          ) : (
            <div className="mini-empty compact">暂无运行记录。</div>
          )}
        </details>
      </div>

      <div className="case-actions">
        <div className="case-result-stack">
          <Tag color={item.last_status === 'passed' ? 'success' : item.last_status === 'failed' ? 'error' : 'default'}>
            {testStatusLabel[item.last_status]}
          </Tag>
          <Tag color={freshness.color}>{freshness.label}</Tag>
          {item.last_runtime_plan_hash && (
          <Tag color="geekblue">配置 {shortHash(item.last_runtime_plan_hash)}</Tag>
          )}
          <span>{lastRunAt}</span>
        </div>
        <div className="case-action-buttons">
          <Button
            size="small"
            loading={isUpdatingCase}
            disabled={!canEdit}
            onClick={() => onUpdateCase(item.id, {
              name: item.name,
              input_text: item.input_text,
              expected_keywords: item.expected_keywords,
              assertion,
              status: item.status,
            })}
          >
            保存
          </Button>
          <Button size="small" loading={isRunningCase} disabled={!canEdit} onClick={() => onRunCase(item.id)}>运行</Button>
          <Popconfirm title="确定删除该验收用例？" disabled={!canEdit} onConfirm={() => onDeleteCase(item.id)}>
            <Button size="small" danger disabled={!canEdit}>删除</Button>
          </Popconfirm>
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
  return (
    <>
      <div className="studio-panel-block">
        <div className="builder-section-title">
          <span>验证服务配置</span>
          <p>用真实业务输入验证服务配置，输出和运行轨迹会形成证据。</p>
        </div>
        <div className="builder-test">
          <Input.TextArea
            rows={3}
            value={testInput}
            disabled={!canEdit}
            onChange={(event) => onTestInputChange(event.target.value)}
            placeholder="输入一条真实业务请求，例如：请整理这段材料中的风险点"
          />
          <Button loading={testRunning} disabled={!canEdit} title={canEdit ? '提交业务验证任务' : '需编辑权限'} onClick={onRunBuilderTest}>提交</Button>
          <div className="test-output">{testOutput || '业务验证输出会显示在这里。'}</div>
        </div>
      </div>

      <div className="studio-panel-block">
        <div className="builder-section-title">
          <span>验收套件</span>
          <p>沉淀可重复运行的业务样本，用来判断当前配置是否可以生成上线版本。</p>
        </div>
        {editingAgent ? (
          <div className="case-suite">
            <div className="case-suite-head">
              <div>
                <strong>{passedCases}/{activeCases}</strong>
                <span>纳入验收用例通过</span>
              </div>
              <div>
                <strong>{regressionCoveragePercent}%</strong>
                <span>配置覆盖</span>
              </div>
              <div>
                <strong>{regressionFailed + regressionStale + regressionUntested}</strong>
                <span>上线未通过用例</span>
              </div>
              <Space wrap>
                <Button
                  size="small"
                  icon={<PlayCircle size={14} />}
                  loading={isSuiteRunning}
                  disabled={!canEdit || !cases.some((item) => item.status === 'active')}
                  title={canEdit ? '验证服务配置' : '需编辑权限'}
                  onClick={onRunSuite}
                >
                  验证服务配置
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={isPublishing}
                  disabled={!canEdit || !canPublish}
                  onClick={onPublish}
                >
                  {publishActionLabel}
                </Button>
                <Button size="small" loading={isCreatingCase} disabled={!canEdit} onClick={onCreateCase}>添加验收用例</Button>
              </Space>
            </div>
            <div className={canPublish ? 'evaluation-release-callout ready' : 'evaluation-release-callout'}>
              <CheckCircle2 size={15} />
              <span>
                {canPublish
                  ? `${publishActionLabel}条件已满足。`
                  : publishDisabledReason || '完成验收并处理未通过项后，再生成上线版本。'}
              </span>
            </div>
            {coverage && (
              <div className="regression-control-plane">
                <div className="regression-control-metrics">
                  <div><span>失败</span><strong>{coverage.failed}</strong></div>
                  <div><span>运行中</span><strong>{coverage.running}</strong></div>
                  <div><span>需重跑</span><strong>{coverage.stale}</strong></div>
                  <div><span>未运行</span><strong>{coverage.untested}</strong></div>
                  <div><span>停用验收</span><strong>{coverage.inactive_cases}</strong></div>
                  <div><span>配置版本</span><strong>{shortHash(coverage.runtime_plan_hash)}</strong></div>
                </div>
                <div className="regression-case-queue">
                  {coverage.cases
                    .filter((item) => (
                      item.status === 'active'
                      && (item.freshness !== 'current'
                      || ['failed', 'error', 'running'].includes(item.result_status)
                      )
                    ))
                    .slice(0, 6)
                    .map((item) => (
                      <div key={item.id}>
                        <div>
                          {regressionResultTag(item.result_status)}
                          {regressionFreshnessTag(item.freshness)}
                          <strong>{item.name}</strong>
                        </div>
                        <span>{item.input_preview || '无输入预览'}</span>
                        <em>{item.last_run_at ? new Date(item.last_run_at).toLocaleString() : '未运行'}</em>
                      </div>
                    ))}
                  {!coverage.blockers.length && (
                    <div className="passed">
                      <CheckCircle2 size={15} />
                      <strong>纳入验收的用例均匹配服务配置</strong>
                    </div>
                  )}
                </div>
              </div>
            )}
            {suiteRuns.length > 0 && (
              <div className="suite-run-strip">
                {suiteRuns.slice(0, 3).map((item) => (
                  <div key={item.id}>
                    <strong>{item.passed}/{item.total}</strong>
                    <span>{item.status === 'completed' ? '通过' : item.status === 'failed' ? '失败' : '运行中'}</span>
                    <Tag color={item.status === 'completed' ? 'success' : item.status === 'failed' ? 'error' : 'processing'}>
                      配置 {shortHash(item.runtime_plan_hash)}
                    </Tag>
                    <em>{item.ended_at ? new Date(item.ended_at).toLocaleString() : '运行中'}</em>
                  </div>
                ))}
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
            {!cases.length && <div className="mini-empty">暂无验收用例</div>}
          </div>
        ) : (
          <div className="mini-empty">保存配置后可创建验收用例。</div>
        )}
      </div>
    </>
  );
}
