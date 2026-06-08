import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Collapse, Drawer, Dropdown, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { Activity, AlertTriangle, Cable, Eye, GitBranch, KeyRound, MoreHorizontal, Network, PlayCircle, Plus, ShieldCheck, Wrench } from 'lucide-react';
import { EntityCell, HealthTags, PageSurface, StatusTag, TableToolbar } from '../../components/ui';
import { api } from '../../services/api';
import type { Agent, McpDiscoveredTool, OrganizationRole, Skill, ToolDefinition, ToolHealth, ToolRequiredRole, ToolSecret } from '../../types/domain';

type EgressEvidence = {
  allowed?: boolean;
  reason?: string;
  scheme?: string;
  host?: string;
  is_private?: boolean;
  is_localhost?: boolean;
  tool_policy?: {
    allowed_hosts?: string[];
    blocked_hosts?: string[];
    allow_private_networks?: boolean;
  };
  global_policy?: {
    allowed_hosts?: string[];
    blocked_hosts?: string[];
    allow_private_networks?: boolean;
    allow_localhost?: boolean;
  };
};

type ToolUsage = {
  services: number;
  subagents: number;
  skills: number;
  publishedServices: number;
  serviceNames: string[];
  skillNames: string[];
};

const defaultHttpTool = {
  id: '',
  name: '',
  description: '',
  category: 'integration',
  implementation: 'http',
  metadata: {
    url: 'https://api.example.com/tool',
    method: 'POST',
    headers: {},
    secret_headers: {},
    timeout_seconds: 10,
    required_role: 'editor',
    egress_policy: {
      allowed_hosts: ['api.example.com'],
      blocked_hosts: [],
      allow_private_networks: false,
    },
  },
  status: 'active',
};

const defaultMcpTool = {
  id: '',
  name: '',
  description: '',
  category: 'mcp',
  implementation: 'mcp',
  metadata: {
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    tool_name: 'search',
    headers: {},
    secret_headers: {},
    timeout_seconds: 30,
    required_role: 'editor',
    egress_policy: {
      allowed_hosts: ['mcp.example.com'],
      blocked_hosts: [],
      allow_private_networks: false,
    },
  },
  status: 'active',
};

const defaultMcpImportMetadata = {
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  headers: {},
  secret_headers: {},
  timeout_seconds: 30,
  required_role: 'editor',
  egress_policy: {
    allowed_hosts: ['mcp.example.com'],
    blocked_hosts: [],
    allow_private_networks: false,
  },
};

const defaultToolSecret = {
  id: '',
  name: '',
  value: '',
  description: '',
};

const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const roleMeta: Record<ToolRequiredRole, { label: string; color: string }> = {
  viewer: { label: '观察者', color: 'default' },
  editor: { label: '编辑者', color: 'processing' },
  admin: { label: '管理员', color: 'blue' },
  owner: { label: '所有者', color: 'gold' },
};

const requiredRoleOptions = (['viewer', 'editor', 'admin', 'owner'] as ToolRequiredRole[]).map((role) => ({
  value: role,
  label: roleMeta[role].label,
}));

function isSecretConfigured(value: ToolSecret) {
  return Boolean(value.configured);
}

function toolHasSecretRef(value: ToolDefinition) {
  return value.implementation === 'http'
    ? Boolean(value.metadata?.secret_headers)
    : value.implementation === 'mcp'
      ? Boolean(value.metadata?.secret_headers) || Boolean(value.metadata?.secret_env)
      : false;
}

function toolHasEgressPolicy(value: ToolDefinition) {
  return (value.implementation === 'http' || value.implementation === 'mcp') && Boolean(value.metadata?.egress_policy);
}

function normalizeRequiredRole(value: unknown): ToolRequiredRole {
  return value === 'viewer' || value === 'editor' || value === 'admin' || value === 'owner' ? value : 'editor';
}

function isOrganizationRole(value?: string | null): value is OrganizationRole {
  return value === 'viewer' || value === 'editor' || value === 'admin' || value === 'owner';
}

