import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Collapse, Drawer, Dropdown, Form, Input, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { Brain, Eye, FileText, GitBranch, MoreHorizontal, PackageCheck, Plus, ShieldAlert, Wrench } from 'lucide-react';
import { HealthTags, PageSurface } from '../../components/ui';
import { api } from '../../services/api';
import type { Skill, SkillHealth, SkillImpact, SkillImportPreview, SkillRuntimePreview, SkillVersionDiff } from '../../types/domain';
import { renderRuntimeResources, renderSkillChanges } from './renderers';

type SelectOption = {
  value: string;
  label: string;
};

interface SkillManagementProps {
  toolOptions: SelectOption[];
}

const defaultSkill = {
  name: '',
  display_name: '',
  description: '',
  instructions: '# 执行规范\n\n',
  allowed_tools: [],
  metadata: {},
  status: 'active',
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function agentStatusLabel(value?: string | null) {
  if (value === 'published') return '已上线';
  if (value === 'inactive') return '停用';
  if (value === 'unpublished') return '未上线';
  return value || '未知';
}

export function SkillManagement({ toolOptions }: SkillManagementProps) {
  const [skillOpen, setSkillOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [skillVersionOpen, setSkillVersionOpen] = useState(false);
  const [versioningSkill, setVersioningSkill] = useState<Skill | null>(null);
  const [skillRuntimePreview, setSkillRuntimePreview] = useState<SkillRuntimePreview | null>(null);
  const [skillImpact, setSkillImpact] = useState<SkillImpact | null>(null);
  const [skillImportPreview, setSkillImportPreview] = useState<SkillImportPreview | null>(null);
  const [skillVersionDiff, setSkillVersionDiff] = useState<SkillVersionDiff | null>(null);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string>();
  const [skillMetadataText, setSkillMetadataText] = useState('{}');
  const [skillExportText, setSkillExportText] = useState('');
  const [skillImportText, setSkillImportText] = useState('{\n  "kind": "agent-forge.skill",\n  "schema_version": 1,\n  "skill": {}\n}');
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [skillForm] = Form.useForm();
  const [skillImportForm] = Form.useForm();

  const skills = useQuery({ queryKey: ['skills'], queryFn: api.listSkills });
  const skillHealth = useQuery({ queryKey: ['skill-health'], queryFn: api.listSkillsHealth });
  const skillVersions = useQuery({
    queryKey: ['skill-versions', versioningSkill?.id],
    queryFn: () => api.listSkillVersions(versioningSkill!.id),
    enabled: Boolean(versioningSkill?.id && skillVersionOpen),
  });

  const skillHealthById = useMemo(
    () => Object.fromEntries((skillHealth.data || []).map((item) => [item.skill_id, item])) as Record<string, SkillHealth>,
    [skillHealth.data],
  );

  const skillsData = skills.data || [];
  const healthData = skillHealth.data || [];
  const toolLabelById = useMemo(
    () => Object.fromEntries(toolOptions.map((item) => [item.value, item.label])) as Record<string, string>,
    [toolOptions],
  );
  const governanceMetrics = useMemo(() => {
    const activeSkills = skillsData.filter((item) => item.status === 'active').length;
    const totalTools = skillsData.reduce((sum, item) => sum + (item.allowed_tools?.length || 0), 0);
    const blockerCount = healthData.reduce((sum, item) => sum + item.blockers, 0);
    const warningCount = healthData.reduce((sum, item) => sum + item.warnings, 0);
    const publishedBindings = healthData.reduce((sum, item) => sum + item.published_agents, 0);
    const readyCount = healthData.filter((item) => item.ready).length;
    const avgScore = healthData.length
      ? Math.round(healthData.reduce((sum, item) => sum + item.score, 0) / healthData.length)
      : 0;
    return {
      activeSkills,
      avgScore,
      blockerCount,
      publishedBindings,
      readyCount,
      totalSkills: skillsData.length,
      totalTools,
      warningCount,
    };
  }, [healthData, skillsData]);

  const riskItems = useMemo(
    () => healthData
      .filter((item) => item.blockers > 0 || item.warnings > 0 || item.published_agents > 0)
      .sort((a, b) => (
        b.blockers - a.blockers
        || b.warnings - a.warnings
        || b.published_agents - a.published_agents
        || a.display_name.localeCompare(b.display_name)
      ))
      .slice(0, 4),
    [healthData],
  );
  const selectedSkill = useMemo(
    () => skillsData.find((item) => item.id === selectedSkillId) || skillsData[0] || null,
    [selectedSkillId, skillsData],
  );
  const selectedSkillHealth = selectedSkill ? skillHealthById[selectedSkill.id] : undefined;
  const selectedInstructions = selectedSkill?.instructions?.trim() || '';

  const saveSkill = useMutation({
    mutationFn: (values: any) => {
      let metadata = {};
      try {
        metadata = JSON.parse(skillMetadataText || '{}');
      } catch {
        throw new Error('Skill metadata 必须是合法 JSON 对象');
      }
      const payload = { ...values, metadata };
      return editingSkill ? api.updateSkill(editingSkill.id, payload) : api.createSkill(payload);
    },
    onSuccess: () => {
      message.success('Skill 已保存');
      setSkillOpen(false);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Skill 保存失败');
    },
  });

  const publishSkill = useMutation({
    mutationFn: (id: string) => api.publishSkillVersion(id),
    onSuccess: () => {
      message.success('Skill 版本已记录');
      queryClient.invalidateQueries({ queryKey: ['skill-versions', versioningSkill?.id] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Skill 版本记录失败');
    },
  });

  const restoreSkill = useMutation({
    mutationFn: (params: { id: string; version: number }) => api.restoreSkillVersion(params.id, params.version),
    onSuccess: (saved) => {
      message.success('Skill 已恢复为历史版本');
      setVersioningSkill(saved);
      queryClient.invalidateQueries({ queryKey: ['skill-versions', saved.id] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Skill 恢复失败');
    },
  });

  const exportSkill = useMutation({
    mutationFn: (id: string) => api.exportSkill(id),
    onSuccess: (result) => {
      setSkillExportText(JSON.stringify(result, null, 2));
      message.success('Skill 导出包已生成');
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Skill 导出失败');
    },
  });

  const importSkill = useMutation({
    mutationFn: (values: any) => {
      let packageData = {};
      try {
        packageData = JSON.parse(skillImportText || '{}');
      } catch {
        throw new Error('Skill 导入包必须是合法 JSON 对象');
      }
      return api.importSkill({
        package: packageData as Record<string, unknown>,
        overwrite: Boolean(values.overwrite),
        preserve_id: Boolean(values.preserve_id),
      });
    },
    onSuccess: () => {
      message.success('Skill 已导入');
      setSkillImportOpen(false);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Skill 导入失败');
    },
  });

  const previewSkillImport = useMutation({
    mutationFn: (values: any) => {
      let packageData = {};
      try {
        packageData = JSON.parse(skillImportText || '{}');
      } catch {
        throw new Error('Skill 导入包必须是合法 JSON 对象');
      }
      return api.previewSkillImport({
        package: packageData as Record<string, unknown>,
        overwrite: Boolean(values.overwrite),
        preserve_id: Boolean(values.preserve_id),
      });
    },
    onSuccess: (result) => {
      setSkillImportPreview(result);
      message.success('导入检查完成');
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '导入检查失败');
    },
  });

  const diffSkillVersion = useMutation({
    mutationFn: (params: { id: string; version: number }) => api.diffSkillVersion(params.id, params.version),
    onSuccess: (result) => setSkillVersionDiff(result),
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '版本差异加载失败');
    },
  });

  const openSkill = (record?: Skill) => {
    setEditingSkill(record || null);
    skillForm.setFieldsValue(record || defaultSkill);
    setSkillMetadataText(JSON.stringify((record || defaultSkill).metadata || {}, null, 2));
    setSkillOpen(true);
  };

  const openSkillVersions = (record: Skill) => {
    setVersioningSkill(record);
    setSkillExportText('');
    setSkillVersionDiff(null);
    setSkillVersionOpen(true);
  };

  const openSkillRuntimePreview = async (record: Skill) => {
    try {
      setSkillRuntimePreview(await api.getSkillRuntimePreview(record.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Skill Runtime Preview 加载失败');
    }
  };

  const openSkillImpact = async (record: Skill) => {
    try {
      setSkillImpact(await api.getSkillImpact(record.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Skill 影响分析加载失败');
    }
  };

  const openSkillImport = () => {
    skillImportForm.setFieldsValue({ overwrite: false, preserve_id: false });
    setSkillImportText('{\n  "kind": "agent-forge.skill",\n  "schema_version": 1,\n  "skill": {}\n}');
    setSkillImportPreview(null);
    setSkillImportOpen(true);
  };

  const openDeleteSkillConfirm = (record: Skill) => {
    modal.confirm({
      title: '确定删除该 Skill？',
      content: '仍被 Agent、上线版本或存量运行引用时会被后端拒绝；请先在 Agent 中显式解绑。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.deleteSkill(record.id);
        queryClient.invalidateQueries({ queryKey: ['skills'] });
        queryClient.invalidateQueries({ queryKey: ['skill-health'] });
        queryClient.invalidateQueries({ queryKey: ['agents'] });
        queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
        message.success('Skill 已删除');
      },
    });
  };

  const assetActionItems: MenuProps['items'] = [
    { key: 'import', label: '导入 Skill' },
  ];

  return (
    <>
      <div className="asset-workflow-strip skill-workflow-strip" aria-label="Skill overview">
        <div>
          <span>Skills</span>
          <strong>{governanceMetrics.totalSkills}</strong>
          <em>可复用资产</em>
        </div>
        <div>
          <span>可用状态</span>
          <strong>{governanceMetrics.activeSkills}</strong>
          <em>可被 Agent 绑定</em>
        </div>
        <div>
          <span>Skill allowed tools</span>
          <strong>{governanceMetrics.totalTools}</strong>
          <em>授权引用</em>
        </div>
        <div>
          <span>上线检查</span>
          <strong>{governanceMetrics.readyCount}</strong>
          <em>通过检查</em>
        </div>
        <div>
          <span>已上线</span>
          <strong>{governanceMetrics.publishedBindings}</strong>
          <em>已上线引用</em>
        </div>
      </div>
      <div className="skill-workbench-grid">
        <PageSurface
          className="skill-policy-surface"
          title="Skill 治理边界"
          description="执行规范、Skill allowed tools、Runtime Preview、版本记录和影响范围共同决定一个 Skill 是否可进入生产。"
        >
          <div className="skill-policy-list">
            <div>
              <Brain size={16} />
              <span>{governanceMetrics.activeSkills}/{governanceMetrics.totalSkills} 个 Skill 可用，平均检查分 {skillHealth.isLoading ? '-' : governanceMetrics.avgScore}。</span>
            </div>
            <div>
              <Wrench size={16} />
              <span>{governanceMetrics.totalTools} 个 Skill allowed tools 会进入 Agent Runtime 配置和上线检查。</span>
            </div>
            <div>
              <PackageCheck size={16} />
              <span>{governanceMetrics.publishedBindings} 个已上线 Agent 引用 Skill，修改后需要重新评估影响。</span>
            </div>
          </div>
        </PageSurface>

        <PageSurface
          className="skill-risk-surface"
            title="待处理 Skills"
          description="只展示需要处理的上线检查和线上影响；日常治理以台账为主。"
        >
          {skillHealth.isLoading ? (
            <div className="mini-empty">正在加载 Skill 上线检查状态...</div>
          ) : riskItems.length > 0 ? (
            <div className="skill-risk-list">
              {riskItems.map((item) => {
                const checks = item.checks.filter((check) => !check.passed);
                const skill = skillsData.find((record) => record.id === item.skill_id);
                return (
                  <button
                    type="button"
                    className="skill-risk-item"
                    key={item.skill_id}
                    onClick={() => skill && openSkill(skill)}
                  >
                    <div className="skill-risk-head">
                      <span>{item.display_name || item.name}</span>
                      <HealthTags ready={item.ready} score={item.score} blockers={item.blockers} warnings={item.warnings} />
                    </div>
                    <div className="skill-risk-meta">
                      <span><GitBranch size={13} /> {item.bound_agents} 个 Agent 绑定</span>
                      <span><PackageCheck size={13} /> {item.published_agents} 个线上引用</span>
                    </div>
                    <div className="skill-risk-checks">
                      {checks.slice(0, 3).map((check) => (
                        <Tag color={check.severity === 'blocker' ? 'error' : 'warning'} key={check.key}>
                          {check.label}
                        </Tag>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="skill-empty-state">
              <ShieldAlert size={18} />
              <strong>当前没有待处理风险</strong>
              <span>所有 Skills 已具备上线前要求的基础检查状态。</span>
            </div>
          )}
        </PageSurface>
      </div>

      <PageSurface className="skill-asset-console">
        <div className="skill-console-head">
          <div>
            <span>Skill Registry</span>
            <strong>说明书、Skill allowed tools、影响范围和版本治理在同一处判断。</strong>
          </div>
          <Space>
            <Dropdown
              trigger={['click']}
              menu={{
                items: assetActionItems,
                onClick: ({ key }) => {
                  if (key === 'import') openSkillImport();
                },
              }}
            >
              <Button icon={<MoreHorizontal size={14} />}>更多</Button>
            </Dropdown>
            <Button type="primary" icon={<Plus size={16} />} onClick={() => openSkill()}>
              新建 Skill
            </Button>
          </Space>
        </div>

        <div className="skill-console-grid">
          <section className="skill-ledger-panel" aria-label="Skill list">
            {skills.isLoading && <div className="mini-empty">正在加载 Skill 资产...</div>}
            {!skills.isLoading && skillsData.map((record) => {
              const health = skillHealthById[record.id];
              const active = selectedSkill?.id === record.id;
              return (
                <button
                  type="button"
                  key={record.id}
                  className={active ? 'skill-ledger-item active' : 'skill-ledger-item'}
                  onClick={() => setSelectedSkillId(record.id)}
                >
                  <div className="skill-ledger-main">
                    <div>
                      <strong>{record.display_name || record.name}</strong>
                      <span>{record.description || '未填写使用边界'}</span>
                    </div>
                    <Tag color={record.status === 'active' ? 'success' : 'default'}>
                      {record.status === 'active' ? '启用' : '停用'}
                    </Tag>
                  </div>
                  <div className="skill-ledger-meta">
                    <span>v{record.version}</span>
                    <span>{record.allowed_tools.length} Tools</span>
                    <span>{health ? `${health.bound_agents} Agent` : '检查中'}</span>
                    <span>{formatDate(record.updated_at)}</span>
                  </div>
                  {health && (
                    <HealthTags ready={health.ready} score={health.score} blockers={health.blockers} warnings={health.warnings} />
                  )}
                </button>
              );
            })}
            {!skills.isLoading && !skillsData.length && (
              <div className="skill-empty-state">
                <Brain size={18} />
                <strong>还没有 Skill</strong>
                <span>创建第一个 Skill，把可复用的执行规范沉淀为 Agent 可绑定资产。</span>
              </div>
            )}
          </section>

          <aside className="skill-inspector-panel" aria-label="Skill detail">
            {selectedSkill ? (
              <>
                <div className="skill-inspector-head">
                  <span>{selectedSkill.name} · v{selectedSkill.version}</span>
                  <h2>{selectedSkill.display_name || selectedSkill.name}</h2>
                  <p>{selectedSkill.description || '未填写使用边界。'}</p>
                </div>
                <div className="skill-inspector-actions">
                  <Button type="primary" onClick={() => openSkill(selectedSkill)}>编辑说明书</Button>
                  <Button icon={<Eye size={14} />} onClick={() => openSkillRuntimePreview(selectedSkill)}>运行预览</Button>
                  <Button icon={<GitBranch size={14} />} onClick={() => openSkillImpact(selectedSkill)}>影响范围</Button>
                  <Button icon={<FileText size={14} />} onClick={() => openSkillVersions(selectedSkill)}>版本</Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'import', label: '导入 Skill' },
                        { key: 'delete', label: '删除', danger: true },
                      ] satisfies MenuProps['items'],
                      onClick: ({ key }) => {
                        if (key === 'import') openSkillImport();
                        if (key === 'delete') openDeleteSkillConfirm(selectedSkill);
                      },
                    }}
                  >
                    <Button icon={<MoreHorizontal size={14} />} />
                  </Dropdown>
                </div>

                <section className="skill-inspector-section">
                  <div className="skill-section-title">
                    <ShieldAlert size={15} />
                    <span>上线检查</span>
                  </div>
                  {selectedSkillHealth ? (
                    <>
                      <HealthTags
                        ready={selectedSkillHealth.ready}
                        score={selectedSkillHealth.score}
                        blockers={selectedSkillHealth.blockers}
                        warnings={selectedSkillHealth.warnings}
                      />
                      <div className="skill-impact-strip">
                        <div><span>绑定 Agent</span><strong>{selectedSkillHealth.bound_agents}</strong></div>
                        <div><span>线上引用</span><strong>{selectedSkillHealth.published_agents}</strong></div>
                        <div><span>状态</span><strong>{selectedSkillHealth.ready ? '可用' : '待处理'}</strong></div>
                      </div>
                      <div className="skill-check-list">
                        {selectedSkillHealth.checks.map((check) => (
                          <div className={check.passed ? 'passed' : check.severity} key={check.key}>
                            <span>{check.label}</span>
                            <strong>{check.passed ? '通过' : check.detail}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="mini-empty compact">上线检查加载中。</div>
                  )}
                </section>

                <section className="skill-inspector-section">
                  <div className="skill-section-title">
                    <Wrench size={15} />
                    <span>Skill allowed tools</span>
                    <strong>{selectedSkill.allowed_tools.length}</strong>
                  </div>
                  {selectedSkill.allowed_tools.length ? (
                    <div className="skill-tool-chip-list">
                      {selectedSkill.allowed_tools.map((toolId) => (
                        <span key={toolId}>{toolLabelById[toolId] || toolId}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="mini-empty compact">不绑定 Tools，仅提供执行规范。</div>
                  )}
                </section>

                <section className="skill-inspector-section">
                  <div className="skill-section-title">
                    <Brain size={15} />
                    <span>执行规范摘要</span>
                  </div>
                  <pre className="skill-instruction-preview">{selectedInstructions.length > 900 ? `${selectedInstructions.slice(0, 900)}...` : selectedInstructions || '未填写执行规范。'}</pre>
                </section>

                <details className="skill-metadata-details">
                  <summary>高级属性</summary>
                  <pre>{JSON.stringify(selectedSkill.metadata || {}, null, 2)}</pre>
                </details>
              </>
            ) : (
              <div className="skill-empty-state">
                <Brain size={18} />
                <strong>选择一个 Skill</strong>
                <span>查看 Runtime Preview、Skill allowed tools 和线上影响。</span>
              </div>
            )}
          </aside>
        </div>
      </PageSurface>

      <Drawer title={editingSkill ? '编辑 Skill' : '新建 Skill'} width={760} open={skillOpen} onClose={() => setSkillOpen(false)}>
        <Form form={skillForm} layout="vertical" onFinish={(values) => saveSkill.mutate(values)}>
          <div className="drawer-section-grid">
            <section>
              <h3>基本信息</h3>
              <Space.Compact block>
                <Form.Item name="name" label="Skill 标识" className="compact-field" rules={[{ required: true }]}>
                  <Input disabled={Boolean(editingSkill)} placeholder="structured-planning" />
                </Form.Item>
                <Form.Item name="display_name" label="显示名称" className="compact-field" rules={[{ required: true }]}>
                  <Input placeholder="结构化任务规划" />
                </Form.Item>
              </Space.Compact>
              <Form.Item name="description" label="使用边界" rules={[{ required: true }]}>
                <Input.TextArea rows={3} placeholder="适用场景、输入边界、需要交付的结果口径" />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
              </Form.Item>
            </section>

            <section>
              <h3>Skill allowed tools</h3>
              <Form.Item name="allowed_tools" label="Skill allowed tools">
                <Select mode="multiple" options={toolOptions} />
              </Form.Item>
            </section>

            <section>
              <h3>执行规范</h3>
              <Form.Item name="instructions" label="执行规范正文" rules={[{ required: true }]}>
                <Input.TextArea rows={12} />
              </Form.Item>
            </section>

            <Collapse
              className="advanced-collapse"
              items={[
                {
                  key: 'metadata',
                  label: '技术详情',
                  children: (
                    <Form.Item label="Skill metadata JSON">
                      <Input.TextArea
                        className="json-textarea"
                        rows={5}
                        value={skillMetadataText}
                        onChange={(event) => setSkillMetadataText(event.target.value)}
                        placeholder='{"domain":"planning"}'
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />
          </div>
          <div className="drawer-sticky-actions">
            <Button type="primary" htmlType="submit" loading={saveSkill.isPending}>保存 Skill</Button>
          </div>
        </Form>
      </Drawer>

      <Drawer
        title={versioningSkill ? `Skill 版本 · ${versioningSkill.display_name || versioningSkill.name}` : 'Skill 版本'}
        width={820}
        open={skillVersionOpen}
        onClose={() => setSkillVersionOpen(false)}
      >
        {versioningSkill && (
          <div className="skill-version-panel">
            <Space className="drawer-action-row">
              <Button
                type="primary"
                loading={publishSkill.isPending}
                onClick={() => publishSkill.mutate(versioningSkill.id)}
              >
                记录当前版本
              </Button>
              <Button
                loading={exportSkill.isPending}
                onClick={() => exportSkill.mutate(versioningSkill.id)}
              >
                生成导出包
              </Button>
            </Space>
            <Table
              scroll={{ x: 860 }}
              size="small"
              rowKey="id"
              loading={skillVersions.isLoading}
              dataSource={skillVersions.data || []}
              columns={[
                { title: '版本', dataIndex: 'version', width: 90, render: (value) => <Tag>v{value}</Tag> },
                { title: '名称', dataIndex: 'display_name' },
                {
                  title: 'Skill allowed tools',
                  dataIndex: 'allowed_tools',
                  render: (value: string[]) => <Space wrap>{(value || []).map((item) => <Tag key={item}>{item}</Tag>)}</Space>,
                },
                { title: '记录时间', dataIndex: 'created_at', width: 210, render: (value) => new Date(value).toLocaleString() },
                {
                  title: '操作',
                  width: 160,
                  render: (_, record) => (
                    <Space>
                      <Button
                        size="small"
                        loading={diffSkillVersion.isPending}
                        onClick={() => diffSkillVersion.mutate({ id: versioningSkill.id, version: record.version })}
                      >
                        差异
                      </Button>
                      <Popconfirm
                        title={`恢复到 v${record.version}？当前内容会生成新的待记录版本。`}
                        onConfirm={() => restoreSkill.mutate({ id: versioningSkill.id, version: record.version })}
                      >
                        <Button size="small" loading={restoreSkill.isPending}>恢复</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
            {skillVersionDiff && (
              <section className="diff-section">
                <h3>与 v{skillVersionDiff.version} 的差异</h3>
                {renderSkillChanges(skillVersionDiff.changes)}
              </section>
            )}
            {skillExportText && (
              <div className="export-box">
                <strong>导出包已生成</strong>
                <Collapse
                  className="advanced-collapse"
                  items={[
                    {
                      key: 'export',
                      label: '查看导出包技术内容',
                      children: <Input.TextArea className="json-textarea" rows={10} value={skillExportText} onChange={(event) => setSkillExportText(event.target.value)} />,
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        title={skillRuntimePreview ? `Skill Runtime Preview · ${skillRuntimePreview.name}` : 'Skill Runtime Preview'}
        width={820}
        open={Boolean(skillRuntimePreview)}
        onClose={() => setSkillRuntimePreview(null)}
      >
        {skillRuntimePreview && (
          <div className="skill-runtime-preview">
            {skillRuntimePreview.warnings.length > 0 && (
              <div className="manifest-warnings">
                {skillRuntimePreview.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
              </div>
            )}
            <section>
              <h3>Skill allowed tools</h3>
              {renderRuntimeResources(skillRuntimePreview.allowed_tools)}
              {(skillRuntimePreview.missing_tools.length > 0 || skillRuntimePreview.inactive_tools.length > 0) && (
                <Space wrap>
                  {skillRuntimePreview.missing_tools.map((item) => <Tag color="error" key={`missing-${item}`}>缺失: {item}</Tag>)}
                  {skillRuntimePreview.inactive_tools.map((item) => <Tag color="warning" key={`inactive-${item}`}>未启用: {item}</Tag>)}
                </Space>
              )}
            </section>
            <section>
              <h3>运行配置检查</h3>
              <div className="kv-list">
                <div><span>Skill allowed tools</span><strong>{skillRuntimePreview.allowed_tools.length}</strong></div>
                <div><span>缺失 Tools</span><strong>{skillRuntimePreview.missing_tools.length}</strong></div>
                <div><span>未启用 Tools</span><strong>{skillRuntimePreview.inactive_tools.length}</strong></div>
              </div>
              <Collapse
                className="advanced-collapse"
                items={[
                  {
                    key: 'runtime',
                    label: '执行规范原文',
                    children: <pre>{skillRuntimePreview.markdown}</pre>,
                  },
                ]}
              />
            </section>
          </div>
        )}
      </Drawer>

      <Drawer
        title={skillImpact ? `Skill 影响分析 · ${skillImpact.skill_name}` : 'Skill 影响分析'}
        width={720}
        open={Boolean(skillImpact)}
        onClose={() => setSkillImpact(null)}
      >
        {skillImpact && (
          <div className="skill-runtime-preview">
            <div className="kv-list">
              <div><span>绑定 Agent</span><strong>{skillImpact.total_agents}</strong></div>
              <div><span>线上引用</span><strong>{skillImpact.published_agents}</strong></div>
            </div>
            <Table
              scroll={{ x: 640 }}
              size="small"
              rowKey={(record) => `${record.agent_id}-${record.binding}-${record.subagent_name || 'main'}`}
              dataSource={skillImpact.bindings}
              pagination={false}
              columns={[
                { title: 'Agent', dataIndex: 'agent_name' },
                {
                  title: '状态',
                  dataIndex: 'agent_status',
                  width: 110,
                  render: (value) => <Tag color={value === 'published' ? 'success' : value === 'inactive' ? 'default' : 'processing'}>{agentStatusLabel(value)}</Tag>,
                },
                {
                  title: '绑定位置',
                  dataIndex: 'binding',
                  width: 170,
                  render: (value, record) => value === 'main' ? '主流程' : `协作角色 · ${record.subagent_name || '-'}`,
                },
              ]}
            />
            {skillImpact.bindings.length === 0 && <div className="mini-empty">当前没有 Agent 绑定这个 Skill。</div>}
          </div>
        )}
      </Drawer>

      <Drawer title="导入 Skill" width={760} open={skillImportOpen} onClose={() => setSkillImportOpen(false)}>
        <Form form={skillImportForm} layout="vertical" onFinish={(values) => importSkill.mutate(values)}>
          <Space.Compact block>
            <Form.Item name="overwrite" label="覆盖同名 Skill" valuePropName="checked" className="compact-field">
              <Switch />
            </Form.Item>
            <Form.Item name="preserve_id" label="保留原 ID" valuePropName="checked" className="compact-field">
              <Switch />
            </Form.Item>
          </Space.Compact>
          <div className="secret-note">
            <strong>导入包</strong>
            <span>粘贴从版本面板导出的 Skill；导入后会恢复当前内容和历史版本清单。</span>
          </div>
          <Collapse
            className="advanced-collapse"
            items={[
              {
                key: 'package',
                label: '查看或编辑导入包 JSON',
                children: (
                  <Form.Item label="Skill 导入原文">
                    <Input.TextArea
                      className="json-textarea"
                      rows={12}
                      value={skillImportText}
                      onChange={(event) => setSkillImportText(event.target.value)}
                    />
                  </Form.Item>
                ),
              },
            ]}
          />
          <Space>
            <Button onClick={() => previewSkillImport.mutate(skillImportForm.getFieldsValue())} loading={previewSkillImport.isPending}>
              导入检查
            </Button>
            <Button type="primary" htmlType="submit" loading={importSkill.isPending}>导入 Skill</Button>
          </Space>
          {skillImportPreview && (
            <section className="diff-section">
              <h3>导入检查 · {skillImportPreview.name}</h3>
              <div className="kv-list">
                <div><span>处理方式</span><strong>{skillImportPreview.action === 'overwrite' ? '覆盖同名 Skill' : '创建新 Skill'}</strong></div>
                <div><span>导入版本</span><strong>v{skillImportPreview.incoming_version}</strong></div>
                <div><span>历史版本</span><strong>{skillImportPreview.imported_versions}</strong></div>
              </div>
              {skillImportPreview.warnings.length > 0 && (
                <div className="manifest-warnings">
                  {skillImportPreview.warnings.map((item) => <Tag color="warning" key={item}>{item}</Tag>)}
                </div>
              )}
              {(skillImportPreview.missing_tools.length > 0 || skillImportPreview.inactive_tools.length > 0) && (
                <Space wrap>
                  {skillImportPreview.missing_tools.map((item) => <Tag color="error" key={`missing-${item}`}>缺失: {item}</Tag>)}
                  {skillImportPreview.inactive_tools.map((item) => <Tag color="warning" key={`inactive-${item}`}>未启用: {item}</Tag>)}
                </Space>
              )}
              {renderSkillChanges(skillImportPreview.changes)}
            </section>
          )}
        </Form>
      </Drawer>
    </>
  );
}