function shortAuditUserId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function shortAuditResourceId(value?: string | null) {
  if (!value) return '';
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-5)}` : value;
}

function auditSourceLabel(value?: string | null) {
  if (value === 'manual') return '连通测试';
  if (value === 'runtime') return '运行时';
  if (value === 'test') return '验收测试';
  if (value === 'system') return '系统';
  return value || '未知';
}

function auditSourceColor(value?: string | null) {
  if (value === 'manual') return 'processing';
  if (value === 'runtime') return 'blue';
  if (value === 'test') return 'purple';
  if (value === 'system') return 'default';
  return 'default';
}

function invocationStatusLabel(value?: string | null) {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  return value || '未知';
}

function implementationLabel(value: ToolDefinition['implementation'] | string) {
  if (value === 'http') return '兼容接口';
  if (value === 'mcp') return 'MCP 服务';
  if (value === 'builtin') return '平台内置';
  return value || '未知';
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function splitList(value?: string) {
  return (value || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readSecretRefs(value: ToolDefinition) {
  const refs: string[] = [];
  const secretHeaders = value.metadata?.secret_headers;
  if (secretHeaders && typeof secretHeaders === 'object' && !Array.isArray(secretHeaders)) {
    refs.push(...Object.values(secretHeaders).filter((item): item is string => typeof item === 'string'));
  }
  const secretEnv = value.metadata?.secret_env;
  if (secretEnv && typeof secretEnv === 'object' && !Array.isArray(secretEnv)) {
    refs.push(...Object.values(secretEnv).filter((item): item is string => typeof item === 'string'));
  }
  return Array.from(new Set(refs));
}

function endpointLabel(value: ToolDefinition) {
  if (value.implementation === 'http') {
    return `${String(value.metadata?.method || 'POST')} ${String(value.metadata?.url || '未配置 URL')}`;
  }
  if (value.implementation === 'mcp') {
    return `${String(value.metadata?.transport || 'http')} · ${String(value.metadata?.tool_name || '未配置 Tool')} · ${String(value.metadata?.url || value.metadata?.command || '未配置服务')}`;
  }
  return '平台内置';
}

function emptyToolUsage(): ToolUsage {
  return {
    services: 0,
    subagents: 0,
    skills: 0,
    publishedServices: 0,
    serviceNames: [],
    skillNames: [],
  };
}

function addUnique(list: string[], value?: string | null) {
  const text = String(value || '').trim();
  if (text && !list.includes(text)) list.push(text);
}

export function ToolManagement() {
  const [toolOpen, setToolOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolDefinition | null>(null);
  const [inspectingTool, setInspectingTool] = useState<ToolDefinition | null>(null);
  const [openApiOpen, setOpenApiOpen] = useState(false);
  const [mcpImportOpen, setMcpImportOpen] = useState(false);
  const [secretOpen, setSecretOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<ToolSecret | null>(null);
  const [toolMetadataText, setToolMetadataText] = useState('{}');
  const [mcpImportMetadataText, setMcpImportMetadataText] = useState(JSON.stringify(defaultMcpImportMetadata, null, 2));
  const [mcpDiscoveredTools, setMcpDiscoveredTools] = useState<McpDiscoveredTool[]>([]);
  const [selectedMcpToolNames, setSelectedMcpToolNames] = useState<string[]>([]);
  const [openApiSpecText, setOpenApiSpecText] = useState('{\n  "openapi": "3.0.0",\n  "info": { "title": "Example API", "version": "1.0.0" },\n  "servers": [{ "url": "https://api.example.com" }],\n  "paths": {}\n}');
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [toolInput, setToolInput] = useState('');
  const [toolOutput, setToolOutput] = useState('');
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [toolForm] = Form.useForm();
  const [openApiForm] = Form.useForm();
  const [mcpImportForm] = Form.useForm();
  const [secretForm] = Form.useForm();
  const watchedImplementation = Form.useWatch('implementation', toolForm) as ToolDefinition['implementation'] | undefined;
  const watchedTransport = Form.useWatch('transport', toolForm) as string | undefined;

  const tools = useQuery({ queryKey: ['tools'], queryFn: api.listTools });
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.listAgents });
  const skills = useQuery({ queryKey: ['skills'], queryFn: api.listSkills });
  const currentUser = useQuery({ queryKey: ['me'], queryFn: api.me });
  const toolHealth = useQuery({ queryKey: ['tool-health'], queryFn: api.listToolsHealth });
  const toolSecrets = useQuery({ queryKey: ['tool-secrets'], queryFn: api.listToolSecrets });
  const toolAudits = useQuery({ queryKey: ['tool-audits'], queryFn: () => api.listToolAudits({ limit: 30 }) });

  const canManageTools = roleRank[currentUser.data?.membership.role || 'viewer'] >= roleRank.admin;
  const canManageToolSecrets = canManageTools;

  const toolHealthById = useMemo(
    () => Object.fromEntries((toolHealth.data || []).map((item) => [item.tool_id, item])) as Record<string, ToolHealth>,
    [toolHealth.data],
  );

  const toolsData = tools.data || [];
  const agentsData = agents.data || [];
  const skillsData = skills.data || [];
  const healthData = toolHealth.data || [];
  const auditData = toolAudits.data || [];
  const secretData = toolSecrets.data || [];
  const governanceMetrics = useMemo(() => {
    const activeTools = toolsData.filter((item) => item.status === 'active').length;
    const readyTools = healthData.filter((item) => item.ready).length;
    const blockerCount = healthData.reduce((sum, item) => sum + item.blockers, 0);
    const warningCount = healthData.reduce((sum, item) => sum + item.warnings, 0);
    const failedAudits = auditData.filter((item) => item.status !== 'success').length;
    const secretRefs = toolsData.filter(toolHasSecretRef).length;
    const configuredSecrets = secretData.filter(isSecretConfigured).length;
    const egressPolicies = toolsData.filter(toolHasEgressPolicy).length;
    const avgScore = healthData.length
      ? Math.round(healthData.reduce((sum, item) => sum + item.score, 0) / healthData.length)
      : 0;
    return {
      activeTools,
      avgScore,
      blockerCount,
      configuredSecrets,
      egressPolicies,
      failedAudits,
      readyTools,
      secretRefs,
      totalSecrets: secretData.length,
      totalTools: toolsData.length,
      warningCount,
    };
  }, [auditData, healthData, secretData, toolsData]);

  const toolRiskItems = useMemo(
    () => healthData
      .filter((item) => (
        !item.ready
        || item.warnings > 0
        || item.last_invocation_status === 'failed'
      ))
      .sort((a, b) => (
        b.blockers - a.blockers
        || b.warnings - a.warnings
        || Number(b.last_invocation_status === 'failed') - Number(a.last_invocation_status === 'failed')
        || a.name.localeCompare(b.name)
      ))
      .slice(0, 4),
    [healthData],
  );

  const toolUsageById = useMemo(() => {
    const usage = new Map<string, ToolUsage>();
    const ensure = (toolId: string) => {
      if (!usage.has(toolId)) usage.set(toolId, emptyToolUsage());
      return usage.get(toolId)!;
    };
    agentsData.forEach((agent: Agent) => {
      (agent.tools || []).forEach((toolId) => {
        const item = ensure(toolId);
        item.services += 1;
        if (agent.status === 'published') item.publishedServices += 1;
        addUnique(item.serviceNames, agent.name);
      });
      (agent.subagents || []).forEach((subagent) => {
        (subagent.tools || []).forEach((toolId) => {
          const item = ensure(toolId);
          item.subagents += 1;
          if (agent.status === 'published') item.publishedServices += 1;
          addUnique(item.serviceNames, agent.name);
        });
      });
    });
    skillsData.forEach((skill: Skill) => {
      (skill.allowed_tools || []).forEach((toolId) => {
        const item = ensure(toolId);
        item.skills += 1;
        addUnique(item.skillNames, skill.display_name || skill.name);
      });
    });
    return usage;
  }, [agentsData, skillsData]);

  const saveTool = useMutation({
    mutationFn: (values: any) => {
      if (!canManageTools) {
        throw new Error('Tool Definition 由管理员统一管理');
      }
      let advancedMetadata: Record<string, unknown> = {};
      try {
        const parsedMetadata = JSON.parse(toolMetadataText || '{}');
        if (!parsedMetadata || typeof parsedMetadata !== 'object' || Array.isArray(parsedMetadata)) {
          throw new Error('invalid metadata');
        }
        advancedMetadata = parsedMetadata;
      } catch {
        throw new Error('高级属性必须是合法 JSON 对象');
      }
      const requiredRole = normalizeRequiredRole(values.required_role);
      const implementation = values.implementation as ToolDefinition['implementation'];
      const metadata: Record<string, unknown> = {
        ...advancedMetadata,
        required_role: requiredRole,
      };
      if (implementation === 'http') {
        metadata.url = values.url;
        metadata.method = values.method || 'POST';
      }
      if (implementation === 'mcp') {
        metadata.transport = values.transport || 'http';
        metadata.tool_name = values.tool_name;
        if (values.transport === 'stdio') {
          metadata.command = values.command;
          delete metadata.url;
        } else {
          metadata.url = values.url;
          delete metadata.command;
        }
      }
      if (implementation === 'http' || implementation === 'mcp') {
        metadata.timeout_seconds = Number(values.timeout_seconds || metadata.timeout_seconds || (implementation === 'mcp' ? 30 : 10));
        metadata.egress_policy = {
          ...((advancedMetadata.egress_policy && typeof advancedMetadata.egress_policy === 'object' && !Array.isArray(advancedMetadata.egress_policy)) ? advancedMetadata.egress_policy : {}),
          allowed_hosts: splitList(values.allowed_hosts),
          blocked_hosts: splitList(values.blocked_hosts),
          allow_private_networks: Boolean(values.allow_private_networks),
        };
        const secretId = String(values.secret_id || '').trim();
        if (secretId) {
          metadata.secret_headers = { Authorization: secretId };
        } else {
          delete metadata.secret_headers;
        }
      }
      const {
        allowed_hosts: _allowedHosts,
        allow_private_networks: _allowPrivateNetworks,
        blocked_hosts: _blockedHosts,
        command: _command,
        method: _method,
        required_role: _requiredRole,
        secret_id: _secretId,
        timeout_seconds: _timeoutSeconds,
        tool_name: _toolName,
        transport: _transport,
        url: _url,
        ...toolValues
      } = values;
      const payload = {
        ...toolValues,
        metadata,
      };
      return editingTool ? api.updateTool(editingTool.id, payload) : api.createTool(payload);
    },
    onSuccess: () => {
      message.success('Tool 已保存');
      setToolOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['tool-audits'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Tool 配置保存失败');
    },
  });

  const importOpenApiTools = useMutation({
    mutationFn: (values: any) => {
      if (!canManageTools) {
        throw new Error('Tool 导入由管理员统一管理');
      }
      let spec = {};
      try {
        spec = JSON.parse(openApiSpecText || '{}');
      } catch {
        throw new Error('OpenAPI JSON 必须是合法 JSON 对象');
      }
      return api.importOpenApiTools({ ...values, spec });
    },
    onSuccess: (result) => {
      message.success(`OpenAPI 导入完成：新增/覆盖 ${result.imported} 个，跳过 ${result.skipped} 个`);
      setOpenApiOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'OpenAPI 导入失败');
    },
  });

  const parseMcpImportMetadata = () => {
    try {
      return JSON.parse(mcpImportMetadataText || '{}') as Record<string, unknown>;
    } catch {
      throw new Error('MCP 元数据必须是合法 JSON 对象');
    }
  };

  const discoverMcpTools = useMutation({
    mutationFn: async () => {
      if (!canManageTools) {
        throw new Error('MCP Tool 发现由管理员统一管理');
      }
      return api.discoverMcpTools({ metadata: parseMcpImportMetadata() });
    },
    onSuccess: (result) => {
      setMcpDiscoveredTools(result.tools);
      setSelectedMcpToolNames(result.tools.map((item) => item.name));
      message.success(`发现 ${result.tools.length} 个 MCP Tools`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'MCP Tool 发现失败');
    },
  });

  const importMcpTools = useMutation({
    mutationFn: (values: any) => {
      if (!canManageTools) {
        throw new Error('MCP Tool 导入由管理员统一管理');
      }
      return api.importMcpTools({
        ...values,
        metadata: parseMcpImportMetadata(),
        tool_names: selectedMcpToolNames,
      });
    },
    onSuccess: (result) => {
      message.success(`MCP 导入完成：新增/覆盖 ${result.imported} 个，跳过 ${result.skipped} 个`);
      setMcpImportOpen(false);
      setMcpDiscoveredTools([]);
      setSelectedMcpToolNames([]);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'MCP Tool 导入失败');
    },
  });

  const invokeTool = useMutation({
    mutationFn: (params: { id: string; input: string }) => api.invokeTool(params.id, params.input),
    onSuccess: (result) => {
      setToolOutput(result.output);
      queryClient.invalidateQueries({ queryKey: ['tool-audits'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Tool 连通测试失败');
      queryClient.invalidateQueries({ queryKey: ['tool-audits'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
  });

  const deleteTool = useMutation({
    mutationFn: (id: string) => {
      if (!canManageTools) {
        throw new Error('Tool 删除由管理员统一管理');
      }
      return api.deleteTool(id);
    },
    onSuccess: () => {
      message.success('Tool 已删除');
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
      queryClient.invalidateQueries({ queryKey: ['agent-completeness'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Tool 删除失败');
    },
  });

  const saveToolSecret = useMutation({
    mutationFn: (values: any) => {
      const payload = { ...values };
      if (editingSecret && !payload.value) {
        delete payload.value;
      }
      return editingSecret
        ? api.updateToolSecret(editingSecret.id, payload)
        : api.createToolSecret(payload);
    },
    onSuccess: () => {
      message.success('Tool Secret 已保存');
      setSecretOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tool-secrets'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : 'Tool Secret 保存失败');
    },
  });

  const openTool = (record?: ToolDefinition, implementation: 'http' | 'mcp' = 'http') => {
    if (!canManageTools) {
      message.warning('Tool Definition 由管理员统一管理');
      return;
    }
    const values = record || (implementation === 'mcp' ? defaultMcpTool : defaultHttpTool);
    const egressPolicy = values.metadata?.egress_policy;
    const egressPolicyObject = egressPolicy && typeof egressPolicy === 'object' && !Array.isArray(egressPolicy)
      ? egressPolicy as Record<string, unknown>
      : {};
    const metadata = values.metadata as Record<string, unknown>;
    const secretRefs = readSecretRefs(values as ToolDefinition);
    setEditingTool(record || null);
    toolForm.setFieldsValue({
      ...values,
      allowed_hosts: stringList(egressPolicyObject.allowed_hosts).join('\n'),
      allow_private_networks: Boolean(egressPolicyObject.allow_private_networks),
      blocked_hosts: stringList(egressPolicyObject.blocked_hosts).join('\n'),
      command: metadata.command,
      method: metadata.method || 'POST',
      required_role: normalizeRequiredRole(metadata.required_role),
      secret_id: secretRefs[0] || undefined,
      timeout_seconds: metadata.timeout_seconds || (values.implementation === 'mcp' ? 30 : 10),
      tool_name: metadata.tool_name,
      transport: metadata.transport || 'http',
      url: metadata.url,
    });
    setToolMetadataText(JSON.stringify(values.metadata || {}, null, 2));
    setToolOpen(true);
  };

  const openMcpImport = () => {
    if (!canManageTools) {
      message.warning('MCP Tool 导入由管理员统一管理');
      return;
    }
    mcpImportForm.setFieldsValue({
      prefix: 'mcp',
      category: 'mcp',
      overwrite: false,
    });
    setMcpImportMetadataText(JSON.stringify(defaultMcpImportMetadata, null, 2));
    setMcpDiscoveredTools([]);
    setSelectedMcpToolNames([]);
    setMcpImportOpen(true);
  };

  const openToolSecret = (record?: ToolSecret) => {
    if (!canManageToolSecrets) {
      message.warning('Tool Secret 由管理员统一管理');
      return;
    }
    setEditingSecret(record || null);
    secretForm.setFieldsValue(record ? { ...record, value: '' } : defaultToolSecret);
    setSecretOpen(true);
  };

  const switchNewToolImplementation = (implementation: 'builtin' | 'http' | 'mcp') => {
    if (editingTool) return;
    if (implementation === 'mcp') {
      toolForm.setFieldsValue({ ...defaultMcpTool, implementation, required_role: normalizeRequiredRole(defaultMcpTool.metadata.required_role) });
      setToolMetadataText(JSON.stringify(defaultMcpTool.metadata, null, 2));
      return;
    }
    if (implementation === 'http') {
      toolForm.setFieldsValue({ ...defaultHttpTool, implementation, required_role: normalizeRequiredRole(defaultHttpTool.metadata.required_role) });
      setToolMetadataText(JSON.stringify(defaultHttpTool.metadata, null, 2));
      return;
    }
    toolForm.setFieldsValue({ implementation, metadata: {}, required_role: 'editor' });
    setToolMetadataText('{\n  "required_role": "editor"\n}');
  };

  const openOpenApiImport = () => {
    if (!canManageTools) {
      message.warning('OpenAPI Tool 导入由管理员统一管理');
      return;
    }
    openApiForm.setFieldsValue({
      prefix: 'api',
      category: 'openapi',
      overwrite: false,
      allow_private_networks: false,
    });
    setOpenApiOpen(true);
  };

  const openToolDetail = (record: ToolDefinition) => {
    setInspectingTool(record);
    setSelectedToolId(record.id);
    setToolInput('');
    setToolOutput('');
  };

  const selectedTool = useMemo(
    () => (selectedToolId ? toolsData.find((item) => item.id === selectedToolId) || inspectingTool : null),
    [inspectingTool, selectedToolId, toolsData],
  );

  const selectedToolHealth = selectedTool ? toolHealthById[selectedTool.id] : undefined;
  const selectedToolUsage = selectedTool ? toolUsageById.get(selectedTool.id) : undefined;
  const selectedToolAudits = useMemo(
    () => (selectedTool ? auditData.filter((item) => item.tool_id === selectedTool.id) : []),
    [auditData, selectedTool],
  );

  const advancedActionItems: MenuProps['items'] = [
    {
      key: 'secret',
      disabled: !canManageToolSecrets,
      label: '新建密钥',
    },
    {
      type: 'divider',
    },
    {
      key: 'openapi',
      disabled: !canManageTools,
      label: '导入 OpenAPI',
    },
    {
      key: 'mcp-import',
      disabled: !canManageTools,
      label: '发现并导入 MCP',
    },
    {
      key: 'mcp-create',
      disabled: !canManageTools,
      label: '新建 MCP Tool',
    },
  ];

  const handleAdvancedAction: MenuProps['onClick'] = ({ key }) => {
    if (key === 'secret') openToolSecret();
    if (key === 'openapi') openOpenApiImport();
    if (key === 'mcp-import') openMcpImport();
    if (key === 'mcp-create') openTool(undefined, 'mcp');
  };

  const toggleToolStatus = async (item: ToolDefinition) => {
    if (!canManageTools) {
      message.warning('Tool 状态由管理员统一管理');
      return;
    }
    await api.updateTool(item.id, { status: item.status === 'active' ? 'inactive' : 'active' });
    queryClient.invalidateQueries({ queryKey: ['tools'] });
    queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    queryClient.invalidateQueries({ queryKey: ['skill-health'] });
    queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
  };

  const deleteToolSecret = async (id: string) => {
    await api.deleteToolSecret(id);
    queryClient.invalidateQueries({ queryKey: ['tool-secrets'] });
    queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    queryClient.invalidateQueries({ queryKey: ['skill-health'] });
    queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
  };

  const egressCheck = (health?: ToolHealth) => health?.checks.find((check) => check.key === 'egress');

  const egressEvidence = (health?: ToolHealth) => (egressCheck(health)?.evidence || {}) as EgressEvidence;

  const renderEgressSummary = (health?: ToolHealth) => {
    const check = egressCheck(health);
    if (!check) return null;
    const evidence = egressEvidence(health);
    const toolAllowedHosts = evidence.tool_policy?.allowed_hosts || [];
    const globalAllowedHosts = evidence.global_policy?.allowed_hosts || [];
    const tags = [
      { text: evidence.host ? `Host ${evidence.host}` : '', color: undefined },
      {
        text: globalAllowedHosts.length ? `平台 ${globalAllowedHosts.join(', ')}` : '平台未配置允许 host',
        color: globalAllowedHosts.length ? undefined : 'warning',
      },
      {
        text: toolAllowedHosts.length ? `Tool ${toolAllowedHosts.join(', ')}` : 'Tool 未配置允许 host',
        color: toolAllowedHosts.length ? undefined : 'warning',
      },
    ].filter((tag) => tag.text);
    return (
      <div className={`tool-egress-summary ${check.passed ? 'is-pass' : 'is-blocked'}`}>
        <div className="tool-egress-summary-line">
          <strong>{check.passed ? '访问边界通过' : '访问边界未通过'}</strong>
          <span>{check.detail}</span>
        </div>
        {evidence.host && (
          <Space wrap size={[4, 4]}>
            {tags.map((tag) => <Tag color={tag.color} key={tag.text}>{tag.text}</Tag>)}
            {evidence.is_private && <Tag color="orange">私有网络</Tag>}
            {evidence.is_localhost && <Tag color="red">本机地址</Tag>}
          </Space>
        )}
      </div>
    );
  };

  return (
    <>
      <section className="tool-console">
        <div className="tool-console-header">
          <div>
            <h2>Tool Registry</h2>
            <p>先确认 Tool 是否可上线、谁能调用、能访问哪些地址、最近是否跑通，再进入接入参数和技术详情。</p>
          </div>
          <Space className="tool-command-bar" wrap size={[8, 8]}>
            <Dropdown menu={{ items: advancedActionItems, onClick: handleAdvancedAction }} trigger={['click']}>
              <Button icon={<MoreHorizontal size={16} />}>
                接入 Tool
              </Button>
            </Dropdown>
            <Button type="primary" icon={<Plus size={16} />} disabled={!canManageTools} title={canManageTools ? '新建 HTTP Tool' : '需管理员权限'} onClick={() => openTool(undefined, 'http')}>
              新建 Tool
            </Button>
          </Space>
        </div>
        <div className="asset-workflow-strip" aria-label="Tool onboarding flow">
          <div>
            <span>Tools</span>
            <strong>{governanceMetrics.totalTools}</strong>
            <em>已接入 Tools</em>
          </div>
          <div>
            <span>授权边界</span>
            <strong>{governanceMetrics.secretRefs}</strong>
            <em>密钥引用</em>
          </div>
          <div>
            <span>Run Evidence</span>
            <strong>{governanceMetrics.failedAudits}</strong>
            <em>最近失败</em>
          </div>
          <div>
            <span>证据样本</span>
            <strong>{auditData.length}</strong>
            <em>最近 30 条</em>
          </div>
          <div>
            <span>线上影响</span>
            <strong>{Array.from(toolUsageById.values()).reduce((sum, item) => sum + item.publishedServices, 0)}</strong>
            <em>线上引用</em>
          </div>
        </div>
        <div className="tool-workbench-grid">
          <PageSurface
            className="tool-risk-surface"
            title="待处理 Tools"
            description="未通过项、访问边界失败和最近运行失败会优先进入队列。"
          >
            {toolHealth.isLoading ? (
              <div className="mini-empty">正在加载 Tool 检查状态...</div>
            ) : toolRiskItems.length > 0 ? (
              <div className="tool-risk-list">
                {toolRiskItems.map((item) => {
                  const checks = item.checks.filter((check) => !check.passed);
                  const tool = toolsData.find((record) => record.id === item.tool_id);
                  return (
                    <button
                      type="button"
                      className="tool-risk-item"
                      key={item.tool_id}
                      onClick={() => tool && openToolDetail(tool)}
                    >
                      <div className="tool-risk-head">
                        <span>{item.name}</span>
                        <HealthTags ready={item.ready} score={item.score} blockers={item.blockers} warnings={item.warnings} />
                      </div>
                      <div className="tool-risk-meta">
                        <span><Wrench size={13} /> {implementationLabel(item.implementation)}</span>
                        {item.last_invocation_status && (
                          <span><Activity size={13} /> 最近运行 {invocationStatusLabel(item.last_invocation_status)}</span>
                        )}
                      </div>
                      <div className="tool-risk-checks">
                        {checks.slice(0, 3).map((check) => (
                          <Tag color={check.severity === 'blocker' ? 'error' : 'warning'} key={check.key}>
                            {check.label}
                          </Tag>
                        ))}
                        {item.last_invocation_status === 'failed' && <Tag color="error">最近运行失败</Tag>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="tool-empty-state">
                <ShieldCheck size={18} />
                <strong>当前没有待处理风险</strong>
                <span>上线检查、访问边界和最近 Run Evidence 未发现未通过项。</span>
              </div>
            )}
          </PageSurface>
          <PageSurface
            className="tool-policy-surface"
            title="安全边界"
            description="授权凭据、访问边界和 Run Evidence 共同决定 Tool 是否允许上线。"
          >
            <div className="tool-policy-list">
              <div>
                <KeyRound size={16} />
                <span>{governanceMetrics.secretRefs} 个 Tool 引用密钥，{governanceMetrics.configuredSecrets}/{governanceMetrics.totalSecrets} 个密钥已配置。</span>
              </div>
              <div>
                <Network size={16} />
                <span>{governanceMetrics.egressPolicies} 个外部 Tool 配置了 Tool 级访问边界。</span>
              </div>
              <div>
                <AlertTriangle size={16} />
                <span>删除 Tool 前必须解除 Agent、Skills、上线版本、存量运行和 Run Evidence 引用。</span>
              </div>
            </div>
          </PageSurface>
        </div>
        <div className="tool-governance-grid">
          <section className="governance-panel">
            <div className="governance-panel-title">
              <span>密钥引用</span>
              <small>{canManageToolSecrets ? '只保存引用到 Tool 高级属性，页面不回显密钥值。' : '当前角色可查看密钥配置状态，轮换和删除需管理员权限。'}</small>
            </div>
            <Table
              scroll={{ x: 560 }}
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={toolSecrets.data || []}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 150 },
                { title: '名称', dataIndex: 'name' },
                {
                  title: '状态',
                  dataIndex: 'configured',
                  width: 90,
                  render: (value) => <StatusTag status={Boolean(value)} trueLabel="已配置" falseLabel="未配置" />,
                },
                {
                  title: '操作',
                  width: 150,
                  render: (_, record: ToolSecret) => (
                    <Space>
                      <Button size="small" disabled={!canManageToolSecrets} onClick={() => openToolSecret(record)}>轮换</Button>
                      <Popconfirm
                        title="确定删除该 Tool Secret？引用它的 HTTP Tool 会调用失败。"
                        disabled={!canManageToolSecrets}
                        onConfirm={() => deleteToolSecret(record.id)}
                      >
                        <Button size="small" danger disabled={!canManageToolSecrets}>删除</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </section>
          <section className="governance-panel">
            <div className="governance-panel-title">
              <span>Tool Evidence</span>
              <small>记录 Tool 连通测试和线上运行时调用结果。</small>
            </div>
            <Table
              scroll={{ x: 980 }}
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={toolAudits.data || []}
              columns={[
                { title: 'Tool', dataIndex: 'tool_id', width: 150 },
                {
                  title: '结果',
                  dataIndex: 'status',
                  width: 90,
                  render: (value) => <StatusTag status={value} />,
                },
                { title: '耗时', dataIndex: 'duration_ms', width: 80, render: (value) => `${value}ms` },
                {
                  title: '来源',
                  width: 120,
                  render: (_, record) => {
                    const userId = record.user_id?.trim();
                    const role = record.actor_role;
                    return (
                      <Space size={4} wrap>
                        <Tag color={auditSourceColor(record.source)}>{auditSourceLabel(record.source)}</Tag>
                        <span className="audit-subtle">{userId ? shortAuditUserId(userId) : '系统'}</span>
                        {role && (
                          <Tag color={isOrganizationRole(role) ? roleMeta[role].color : 'default'}>
                            {isOrganizationRole(role) ? roleMeta[role].label : role}
                          </Tag>
                        )}
                      </Space>
                    );
                  },
                },
                {
                  title: '上下文',
                  width: 130,
                  render: (_, record) => {
                    const primary = record.run_id || record.agent_id || record.conversation_id;
                    if (!primary) return <span className="audit-subtle">-</span>;
                    return (
                      <Tooltip
                        title={
                          <div className="audit-context-tooltip">
                            {record.run_id && <div>Run: {record.run_id}</div>}
                            {record.agent_id && <div>Agent: {record.agent_id}</div>}
                            {record.conversation_id && <div>会话: {record.conversation_id}</div>}
                          </div>
                        }
                      >
                        <span className="resource-chip">{shortAuditResourceId(primary)}</span>
                      </Tooltip>
                    );
                  },
                },
                {
                  title: '摘要',
                  render: (_, record) => (
                    <span className="audit-preview">
                      {record.error || record.response_preview || record.request_preview || '-'}
                    </span>
                  ),
                },
              ]}
            />
          </section>
        </div>
        <PageSurface className="studio-table-surface tool-inventory-surface">
          <TableToolbar
          title="Tool Registry"
          description="以可用状态、授权状态、访问边界、Run Evidence 和使用方作为首层判断。"
          />
          <Table<ToolDefinition>
            scroll={{ x: 1360 }}
            rowKey="id"
            loading={tools.isLoading}
            dataSource={toolsData}
            columns={[
              {
                title: 'Tool',
                dataIndex: 'name',
                render: (_, record) => (
                  <EntityCell
                    icon={<Wrench size={18} />}
                    title={record.name}
                    subtitle={`${record.id} · ${record.description || '未填写描述'}`}
                  />
                ),
              },
              {
                title: '接入方式',
                width: 132,
                render: (_, record) => (
                  <Space size={4} wrap>
                    <Tag color={record.implementation === 'http' ? 'blue' : record.implementation === 'mcp' ? 'geekblue' : 'default'}>
                      {implementationLabel(record.implementation)}
                    </Tag>
                    <Tag>{record.category}</Tag>
                  </Space>
                ),
              },
              {
                title: '可用状态',
                width: 92,
                dataIndex: 'status',
                render: (value) => <StatusTag status={value} />,
              },
              {
                title: '授权状态',
                width: 128,
                render: (_, record) => {
                  const requiredRole = normalizeRequiredRole(record.metadata?.required_role);
                  return <Tag color={roleMeta[requiredRole].color}>{roleMeta[requiredRole].label}</Tag>;
                },
              },
              {
                title: '安全边界',
                width: 220,
                render: (_, record) => {
                  const health = toolHealthById[record.id];
                  const evidence = egressEvidence(health);
                  const allowedHosts = evidence.tool_policy?.allowed_hosts || stringList((record.metadata?.egress_policy as Record<string, unknown> | undefined)?.allowed_hosts);
                  return (
                    <div className="tool-policy-cell">
                      <strong>{allowedHosts.length ? allowedHosts.slice(0, 2).join('、') : record.implementation === 'builtin' ? '平台内置' : '未配置允许地址'}</strong>
                      <span>{endpointLabel(record)}</span>
                    </div>
                  );
                },
              },
              {
                title: '凭据',
                width: 110,
                render: (_, record) => {
                  const secretRefs = readSecretRefs(record);
                  if (!secretRefs.length) return <Tag>无引用</Tag>;
                  const configured = secretRefs.filter((id) => secretData.some((secret) => secret.id === id && secret.configured)).length;
                  return <Tag color={configured === secretRefs.length ? 'success' : 'warning'}>{configured}/{secretRefs.length}</Tag>;
                },
              },
              {
                title: '使用方',
                width: 150,
                render: (_, record) => {
                  const usage = toolUsageById.get(record.id);
                  if (!usage) return <span className="audit-subtle">未绑定</span>;
                  return (
                    <div className="tool-usage-cell">
                      <strong>{usage.services + usage.subagents} Agent / {usage.skills} Skills</strong>
                      <span>{usage.publishedServices ? `${usage.publishedServices} 个线上引用` : '未影响线上'}</span>
                    </div>
                  );
                },
              },
              {
                title: '上线检查',
                width: 190,
                render: (_, record) => {
                  const health = toolHealthById[record.id];
                  if (!health) return <Tag>检测中</Tag>;
                  return <HealthTags ready={health.ready} score={health.score} blockers={health.blockers} warnings={health.warnings} />;
                },
              },
              {
                title: '最近 Run Evidence',
                width: 150,
                render: (_, record) => {
                  const health = toolHealthById[record.id];
                  if (!health?.last_invocation_status) return <span className="audit-subtle">暂无记录</span>;
                  return (
                    <div className="tool-policy-cell">
                      <StatusTag status={health.last_invocation_status} />
                      <span>{formatDate(health.last_invoked_at)}</span>
                    </div>
                  );
                },
              },
              {
                title: '操作',
                width: 176,
                render: (_, record) => (
                  <Space size={4}>
                    <Tooltip title="查看详情与连通测试">
                      <Button size="small" icon={<Eye size={14} />} onClick={() => openToolDetail(record)} />
                    </Tooltip>
                    <Button size="small" disabled={!canManageTools} onClick={() => openTool(record)}>编辑</Button>
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'toggle', label: record.status === 'active' ? '停用' : '启用', disabled: !canManageTools },
                          { type: 'divider' },
                          { key: 'delete', label: '删除', danger: true, disabled: !canManageTools },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'toggle') toggleToolStatus(record);
                          if (key === 'delete') {
                            modal.confirm({
                              title: '确定删除该 Tool？',
                              content: '仍被 Agent、Skills、上线版本、存量运行或 Tool Evidence 引用时后端会拒绝删除。',
                              okText: '删除',
                              okButtonProps: { danger: true },
                              cancelText: '取消',
                              onOk: () => deleteTool.mutate(record.id),
                            });
                          }
                        },
                      }}
                      trigger={['click']}
                    >
                      <Button size="small" icon={<MoreHorizontal size={14} />} />
                    </Dropdown>
                  </Space>
                ),
              },
            ]}
          />
        </PageSurface>
      </section>

      <Drawer
        title={selectedTool ? `Tool Detail · ${selectedTool.name}` : 'Tool Detail'}
        width={820}
        open={Boolean(selectedTool)}
        onClose={() => {
          setInspectingTool(null);
          setSelectedToolId(null);
          setToolInput('');
          setToolOutput('');
        }}
      >
        {selectedTool && (
          <Tabs
            items={[
              {
                key: 'definition',
                label: 'Tool Definition',
                children: (
                  <div className="tool-detail-panel">
                    <section>
                      <h3>Tool Definition</h3>
                      <div className="tool-definition-hero">
                        <EntityCell
                          icon={<Wrench size={18} />}
                          title={selectedTool.name}
                          subtitle={selectedTool.description || '未填写使用边界'}
                        />
                        <Space wrap size={[6, 6]}>
                          <Tag color={selectedTool.implementation === 'http' ? 'blue' : selectedTool.implementation === 'mcp' ? 'geekblue' : 'default'}>
                            {implementationLabel(selectedTool.implementation)}
                          </Tag>
                          <Tag>{selectedTool.category}</Tag>
                          <StatusTag status={selectedTool.status} />
                        </Space>
                      </div>
                    </section>
                    <div className="kv-list">
                      <div><span>Tool ID</span><strong>{selectedTool.id}</strong></div>
                      <div><span>接入方式</span><strong>{implementationLabel(selectedTool.implementation)}</strong></div>
                      <div><span>创建时间</span><strong>{formatDate(selectedTool.created_at)}</strong></div>
                      <div><span>更新时间</span><strong>{formatDate(selectedTool.updated_at)}</strong></div>
                    </div>
                    <section>
                      <h3>接入详情</h3>
                      <div className="tool-endpoint">
                        <span>{implementationLabel(selectedTool.implementation)}</span>
                        <strong>{endpointLabel(selectedTool)}</strong>
                      </div>
                    </section>
                  </div>
                ),
              },
              {
                key: 'auth',
                label: '授权与边界',
                children: (
                  <div className="tool-detail-panel">
                    <section>
                      <h3>调用权限</h3>
                      <div className="kv-list">
                        <div><span>最低角色</span><strong>{roleMeta[normalizeRequiredRole(selectedTool.metadata?.required_role)].label}</strong></div>
                        <div><span>密钥引用</span><strong>{readSecretRefs(selectedTool).length}</strong></div>
                      </div>
                      <Space wrap>
                        {readSecretRefs(selectedTool).length ? readSecretRefs(selectedTool).map((secretId) => {
                          const configured = secretData.some((secret) => secret.id === secretId && secret.configured);
                          return <Tag color={configured ? 'success' : 'warning'} key={secretId}>{secretId} · {configured ? '已配置' : '未配置'}</Tag>;
                        }) : <Tag>无需密钥</Tag>}
                      </Space>
                    </section>
                    <section>
                      <h3>访问边界</h3>
                      {renderEgressSummary(selectedToolHealth) || <div className="mini-empty compact">当前 Tool 无需额外访问边界。</div>}
                    </section>
                    <section>
                      <h3>上线检查</h3>
                      {selectedToolHealth ? (
                        <div className="tool-check-list">
                          {selectedToolHealth.checks.map((check) => (
                            <div className={check.passed ? 'passed' : check.severity} key={check.key}>
                              <StatusTag status={check.passed} trueLabel="通过" falseLabel={check.severity === 'blocker' ? '未通过' : '风险提示'} />
                              <strong>{check.label}</strong>
                              <span>{check.detail}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mini-empty">暂无上线检查结果。</div>
                      )}
                    </section>
                  </div>
                ),
              },
              {
                key: 'test',
                label: '连通测试',
                children: (() => {
                  const requiredRole = normalizeRequiredRole(selectedTool.metadata?.required_role);
                  const currentRole = currentUser.data?.membership.role || 'viewer';
                  const canInvokeTool = roleRank[currentRole] >= roleRank[requiredRole];
                  const invokeDisabledReason = selectedTool.status !== 'active'
                    ? 'Tool 已停用，无法连通测试'
                    : canInvokeTool
                      ? ''
                      : `当前角色为${roleMeta[currentRole].label}，调用需 ${roleMeta[requiredRole].label}`;
                  return (
                    <div className="tool-test-panel">
                      <Input.TextArea
                        rows={6}
                        value={toolInput}
                        onChange={(event) => setToolInput(event.target.value)}
                        placeholder={selectedTool.implementation === 'builtin' ? '按 Tool 要求输入文本' : '输入文本或 JSON 字符串作为 Tool 入参'}
                      />
                      <Space>
                        <Tooltip title={invokeDisabledReason || '按当前输入调用 Tool 并写入 Run Evidence'}>
                          <span>
                            <Button
                              type="primary"
                              icon={<PlayCircle size={15} />}
                              loading={invokeTool.isPending}
                              disabled={Boolean(invokeDisabledReason)}
                              onClick={() => invokeTool.mutate({ id: selectedTool.id, input: toolInput })}
                            >
                              执行连通测试
                            </Button>
                          </span>
                        </Tooltip>
                      </Space>
                      {toolOutput && <pre>{toolOutput}</pre>}
                    </div>
                  );
                })(),
              },
              {
                key: 'audit',
                label: 'Run Evidence',
                children: (
                  <Table
                    scroll={{ x: 720 }}
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={selectedToolAudits}
                    columns={[
                      { title: '结果', dataIndex: 'status', width: 90, render: (value) => <StatusTag status={value} /> },
                      { title: '来源', dataIndex: 'source', width: 110, render: (value) => <Tag color={auditSourceColor(value)}>{auditSourceLabel(value)}</Tag> },
                      { title: '耗时', dataIndex: 'duration_ms', width: 80, render: (value) => `${value}ms` },
                      { title: '时间', dataIndex: 'created_at', width: 170, render: formatDate },
                      { title: '摘要', render: (_, record) => <span className="audit-preview">{record.error || record.response_preview || record.request_preview || '-'}</span> },
                    ]}
                  />
                ),
              },
              {
                key: 'used-by',
                label: '使用方',
                children: (
                  <div className="tool-detail-panel">
                    {selectedToolUsage ? (
                      <>
                        <div className="tool-impact-list">
                          <div><GitBranch size={14} /><span>Agent 绑定</span><strong>{selectedToolUsage.services + selectedToolUsage.subagents}</strong></div>
                          <div><Wrench size={14} /><span>Skill 引用</span><strong>{selectedToolUsage.skills}</strong></div>
                          <div><ShieldCheck size={14} /><span>线上引用</span><strong>{selectedToolUsage.publishedServices}</strong></div>
                          <p>{[...selectedToolUsage.serviceNames, ...selectedToolUsage.skillNames].slice(0, 8).join('、') || '未绑定'}</p>
                        </div>
                        <section>
                          <h3>使用方明细</h3>
                          <div className="tool-used-by-list">
                            {selectedToolUsage.serviceNames.map((name) => (
                              <div key={`service-${name}`}><GitBranch size={14} /><span>Agent</span><strong>{name}</strong></div>
                            ))}
                            {selectedToolUsage.skillNames.map((name) => (
                              <div key={`skill-${name}`}><Wrench size={14} /><span>Skill</span><strong>{name}</strong></div>
                            ))}
                          </div>
                        </section>
                      </>
                    ) : (
                      <div className="mini-empty compact">当前没有 Agent 或 Skill 绑定这个 Tool。</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'advanced',
                label: '技术详情',
                children: (
                  <div className="expert-mode-block">
                    <div className="secret-note">
                      <strong>技术详情</strong>
                      <span>仅用于高级排障和协议级核查；日常治理请优先使用 Tool Definition、授权边界、连通测试和 Run Evidence。</span>
                    </div>
                    <details className="tool-metadata-details">
                      <summary>查看 Tool 配置 JSON</summary>
                      <pre className="tool-metadata-preview">{JSON.stringify(selectedTool.metadata || {}, null, 2)}</pre>
                    </details>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>

      <Drawer title={editingTool ? `编辑 Tool · ${editingTool.id}` : '新建 Tool'} width={760} open={toolOpen} onClose={() => setToolOpen(false)}>
        <Form form={toolForm} layout="vertical" onFinish={(values) => saveTool.mutate(values)}>
          <div className="drawer-section-grid">
            <section>
              <h3>基本信息</h3>
              <Space.Compact block>
                <Form.Item name="id" label="Tool ID" className="compact-field" rules={[{ required: true }]}>
                  <Input disabled={Boolean(editingTool)} placeholder="company_search" />
                </Form.Item>
                <Form.Item name="implementation" label="接入方式" className="compact-field" rules={[{ required: true }]}>
                  <Select
                    disabled={Boolean(editingTool)}
                    onChange={switchNewToolImplementation}
                    options={[
                      { value: 'http', label: 'HTTP' },
                      { value: 'mcp', label: 'MCP' },
                      { value: 'builtin', label: '内置' },
                    ]}
                  />
                </Form.Item>
              </Space.Compact>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="description" label="用途说明">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Space.Compact block>
                <Form.Item name="category" label="分类" className="compact-field">
                  <Input />
                </Form.Item>
                <Form.Item name="status" label="状态" className="compact-field">
                  <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
                </Form.Item>
              </Space.Compact>
            </section>

            {(watchedImplementation === 'http' || watchedImplementation === 'mcp') && (
              <section>
                <h3>连接配置</h3>
                {watchedImplementation === 'http' && (
                  <Space.Compact block>
                    <Form.Item name="method" label="方法" className="compact-field">
                      <Select options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))} />
                    </Form.Item>
                    <Form.Item name="url" label="服务地址" className="compact-field" rules={[{ required: true }]}>
                      <Input placeholder="https://api.company.com/search" />
                    </Form.Item>
                  </Space.Compact>
                )}
                {watchedImplementation === 'mcp' && (
                  <>
                    <Space.Compact block>
                      <Form.Item name="transport" label="传输" className="compact-field">
                        <Select options={[{ value: 'http', label: 'HTTP' }, { value: 'stdio', label: 'STDIO' }]} />
                      </Form.Item>
                      <Form.Item name="tool_name" label="MCP Tool 名" className="compact-field" rules={[{ required: true }]}>
                        <Input placeholder="search" />
                      </Form.Item>
                    </Space.Compact>
                    {watchedTransport === 'stdio' ? (
                      <Form.Item name="command" label="启动命令" rules={[{ required: true }]}>
                        <Input placeholder="/usr/local/bin/mcp-server" />
                      </Form.Item>
                    ) : (
                      <Form.Item name="url" label="服务地址" rules={[{ required: true }]}>
                        <Input placeholder="https://mcp.company.com/mcp" />
                      </Form.Item>
                    )}
                  </>
                )}
                <Form.Item name="timeout_seconds" label="超时秒数">
                  <InputNumber min={1} max={300} />
                </Form.Item>
              </section>
            )}

            <section>
              <h3>安全策略</h3>
              <Space.Compact block>
                <Form.Item name="required_role" label="调用所需角色" className="compact-field" initialValue="editor">
                  <Select options={requiredRoleOptions} />
                </Form.Item>
                <Form.Item name="secret_id" label="密钥引用" className="compact-field">
                  <Select
                    allowClear
                    placeholder="无需密钥"
                    options={secretData.map((item) => ({ value: item.id, label: `${item.name} · ${item.id}` }))}
                  />
                </Form.Item>
              </Space.Compact>
              {(watchedImplementation === 'http' || watchedImplementation === 'mcp') && (
                <>
                  <Form.Item name="allowed_hosts" label="允许 Host">
                    <Input.TextArea rows={3} placeholder="api.company.com&#10;mcp.company.com" />
                  </Form.Item>
                  <Form.Item name="blocked_hosts" label="禁止 Host">
                    <Input.TextArea rows={2} placeholder="internal.company.local" />
                  </Form.Item>
                  <Form.Item name="allow_private_networks" label="允许私网/本机" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </>
              )}
            </section>

            <Collapse
              className="advanced-collapse"
              items={[
                {
                  key: 'metadata',
                label: '技术详情',
                  children: (
                    <Form.Item label="Tool 配置 JSON">
                      <Input.TextArea
                        className="json-textarea"
                        rows={8}
                        value={toolMetadataText}
                        onChange={(event) => setToolMetadataText(event.target.value)}
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />
          </div>
          <div className="drawer-sticky-actions">
            <Button type="primary" htmlType="submit" loading={saveTool.isPending}>保存 Tool</Button>
          </div>
        </Form>
      </Drawer>

      <Drawer title="导入 OpenAPI Tools" width={760} open={openApiOpen} onClose={() => setOpenApiOpen(false)}>
        <Form form={openApiForm} layout="vertical" onFinish={(values) => importOpenApiTools.mutate(values)}>
          <Space.Compact block>
            <Form.Item name="prefix" label="Tool ID 前缀" className="compact-field">
              <Input placeholder="例如 search" />
            </Form.Item>
            <Form.Item name="category" label="分类" className="compact-field">
              <Input placeholder="openapi" />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item name="overwrite" label="覆盖同名 Tool" valuePropName="checked" className="compact-field">
              <Switch />
            </Form.Item>
            <Form.Item name="allow_private_networks" label="允许私网/本机" valuePropName="checked" className="compact-field">
              <Switch />
            </Form.Item>
          </Space.Compact>
          <div className="secret-note">
            <strong>结构化接入</strong>
            <span>从 OpenAPI 3 文档生成接口 Tools；导入后仍需要复核权限、密钥、访问边界和连通测试结果。</span>
          </div>
          <Form.Item label="OpenAPI 文档 JSON">
            <Input.TextArea
              className="json-textarea"
              rows={14}
              value={openApiSpecText}
              onChange={(event) => setOpenApiSpecText(event.target.value)}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={importOpenApiTools.isPending}>导入 Tools</Button>
        </Form>
      </Drawer>

      <Drawer title="导入 MCP Tools" width={820} open={mcpImportOpen} onClose={() => setMcpImportOpen(false)}>
        <Form form={mcpImportForm} layout="vertical" onFinish={(values) => importMcpTools.mutate(values)}>
          <Space.Compact block>
            <Form.Item name="prefix" label="Tool ID 前缀" className="compact-field">
              <Input placeholder="例如 mcp" />
            </Form.Item>
            <Form.Item name="category" label="分类" className="compact-field">
              <Input placeholder="mcp" />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="overwrite" label="覆盖同名 Tool" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div className="secret-note">
            <strong>MCP 发现</strong>
            <span>连接服务后发现 Tool 列表，选中的 Tools 会进入 Tool Registry 并继承当前连接策略。</span>
          </div>
          <Collapse
            className="advanced-collapse"
            items={[
              {
                key: 'metadata',
                label: '连接技术详情',
                children: (
                  <Form.Item label="MCP 连接配置 JSON">
                    <Input.TextArea
                      className="json-textarea"
                      rows={10}
                      value={mcpImportMetadataText}
                      onChange={(event) => setMcpImportMetadataText(event.target.value)}
                      placeholder='{"transport":"http","url":"https://example.com/mcp","headers":{},"secret_headers":{"Authorization":"secret_id"},"timeout_seconds":30,"required_role":"admin","egress_policy":{"allowed_hosts":["example.com"],"blocked_hosts":[],"allow_private_networks":false}}'
                    />
                  </Form.Item>
                ),
              },
            ]}
          />
          <Space className="drawer-action-row">
            <Button loading={discoverMcpTools.isPending} onClick={() => discoverMcpTools.mutate()}>
              发现 Tools
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={importMcpTools.isPending}
              disabled={!selectedMcpToolNames.length}
            >
              导入选中 Tools
            </Button>
          </Space>
          <Table
            className="mcp-discovery-table"
            size="small"
            rowKey="name"
            pagination={false}
            dataSource={mcpDiscoveredTools}
            rowSelection={{
              selectedRowKeys: selectedMcpToolNames,
              onChange: (keys) => setSelectedMcpToolNames(keys.map(String)),
            }}
            columns={[
              { title: 'Tool 名', dataIndex: 'name', width: 180 },
              { title: '描述', dataIndex: 'description' },
              {
                title: '参数',
                width: 260,
                render: (_, record: McpDiscoveredTool) => (
                  <Tooltip title={<pre className="schema-preview">{JSON.stringify(record.args_schema || {}, null, 2)}</pre>}>
                    <span className="resource-chip">查看参数</span>
                  </Tooltip>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>

      <Drawer title={editingSecret ? `轮换 Tool Secret · ${editingSecret.id}` : '新建 Tool Secret'} width={520} open={secretOpen} onClose={() => setSecretOpen(false)}>
        <Form form={secretForm} layout="vertical" onFinish={(values) => saveToolSecret.mutate(values)}>
          <Form.Item name="id" label="密钥 ID" rules={[{ required: true }]}>
            <Input disabled={Boolean(editingSecret)} placeholder="secret_search_api_key" />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="搜索 API 密钥" />
          </Form.Item>
          <Form.Item name="value" label={editingSecret ? '新密钥值' : '密钥值'} rules={[{ required: !editingSecret }]}>
            <Input.Password autoComplete="new-password" placeholder={editingSecret ? '留空则只更新名称/描述' : '请输入密钥值'} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <div className="secret-note">
            <strong>引用方式</strong>
            <span>在 Tool 高级属性或结构化凭证配置中引用密钥 ID，运行时由后端注入真实值。</span>
          </div>
          <Button type="primary" htmlType="submit" loading={saveToolSecret.isPending} disabled={!canManageToolSecrets}>保存密钥</Button>
        </Form>
      </Drawer>
    </>
  );
}
