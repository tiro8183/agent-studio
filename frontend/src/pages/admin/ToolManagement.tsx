import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Eye, GitBranch, KeyRound, MoreHorizontal, Network, PlayCircle, Plus, ShieldCheck, Wrench } from 'lucide-react';
import { EntityCell, HealthTags, PageSurface, StatusTag, TableToolbar } from '../../components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { Confirm } from '@/components/ui/confirm';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Field } from '@/components/layout';
import { toast } from '@/lib/toast';
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

type ToolFormState = {
  id: string;
  name: string;
  description: string;
  category: string;
  implementation: ToolDefinition['implementation'];
  status: string;
  method: string;
  url: string;
  transport: string;
  tool_name: string;
  command: string;
  timeout_seconds: number | null;
  required_role: ToolRequiredRole;
  secret_id: string;
  allowed_hosts: string;
  blocked_hosts: string;
  allow_private_networks: boolean;
};

type OpenApiFormState = {
  prefix: string;
  category: string;
  overwrite: boolean;
  allow_private_networks: boolean;
};

type McpImportFormState = {
  prefix: string;
  category: string;
  overwrite: boolean;
};

type SecretFormState = {
  id: string;
  name: string;
  value: string;
  description: string;
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

const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';

const roleMeta: Record<ToolRequiredRole, { label: string; variant: BadgeVariant }> = {
  viewer: { label: '观察者', variant: 'muted' },
  editor: { label: '编辑者', variant: 'info' },
  admin: { label: '管理员', variant: 'default' },
  owner: { label: '所有者', variant: 'warning' },
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

function auditSourceVariant(value?: string | null): BadgeVariant {
  if (value === 'manual') return 'info';
  if (value === 'runtime') return 'default';
  if (value === 'test') return 'secondary';
  if (value === 'system') return 'muted';
  return 'muted';
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

function implementationVariant(value: ToolDefinition['implementation'] | string): BadgeVariant {
  if (value === 'http') return 'info';
  if (value === 'mcp') return 'default';
  return 'muted';
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

function toToolFormState(values: typeof defaultHttpTool | typeof defaultMcpTool | ToolDefinition): ToolFormState {
  const metadata = (values.metadata || {}) as Record<string, unknown>;
  const egressPolicy = metadata.egress_policy;
  const egressPolicyObject = egressPolicy && typeof egressPolicy === 'object' && !Array.isArray(egressPolicy)
    ? egressPolicy as Record<string, unknown>
    : {};
  const secretRefs = readSecretRefs(values as ToolDefinition);
  return {
    id: String(values.id || ''),
    name: String(values.name || ''),
    description: String(values.description || ''),
    category: String(values.category || ''),
    implementation: values.implementation as ToolDefinition['implementation'],
    status: String(values.status || 'active'),
    method: String(metadata.method || 'POST'),
    url: String(metadata.url || ''),
    transport: String(metadata.transport || 'http'),
    tool_name: String(metadata.tool_name || ''),
    command: String(metadata.command || ''),
    timeout_seconds: (metadata.timeout_seconds as number | undefined) ?? (values.implementation === 'mcp' ? 30 : 10),
    required_role: normalizeRequiredRole(metadata.required_role),
    secret_id: secretRefs[0] || '',
    allowed_hosts: stringList(egressPolicyObject.allowed_hosts).join('\n'),
    blocked_hosts: stringList(egressPolicyObject.blocked_hosts).join('\n'),
    allow_private_networks: Boolean(egressPolicyObject.allow_private_networks),
  };
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
  const [detailTab, setDetailTab] = useState('definition');
  const [pendingDeleteTool, setPendingDeleteTool] = useState<ToolDefinition | null>(null);
  const [toolForm, setToolForm] = useState<ToolFormState>(() => toToolFormState(defaultHttpTool));
  const [openApiForm, setOpenApiForm] = useState<OpenApiFormState>({ prefix: 'api', category: 'openapi', overwrite: false, allow_private_networks: false });
  const [mcpImportForm, setMcpImportForm] = useState<McpImportFormState>({ prefix: 'mcp', category: 'mcp', overwrite: false });
  const [secretForm, setSecretForm] = useState<SecretFormState>({ id: '', name: '', value: '', description: '' });
  const queryClient = useQueryClient();

  const setToolField = <K extends keyof ToolFormState>(key: K, value: ToolFormState[K]) => {
    setToolForm((prev) => ({ ...prev, [key]: value }));
  };

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
    mutationFn: (values: ToolFormState) => {
      if (!canManageTools) {
        throw new Error('Tool Definition 由管理员统一管理');
      }
      if (!values.id) {
        throw new Error('请填写 Tool ID');
      }
      if (!values.name) {
        throw new Error('请填写名称');
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
        if (!values.url) throw new Error('请填写服务地址');
        metadata.url = values.url;
        metadata.method = values.method || 'POST';
      }
      if (implementation === 'mcp') {
        if (!values.tool_name) throw new Error('请填写 MCP Tool 名');
        metadata.transport = values.transport || 'http';
        metadata.tool_name = values.tool_name;
        if (values.transport === 'stdio') {
          if (!values.command) throw new Error('请填写启动命令');
          metadata.command = values.command;
          delete metadata.url;
        } else {
          if (!values.url) throw new Error('请填写服务地址');
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
      const payload = {
        id: values.id,
        name: values.name,
        description: values.description,
        category: values.category,
        implementation: values.implementation,
        status: values.status as ToolDefinition['status'],
        metadata,
      };
      return editingTool ? api.updateTool(editingTool.id, payload) : api.createTool(payload);
    },
    onSuccess: () => {
      toast.success('Tool 已保存');
      setToolOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['tool-audits'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Tool 配置保存失败');
    },
  });

  const importOpenApiTools = useMutation({
    mutationFn: (values: OpenApiFormState) => {
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
      toast.success(`OpenAPI 导入完成：新增/覆盖 ${result.imported} 个，跳过 ${result.skipped} 个`);
      setOpenApiOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'OpenAPI 导入失败');
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
      toast.success(`发现 ${result.tools.length} 个 MCP Tools`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'MCP Tool 发现失败');
    },
  });

  const importMcpTools = useMutation({
    mutationFn: (values: McpImportFormState) => {
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
      toast.success(`MCP 导入完成：新增/覆盖 ${result.imported} 个，跳过 ${result.skipped} 个`);
      setMcpImportOpen(false);
      setMcpDiscoveredTools([]);
      setSelectedMcpToolNames([]);
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'MCP Tool 导入失败');
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
      toast.error(error instanceof Error ? error.message : 'Tool 连通测试失败');
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
      toast.success('Tool 已删除');
      queryClient.invalidateQueries({ queryKey: ['tools'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
      queryClient.invalidateQueries({ queryKey: ['agent-completeness'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Tool 删除失败');
    },
  });

  const saveToolSecret = useMutation({
    mutationFn: (values: SecretFormState) => {
      if (!values.id) {
        throw new Error('请填写密钥 ID');
      }
      if (!values.name) {
        throw new Error('请填写名称');
      }
      if (!editingSecret && !values.value) {
        throw new Error('请输入密钥值');
      }
      if (editingSecret) {
        const payload: Partial<ToolSecret> & { value?: string } = {
          id: values.id,
          name: values.name,
          description: values.description,
        };
        if (values.value) payload.value = values.value;
        return api.updateToolSecret(editingSecret.id, payload);
      }
      return api.createToolSecret({
        id: values.id,
        name: values.name,
        description: values.description,
        value: values.value,
      });
    },
    onSuccess: () => {
      toast.success('Tool Secret 已保存');
      setSecretOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tool-secrets'] });
      queryClient.invalidateQueries({ queryKey: ['tool-health'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Tool Secret 保存失败');
    },
  });

  const openTool = (record?: ToolDefinition, implementation: 'http' | 'mcp' = 'http') => {
    if (!canManageTools) {
      toast.warning('Tool Definition 由管理员统一管理');
      return;
    }
    const values = record || (implementation === 'mcp' ? defaultMcpTool : defaultHttpTool);
    setEditingTool(record || null);
    setToolForm(toToolFormState(values));
    setToolMetadataText(JSON.stringify(values.metadata || {}, null, 2));
    setToolOpen(true);
  };

  const openMcpImport = () => {
    if (!canManageTools) {
      toast.warning('MCP Tool 导入由管理员统一管理');
      return;
    }
    setMcpImportForm({ prefix: 'mcp', category: 'mcp', overwrite: false });
    setMcpImportMetadataText(JSON.stringify(defaultMcpImportMetadata, null, 2));
    setMcpDiscoveredTools([]);
    setSelectedMcpToolNames([]);
    setMcpImportOpen(true);
  };

  const openToolSecret = (record?: ToolSecret) => {
    if (!canManageToolSecrets) {
      toast.warning('Tool Secret 由管理员统一管理');
      return;
    }
    setEditingSecret(record || null);
    setSecretForm(record
      ? { id: record.id, name: record.name, value: '', description: record.description || '' }
      : { id: '', name: '', value: '', description: '' });
    setSecretOpen(true);
  };

  const switchNewToolImplementation = (implementation: 'builtin' | 'http' | 'mcp') => {
    if (editingTool) return;
    if (implementation === 'mcp') {
      setToolForm(toToolFormState({ ...defaultMcpTool, implementation }));
      setToolMetadataText(JSON.stringify(defaultMcpTool.metadata, null, 2));
      return;
    }
    if (implementation === 'http') {
      setToolForm(toToolFormState({ ...defaultHttpTool, implementation }));
      setToolMetadataText(JSON.stringify(defaultHttpTool.metadata, null, 2));
      return;
    }
    setToolForm((prev) => ({
      ...prev,
      implementation,
      required_role: 'editor',
    }));
    setToolMetadataText('{\n  "required_role": "editor"\n}');
  };

  const openOpenApiImport = () => {
    if (!canManageTools) {
      toast.warning('OpenAPI Tool 导入由管理员统一管理');
      return;
    }
    setOpenApiForm({ prefix: 'api', category: 'openapi', overwrite: false, allow_private_networks: false });
    setOpenApiOpen(true);
  };

  const openToolDetail = (record: ToolDefinition) => {
    setInspectingTool(record);
    setSelectedToolId(record.id);
    setToolInput('');
    setToolOutput('');
    setDetailTab('definition');
  };

  const handleAdvancedAction = (key: string) => {
    if (key === 'secret') openToolSecret();
    if (key === 'openapi') openOpenApiImport();
    if (key === 'mcp-import') openMcpImport();
    if (key === 'mcp-create') openTool(undefined, 'mcp');
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

  const toggleToolStatus = async (item: ToolDefinition) => {
    if (!canManageTools) {
      toast.warning('Tool 状态由管理员统一管理');
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
      { text: evidence.host ? `Host ${evidence.host}` : '', variant: 'muted' as BadgeVariant },
      {
        text: globalAllowedHosts.length ? `平台 ${globalAllowedHosts.join(', ')}` : '平台未配置允许 host',
        variant: (globalAllowedHosts.length ? 'muted' : 'warning') as BadgeVariant,
      },
      {
        text: toolAllowedHosts.length ? `Tool ${toolAllowedHosts.join(', ')}` : 'Tool 未配置允许 host',
        variant: (toolAllowedHosts.length ? 'muted' : 'warning') as BadgeVariant,
      },
    ].filter((tag) => tag.text);
    return (
      <div
        className={`rounded-lg border p-3 ${check.passed ? 'border-success/30 bg-success/8' : 'border-destructive/30 bg-destructive/8'}`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <strong className="text-sm font-semibold text-foreground">{check.passed ? '访问边界通过' : '访问边界未通过'}</strong>
          <span className="text-xs text-muted-foreground">{check.detail}</span>
        </div>
        {evidence.host && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => <Badge variant={tag.variant} key={tag.text}>{tag.text}</Badge>)}
            {evidence.is_private && <Badge variant="warning">私有网络</Badge>}
            {evidence.is_localhost && <Badge variant="destructive">本机地址</Badge>}
          </div>
        )}
      </div>
    );
  };

  const showConnectionConfig = toolForm.implementation === 'http' || toolForm.implementation === 'mcp';

  return (
    <>
      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Tool Registry</h2>
            <p className="text-sm text-muted-foreground">先确认 Tool 是否可上线、谁能调用、能访问哪些地址、最近是否跑通，再进入接入参数和技术详情。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal size={16} />
                  接入 Tool
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!canManageToolSecrets} onSelect={() => handleAdvancedAction('secret')}>新建密钥</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!canManageTools} onSelect={() => handleAdvancedAction('openapi')}>导入 OpenAPI</DropdownMenuItem>
                <DropdownMenuItem disabled={!canManageTools} onSelect={() => handleAdvancedAction('mcp-import')}>发现并导入 MCP</DropdownMenuItem>
                <DropdownMenuItem disabled={!canManageTools} onSelect={() => handleAdvancedAction('mcp-create')}>新建 MCP Tool</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button disabled={!canManageTools} title={canManageTools ? '新建 HTTP Tool' : '需管理员权限'} onClick={() => openTool(undefined, 'http')}>
              <Plus size={16} />
              新建 Tool
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Tool onboarding flow">
          {[
            { label: 'Tools', value: governanceMetrics.totalTools, hint: '已接入 Tools' },
            { label: '授权边界', value: governanceMetrics.secretRefs, hint: '密钥引用' },
            { label: 'Run Evidence', value: governanceMetrics.failedAudits, hint: '最近失败' },
            { label: '证据样本', value: auditData.length, hint: '最近 30 条' },
            { label: '线上影响', value: Array.from(toolUsageById.values()).reduce((sum, item) => sum + item.publishedServices, 0), hint: '线上引用' },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-4">
              <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
              <strong className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</strong>
              <em className="text-xs not-italic text-muted-foreground">{item.hint}</em>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <PageSurface
            title="待处理 Tools"
            description="未通过项、访问边界失败和最近运行失败会优先进入队列。"
          >
            {toolHealth.isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">正在加载 Tool 检查状态...</div>
            ) : toolRiskItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                {toolRiskItems.map((item) => {
                  const checks = item.checks.filter((check) => !check.passed);
                  const tool = toolsData.find((record) => record.id === item.tool_id);
                  return (
                    <button
                      type="button"
                      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                      key={item.tool_id}
                      onClick={() => tool && openToolDetail(tool)}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{item.name}</span>
                        <HealthTags ready={item.ready} score={item.score} blockers={item.blockers} warnings={item.warnings} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Wrench size={13} /> {implementationLabel(item.implementation)}</span>
                        {item.last_invocation_status && (
                          <span className="inline-flex items-center gap-1"><Activity size={13} /> 最近运行 {invocationStatusLabel(item.last_invocation_status)}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {checks.slice(0, 3).map((check) => (
                          <Badge variant={check.severity === 'blocker' ? 'destructive' : 'warning'} key={check.key}>
                            {check.label}
                          </Badge>
                        ))}
                        {item.last_invocation_status === 'failed' && <Badge variant="destructive">最近运行失败</Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-8 text-center">
                <ShieldCheck size={18} className="text-success" />
                <strong className="text-sm font-medium text-foreground">当前没有待处理风险</strong>
                <span className="text-xs text-muted-foreground">上线检查、访问边界和最近 Run Evidence 未发现未通过项。</span>
              </div>
            )}
          </PageSurface>
          <PageSurface
            title="安全边界"
            description="授权凭据、访问边界和 Run Evidence 共同决定 Tool 是否允许上线。"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 text-sm text-foreground">
                <KeyRound size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>{governanceMetrics.secretRefs} 个 Tool 引用密钥，{governanceMetrics.configuredSecrets}/{governanceMetrics.totalSecrets} 个密钥已配置。</span>
              </div>
              <div className="flex items-start gap-2 text-sm text-foreground">
                <Network size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>{governanceMetrics.egressPolicies} 个外部 Tool 配置了 Tool 级访问边界。</span>
              </div>
              <div className="flex items-start gap-2 text-sm text-foreground">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span>删除 Tool 前必须解除 Agent、Skills、上线版本、存量运行和 Run Evidence 引用。</span>
              </div>
            </div>
          </PageSurface>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-foreground">密钥引用</span>
              <small className="block text-xs text-muted-foreground">{canManageToolSecrets ? '只保存引用到 Tool 高级属性，页面不回显密钥值。' : '当前角色可查看密钥配置状态，轮换和删除需管理员权限。'}</small>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">ID</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[90px]">状态</TableHead>
                  <TableHead className="w-[150px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(toolSecrets.data || []).map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-xs">{record.id}</TableCell>
                    <TableCell>{record.name}</TableCell>
                    <TableCell><StatusTag status={Boolean(record.configured)} trueLabel="已配置" falseLabel="未配置" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={!canManageToolSecrets} onClick={() => openToolSecret(record)}>轮换</Button>
                        <Confirm
                          title="确定删除该 Tool Secret？引用它的 HTTP Tool 会调用失败。"
                          disabled={!canManageToolSecrets}
                          onConfirm={() => deleteToolSecret(record.id)}
                        >
                          <Button size="sm" variant="destructive" disabled={!canManageToolSecrets}>删除</Button>
                        </Confirm>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(toolSecrets.data || []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">暂无密钥</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-foreground">Tool Evidence</span>
              <small className="block text-xs text-muted-foreground">记录 Tool 连通测试和线上运行时调用结果。</small>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Tool</TableHead>
                  <TableHead className="w-[90px]">结果</TableHead>
                  <TableHead className="w-[80px]">耗时</TableHead>
                  <TableHead className="w-[120px]">来源</TableHead>
                  <TableHead className="w-[130px]">上下文</TableHead>
                  <TableHead>摘要</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(toolAudits.data || []).map((record) => {
                  const userId = record.user_id?.trim();
                  const role = record.actor_role;
                  const primary = record.run_id || record.agent_id || record.conversation_id;
                  return (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-xs">{record.tool_id}</TableCell>
                      <TableCell><StatusTag status={record.status} /></TableCell>
                      <TableCell>{record.duration_ms}ms</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={auditSourceVariant(record.source)}>{auditSourceLabel(record.source)}</Badge>
                          <span className="text-xs text-muted-foreground">{userId ? shortAuditUserId(userId) : '系统'}</span>
                          {role && (
                            <Badge variant={isOrganizationRole(role) ? roleMeta[role].variant : 'muted'}>
                              {isOrganizationRole(role) ? roleMeta[role].label : role}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {primary ? (
                          <Tooltip
                            content={
                              <div className="flex flex-col gap-0.5">
                                {record.run_id && <div>Run: {record.run_id}</div>}
                                {record.agent_id && <div>Agent: {record.agent_id}</div>}
                                {record.conversation_id && <div>会话: {record.conversation_id}</div>}
                              </div>
                            }
                          >
                            <span className="inline-flex cursor-default rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{shortAuditResourceId(primary)}</span>
                          </Tooltip>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {record.error || record.response_preview || record.request_preview || '-'}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(toolAudits.data || []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">暂无记录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        </div>

        <PageSurface>
          <TableToolbar
            title="Tool Registry"
            description="以可用状态、授权状态、访问边界、Run Evidence 和使用方作为首层判断。"
          />
          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead className="w-[132px]">接入方式</TableHead>
                  <TableHead className="w-[92px]">可用状态</TableHead>
                  <TableHead className="w-[128px]">授权状态</TableHead>
                  <TableHead className="w-[220px]">安全边界</TableHead>
                  <TableHead className="w-[110px]">凭据</TableHead>
                  <TableHead className="w-[150px]">使用方</TableHead>
                  <TableHead className="w-[190px]">上线检查</TableHead>
                  <TableHead className="w-[150px]">最近 Run Evidence</TableHead>
                  <TableHead className="w-[176px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">加载中...</TableCell>
                  </TableRow>
                )}
                {!tools.isLoading && toolsData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">暂无 Tool</TableCell>
                  </TableRow>
                )}
                {toolsData.map((record) => {
                  const requiredRole = normalizeRequiredRole(record.metadata?.required_role);
                  const health = toolHealthById[record.id];
                  const evidence = egressEvidence(health);
                  const allowedHosts = evidence.tool_policy?.allowed_hosts || stringList((record.metadata?.egress_policy as Record<string, unknown> | undefined)?.allowed_hosts);
                  const secretRefs = readSecretRefs(record);
                  const configuredSecrets = secretRefs.filter((id) => secretData.some((secret) => secret.id === id && secret.configured)).length;
                  const usage = toolUsageById.get(record.id);
                  return (
                    <TableRow key={record.id}>
                      <TableCell>
                        <EntityCell
                          icon={<Wrench size={18} />}
                          title={record.name}
                          subtitle={`${record.id} · ${record.description || '未填写描述'}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={implementationVariant(record.implementation)}>{implementationLabel(record.implementation)}</Badge>
                          <Badge variant="muted">{record.category}</Badge>
                        </div>
                      </TableCell>
                      <TableCell><StatusTag status={record.status} /></TableCell>
                      <TableCell><Badge variant={roleMeta[requiredRole].variant}>{roleMeta[requiredRole].label}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <strong className="text-sm font-medium text-foreground">{allowedHosts.length ? allowedHosts.slice(0, 2).join('、') : record.implementation === 'builtin' ? '平台内置' : '未配置允许地址'}</strong>
                          <span className="truncate text-xs text-muted-foreground">{endpointLabel(record)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {!secretRefs.length
                          ? <Badge variant="muted">无引用</Badge>
                          : <Badge variant={configuredSecrets === secretRefs.length ? 'success' : 'warning'}>{configuredSecrets}/{secretRefs.length}</Badge>}
                      </TableCell>
                      <TableCell>
                        {!usage ? (
                          <span className="text-xs text-muted-foreground">未绑定</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <strong className="text-sm font-medium text-foreground">{usage.services + usage.subagents} Agent / {usage.skills} Skills</strong>
                            <span className="text-xs text-muted-foreground">{usage.publishedServices ? `${usage.publishedServices} 个线上引用` : '未影响线上'}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {!health
                          ? <Badge variant="muted">检测中</Badge>
                          : <HealthTags ready={health.ready} score={health.score} blockers={health.blockers} warnings={health.warnings} />}
                      </TableCell>
                      <TableCell>
                        {!health?.last_invocation_status ? (
                          <span className="text-xs text-muted-foreground">暂无记录</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <StatusTag status={health.last_invocation_status} />
                            <span className="text-xs text-muted-foreground">{formatDate(health.last_invoked_at)}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Tooltip content="查看详情与连通测试">
                            <Button size="icon" variant="outline" className="size-8" onClick={() => openToolDetail(record)}>
                              <Eye size={14} />
                            </Button>
                          </Tooltip>
                          <Button size="sm" variant="outline" disabled={!canManageTools} onClick={() => openTool(record)}>编辑</Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="outline" className="size-8">
                                <MoreHorizontal size={14} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={!canManageTools} onSelect={() => toggleToolStatus(record)}>
                                {record.status === 'active' ? '停用' : '启用'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!canManageTools}
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setPendingDeleteTool(record)}
                              >
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </PageSurface>
      </section>

      <Dialog open={Boolean(pendingDeleteTool)} onOpenChange={(v) => { if (!v) setPendingDeleteTool(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确定删除该 Tool？</DialogTitle>
            <DialogDescription>仍被 Agent、Skills、上线版本、存量运行或 Tool Evidence 引用时后端会拒绝删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDeleteTool(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDeleteTool) deleteTool.mutate(pendingDeleteTool.id);
                setPendingDeleteTool(null);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={Boolean(selectedTool)} onOpenChange={(v) => { if (!v) { setInspectingTool(null); setSelectedToolId(null); setToolInput(''); setToolOutput(''); } }}>
        <SheetContent side="right" className="w-[min(820px,calc(100vw-16px))] max-w-none p-0">
          <SheetHeader>
            <SheetTitle>{selectedTool ? `Tool Detail · ${selectedTool.name}` : 'Tool Detail'}</SheetTitle>
          </SheetHeader>
          {selectedTool && (() => {
            const requiredRole = normalizeRequiredRole(selectedTool.metadata?.required_role);
            const currentRole = currentUser.data?.membership.role || 'viewer';
            const canInvokeTool = roleRank[currentRole] >= roleRank[requiredRole];
            const invokeDisabledReason = selectedTool.status !== 'active'
              ? 'Tool 已停用，无法连通测试'
              : canInvokeTool
                ? ''
                : `当前角色为${roleMeta[currentRole].label}，调用需 ${roleMeta[requiredRole].label}`;
            const secretRefs = readSecretRefs(selectedTool);
            return (
              <SheetBody>
                <Tabs value={detailTab} onValueChange={setDetailTab}>
                  <TabsList>
                    <TabsTrigger value="definition">Tool Definition</TabsTrigger>
                    <TabsTrigger value="auth">授权与边界</TabsTrigger>
                    <TabsTrigger value="test">连通测试</TabsTrigger>
                    <TabsTrigger value="audit">Run Evidence</TabsTrigger>
                    <TabsTrigger value="used-by">使用方</TabsTrigger>
                    <TabsTrigger value="advanced">技术详情</TabsTrigger>
                  </TabsList>

                  <TabsContent value="definition">
                    <div className="flex flex-col gap-5">
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-foreground">Tool Definition</h3>
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                          <EntityCell
                            icon={<Wrench size={18} />}
                            title={selectedTool.name}
                            subtitle={selectedTool.description || '未填写使用边界'}
                          />
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant={implementationVariant(selectedTool.implementation)}>{implementationLabel(selectedTool.implementation)}</Badge>
                            <Badge variant="muted">{selectedTool.category}</Badge>
                            <StatusTag status={selectedTool.status} />
                          </div>
                        </div>
                      </section>
                      <dl className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">Tool ID</dt><dd className="mt-0.5 font-mono text-sm text-foreground">{selectedTool.id}</dd></div>
                        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">接入方式</dt><dd className="mt-0.5 text-sm text-foreground">{implementationLabel(selectedTool.implementation)}</dd></div>
                        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">创建时间</dt><dd className="mt-0.5 text-sm text-foreground">{formatDate(selectedTool.created_at)}</dd></div>
                        <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">更新时间</dt><dd className="mt-0.5 text-sm text-foreground">{formatDate(selectedTool.updated_at)}</dd></div>
                      </dl>
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-foreground">接入详情</h3>
                        <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
                          <span className="text-xs text-muted-foreground">{implementationLabel(selectedTool.implementation)}</span>
                          <strong className="break-all text-sm text-foreground">{endpointLabel(selectedTool)}</strong>
                        </div>
                      </section>
                    </div>
                  </TabsContent>

                  <TabsContent value="auth">
                    <div className="flex flex-col gap-5">
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-foreground">调用权限</h3>
                        <dl className="grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">最低角色</dt><dd className="mt-0.5 text-sm text-foreground">{roleMeta[requiredRole].label}</dd></div>
                          <div className="rounded-lg border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">密钥引用</dt><dd className="mt-0.5 text-sm text-foreground">{secretRefs.length}</dd></div>
                        </dl>
                        <div className="flex flex-wrap gap-1.5">
                          {secretRefs.length ? secretRefs.map((secretId) => {
                            const configured = secretData.some((secret) => secret.id === secretId && secret.configured);
                            return <Badge variant={configured ? 'success' : 'warning'} key={secretId}>{secretId} · {configured ? '已配置' : '未配置'}</Badge>;
                          }) : <Badge variant="muted">无需密钥</Badge>}
                        </div>
                      </section>
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-foreground">访问边界</h3>
                        {renderEgressSummary(selectedToolHealth) || <div className="rounded-lg border border-dashed border-border py-4 text-center text-sm text-muted-foreground">当前 Tool 无需额外访问边界。</div>}
                      </section>
                      <section className="space-y-3">
                        <h3 className="text-sm font-semibold text-foreground">上线检查</h3>
                        {selectedToolHealth ? (
                          <div className="flex flex-col gap-2">
                            {selectedToolHealth.checks.map((check) => (
                              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3" key={check.key}>
                                <StatusTag status={check.passed} trueLabel="通过" falseLabel={check.severity === 'blocker' ? '未通过' : '风险提示'} />
                                <strong className="text-sm font-medium text-foreground">{check.label}</strong>
                                <span className="text-xs text-muted-foreground">{check.detail}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">暂无上线检查结果。</div>
                        )}
                      </section>
                    </div>
                  </TabsContent>

                  <TabsContent value="test">
                    <div className="flex flex-col gap-3">
                      <Textarea
                        rows={6}
                        value={toolInput}
                        onChange={(event) => setToolInput(event.target.value)}
                        placeholder={selectedTool.implementation === 'builtin' ? '按 Tool 要求输入文本' : '输入文本或 JSON 字符串作为 Tool 入参'}
                      />
                      <div>
                        <Tooltip content={invokeDisabledReason || '按当前输入调用 Tool 并写入 Run Evidence'}>
                          <span className="inline-flex">
                            <Button
                              disabled={Boolean(invokeDisabledReason) || invokeTool.isPending}
                              onClick={() => invokeTool.mutate({ id: selectedTool.id, input: toolInput })}
                            >
                              <PlayCircle size={15} />
                              {invokeTool.isPending ? '执行中…' : '执行连通测试'}
                            </Button>
                          </span>
                        </Tooltip>
                      </div>
                      {toolOutput && <pre className="overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-foreground">{toolOutput}</pre>}
                    </div>
                  </TabsContent>

                  <TabsContent value="audit">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[90px]">结果</TableHead>
                          <TableHead className="w-[110px]">来源</TableHead>
                          <TableHead className="w-[80px]">耗时</TableHead>
                          <TableHead className="w-[170px]">时间</TableHead>
                          <TableHead>摘要</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedToolAudits.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell><StatusTag status={record.status} /></TableCell>
                            <TableCell><Badge variant={auditSourceVariant(record.source)}>{auditSourceLabel(record.source)}</Badge></TableCell>
                            <TableCell>{record.duration_ms}ms</TableCell>
                            <TableCell>{formatDate(record.created_at)}</TableCell>
                            <TableCell><span className="line-clamp-2 text-xs text-muted-foreground">{record.error || record.response_preview || record.request_preview || '-'}</span></TableCell>
                          </TableRow>
                        ))}
                        {selectedToolAudits.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">暂无记录</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TabsContent>

                  <TabsContent value="used-by">
                    <div className="flex flex-col gap-5">
                      {selectedToolUsage ? (
                        <>
                          <div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-3">
                            <div className="flex items-center gap-2 text-sm"><GitBranch size={14} className="text-muted-foreground" /><span className="text-muted-foreground">Agent 绑定</span><strong className="text-foreground">{selectedToolUsage.services + selectedToolUsage.subagents}</strong></div>
                            <div className="flex items-center gap-2 text-sm"><Wrench size={14} className="text-muted-foreground" /><span className="text-muted-foreground">Skill 引用</span><strong className="text-foreground">{selectedToolUsage.skills}</strong></div>
                            <div className="flex items-center gap-2 text-sm"><ShieldCheck size={14} className="text-muted-foreground" /><span className="text-muted-foreground">线上引用</span><strong className="text-foreground">{selectedToolUsage.publishedServices}</strong></div>
                            <p className="text-xs text-muted-foreground sm:col-span-3">{[...selectedToolUsage.serviceNames, ...selectedToolUsage.skillNames].slice(0, 8).join('、') || '未绑定'}</p>
                          </div>
                          <section className="space-y-3">
                            <h3 className="text-sm font-semibold text-foreground">使用方明细</h3>
                            <div className="flex flex-col gap-2">
                              {selectedToolUsage.serviceNames.map((name) => (
                                <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-sm" key={`service-${name}`}><GitBranch size={14} className="text-muted-foreground" /><span className="text-muted-foreground">Agent</span><strong className="text-foreground">{name}</strong></div>
                              ))}
                              {selectedToolUsage.skillNames.map((name) => (
                                <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-sm" key={`skill-${name}`}><Wrench size={14} className="text-muted-foreground" /><span className="text-muted-foreground">Skill</span><strong className="text-foreground">{name}</strong></div>
                              ))}
                            </div>
                          </section>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed border-border py-4 text-center text-sm text-muted-foreground">当前没有 Agent 或 Skill 绑定这个 Tool。</div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="advanced">
                    <div className="flex flex-col gap-3">
                      <div className="rounded-lg border border-border bg-muted/40 p-3">
                        <strong className="block text-sm font-medium text-foreground">技术详情</strong>
                        <span className="mt-0.5 block text-xs text-muted-foreground">仅用于高级排障和协议级核查；日常治理请优先使用 Tool Definition、授权边界、连通测试和 Run Evidence。</span>
                      </div>
                      <details className="rounded-lg border border-border bg-card p-3">
                        <summary className="cursor-pointer text-sm font-medium text-foreground">查看 Tool 配置 JSON</summary>
                        <pre className="mt-2 overflow-auto font-mono text-xs text-muted-foreground">{JSON.stringify(selectedTool.metadata || {}, null, 2)}</pre>
                      </details>
                    </div>
                  </TabsContent>
                </Tabs>
              </SheetBody>
            );
          })()}
        </SheetContent>
      </Sheet>

      <Sheet open={toolOpen} onOpenChange={(v) => { if (!v) setToolOpen(false); }}>
        <SheetContent side="right" className="w-[min(760px,calc(100vw-16px))] max-w-none p-0">
          <SheetHeader>
            <SheetTitle>{editingTool ? `编辑 Tool · ${editingTool.id}` : '新建 Tool'}</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-5">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
              <div className="flex gap-3">
                <Field label="Tool ID" required className="flex-1">
                  <Input
                    disabled={Boolean(editingTool)}
                    placeholder="company_search"
                    value={toolForm.id}
                    onChange={(e) => setToolField('id', e.target.value)}
                  />
                </Field>
                <Field label="接入方式" required className="flex-1">
                  <Select
                    value={toolForm.implementation}
                    disabled={Boolean(editingTool)}
                    onValueChange={(value) => switchNewToolImplementation(value as 'builtin' | 'http' | 'mcp')}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="mcp">MCP</SelectItem>
                      <SelectItem value="builtin">内置</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="名称" required>
                <Input value={toolForm.name} onChange={(e) => setToolField('name', e.target.value)} />
              </Field>
              <Field label="用途说明">
                <Textarea rows={2} value={toolForm.description} onChange={(e) => setToolField('description', e.target.value)} />
              </Field>
              <div className="flex gap-3">
                <Field label="分类" className="flex-1">
                  <Input value={toolForm.category} onChange={(e) => setToolField('category', e.target.value)} />
                </Field>
                <Field label="状态" className="flex-1">
                  <Select value={toolForm.status} onValueChange={(value) => setToolField('status', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="inactive">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </section>

            {showConnectionConfig && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">连接配置</h3>
                {toolForm.implementation === 'http' && (
                  <div className="flex gap-3">
                    <Field label="方法" className="w-32 shrink-0">
                      <Select value={toolForm.method} onValueChange={(value) => setToolField('method', value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="服务地址" required className="flex-1">
                      <Input placeholder="https://api.company.com/search" value={toolForm.url} onChange={(e) => setToolField('url', e.target.value)} />
                    </Field>
                  </div>
                )}
                {toolForm.implementation === 'mcp' && (
                  <>
                    <div className="flex gap-3">
                      <Field label="传输" className="w-32 shrink-0">
                        <Select value={toolForm.transport} onValueChange={(value) => setToolField('transport', value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="http">HTTP</SelectItem>
                            <SelectItem value="stdio">STDIO</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="MCP Tool 名" required className="flex-1">
                        <Input placeholder="search" value={toolForm.tool_name} onChange={(e) => setToolField('tool_name', e.target.value)} />
                      </Field>
                    </div>
                    {toolForm.transport === 'stdio' ? (
                      <Field label="启动命令" required>
                        <Input placeholder="/usr/local/bin/mcp-server" value={toolForm.command} onChange={(e) => setToolField('command', e.target.value)} />
                      </Field>
                    ) : (
                      <Field label="服务地址" required>
                        <Input placeholder="https://mcp.company.com/mcp" value={toolForm.url} onChange={(e) => setToolField('url', e.target.value)} />
                      </Field>
                    )}
                  </>
                )}
                <Field label="超时秒数">
                  <NumberInput min={1} max={300} value={toolForm.timeout_seconds} onChange={(value) => setToolField('timeout_seconds', value)} />
                </Field>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">安全策略</h3>
              <div className="flex gap-3">
                <Field label="调用所需角色" className="flex-1">
                  <Select value={toolForm.required_role} onValueChange={(value) => setToolField('required_role', normalizeRequiredRole(value))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {requiredRoleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="密钥引用" className="flex-1">
                  <Select value={toolForm.secret_id || '__none__'} onValueChange={(value) => setToolField('secret_id', value === '__none__' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="无需密钥" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">无需密钥</SelectItem>
                      {secretData.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name} · {item.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {showConnectionConfig && (
                <>
                  <Field label="允许 Host">
                    <Textarea rows={3} placeholder={'api.company.com\nmcp.company.com'} value={toolForm.allowed_hosts} onChange={(e) => setToolField('allowed_hosts', e.target.value)} />
                  </Field>
                  <Field label="禁止 Host">
                    <Textarea rows={2} placeholder="internal.company.local" value={toolForm.blocked_hosts} onChange={(e) => setToolField('blocked_hosts', e.target.value)} />
                  </Field>
                  <Field label="允许私网/本机">
                    <div className="flex h-9 items-center">
                      <Switch checked={toolForm.allow_private_networks} onCheckedChange={(checked) => setToolField('allow_private_networks', checked)} />
                    </div>
                  </Field>
                </>
              )}
            </section>

            <Accordion type="single" collapsible>
              <AccordionItem value="metadata">
                <AccordionTrigger>技术详情</AccordionTrigger>
                <AccordionContent>
                  <Field label="Tool 配置 JSON">
                    <Textarea
                      className="font-mono text-xs"
                      rows={8}
                      value={toolMetadataText}
                      onChange={(event) => setToolMetadataText(event.target.value)}
                    />
                  </Field>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </SheetBody>
          <SheetFooter>
            <Button onClick={() => saveTool.mutate(toolForm)} disabled={saveTool.isPending}>{saveTool.isPending ? '保存中…' : '保存 Tool'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={openApiOpen} onOpenChange={(v) => { if (!v) setOpenApiOpen(false); }}>
        <SheetContent side="right" className="w-[min(760px,calc(100vw-16px))] max-w-none p-0">
          <SheetHeader>
            <SheetTitle>导入 OpenAPI Tools</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Field label="Tool ID 前缀" className="flex-1">
                <Input placeholder="例如 search" value={openApiForm.prefix} onChange={(e) => setOpenApiForm((prev) => ({ ...prev, prefix: e.target.value }))} />
              </Field>
              <Field label="分类" className="flex-1">
                <Input placeholder="openapi" value={openApiForm.category} onChange={(e) => setOpenApiForm((prev) => ({ ...prev, category: e.target.value }))} />
              </Field>
            </div>
            <div className="flex gap-3">
              <Field label="覆盖同名 Tool" className="flex-1">
                <div className="flex h-9 items-center">
                  <Switch checked={openApiForm.overwrite} onCheckedChange={(checked) => setOpenApiForm((prev) => ({ ...prev, overwrite: checked }))} />
                </div>
              </Field>
              <Field label="允许私网/本机" className="flex-1">
                <div className="flex h-9 items-center">
                  <Switch checked={openApiForm.allow_private_networks} onCheckedChange={(checked) => setOpenApiForm((prev) => ({ ...prev, allow_private_networks: checked }))} />
                </div>
              </Field>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <strong className="block text-sm font-medium text-foreground">结构化接入</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">从 OpenAPI 3 文档生成接口 Tools；导入后仍需要复核权限、密钥、访问边界和连通测试结果。</span>
            </div>
            <Field label="OpenAPI 文档 JSON">
              <Textarea
                className="font-mono text-xs"
                rows={14}
                value={openApiSpecText}
                onChange={(event) => setOpenApiSpecText(event.target.value)}
              />
            </Field>
          </SheetBody>
          <SheetFooter>
            <Button onClick={() => importOpenApiTools.mutate(openApiForm)} disabled={importOpenApiTools.isPending}>{importOpenApiTools.isPending ? '导入中…' : '导入 Tools'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={mcpImportOpen} onOpenChange={(v) => { if (!v) setMcpImportOpen(false); }}>
        <SheetContent side="right" className="w-[min(820px,calc(100vw-16px))] max-w-none p-0">
          <SheetHeader>
            <SheetTitle>导入 MCP Tools</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Field label="Tool ID 前缀" className="flex-1">
                <Input placeholder="例如 mcp" value={mcpImportForm.prefix} onChange={(e) => setMcpImportForm((prev) => ({ ...prev, prefix: e.target.value }))} />
              </Field>
              <Field label="分类" className="flex-1">
                <Input placeholder="mcp" value={mcpImportForm.category} onChange={(e) => setMcpImportForm((prev) => ({ ...prev, category: e.target.value }))} />
              </Field>
            </div>
            <Field label="覆盖同名 Tool">
              <div className="flex h-9 items-center">
                <Switch checked={mcpImportForm.overwrite} onCheckedChange={(checked) => setMcpImportForm((prev) => ({ ...prev, overwrite: checked }))} />
              </div>
            </Field>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <strong className="block text-sm font-medium text-foreground">MCP 发现</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">连接服务后发现 Tool 列表，选中的 Tools 会进入 Tool Registry 并继承当前连接策略。</span>
            </div>
            <Accordion type="single" collapsible>
              <AccordionItem value="metadata">
                <AccordionTrigger>连接技术详情</AccordionTrigger>
                <AccordionContent>
                  <Field label="MCP 连接配置 JSON">
                    <Textarea
                      className="font-mono text-xs"
                      rows={10}
                      value={mcpImportMetadataText}
                      onChange={(event) => setMcpImportMetadataText(event.target.value)}
                      placeholder='{"transport":"http","url":"https://example.com/mcp","headers":{},"secret_headers":{"Authorization":"secret_id"},"timeout_seconds":30,"required_role":"admin","egress_policy":{"allowed_hosts":["example.com"],"blocked_hosts":[],"allow_private_networks":false}}'
                    />
                  </Field>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={discoverMcpTools.isPending} onClick={() => discoverMcpTools.mutate()}>
                {discoverMcpTools.isPending ? '发现中…' : '发现 Tools'}
              </Button>
              <Button
                onClick={() => importMcpTools.mutate(mcpImportForm)}
                disabled={importMcpTools.isPending || !selectedMcpToolNames.length}
              >
                {importMcpTools.isPending ? '导入中…' : '导入选中 Tools'}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]" />
                  <TableHead className="w-[180px]">Tool 名</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead className="w-[260px]">参数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mcpDiscoveredTools.map((record) => {
                  const checked = selectedMcpToolNames.includes(record.name);
                  return (
                    <TableRow key={record.name}>
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setSelectedMcpToolNames((prev) => (
                              value ? Array.from(new Set([...prev, record.name])) : prev.filter((name) => name !== record.name)
                            ));
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{record.name}</TableCell>
                      <TableCell>{record.description}</TableCell>
                      <TableCell>
                        <Tooltip content={<pre className="max-h-64 overflow-auto font-mono text-[11px]">{JSON.stringify(record.args_schema || {}, null, 2)}</pre>}>
                          <span className="inline-flex cursor-default rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">查看参数</span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {mcpDiscoveredTools.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">尚未发现 Tools</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={secretOpen} onOpenChange={(v) => { if (!v) setSecretOpen(false); }}>
        <SheetContent side="right" className="w-[min(520px,calc(100vw-16px))] max-w-none p-0">
          <SheetHeader>
            <SheetTitle>{editingSecret ? `轮换 Tool Secret · ${editingSecret.id}` : '新建 Tool Secret'}</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-4">
            <Field label="密钥 ID" required>
              <Input disabled={Boolean(editingSecret)} placeholder="secret_search_api_key" value={secretForm.id} onChange={(e) => setSecretForm((prev) => ({ ...prev, id: e.target.value }))} />
            </Field>
            <Field label="名称" required>
              <Input placeholder="搜索 API 密钥" value={secretForm.name} onChange={(e) => setSecretForm((prev) => ({ ...prev, name: e.target.value }))} />
            </Field>
            <Field label={editingSecret ? '新密钥值' : '密钥值'} required={!editingSecret}>
              <Input type="password" autoComplete="new-password" placeholder={editingSecret ? '留空则只更新名称/描述' : '请输入密钥值'} value={secretForm.value} onChange={(e) => setSecretForm((prev) => ({ ...prev, value: e.target.value }))} />
            </Field>
            <Field label="描述">
              <Textarea rows={3} value={secretForm.description} onChange={(e) => setSecretForm((prev) => ({ ...prev, description: e.target.value }))} />
            </Field>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <strong className="block text-sm font-medium text-foreground">引用方式</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">在 Tool 高级属性或结构化凭证配置中引用密钥 ID，运行时由后端注入真实值。</span>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={() => saveToolSecret.mutate(secretForm)} disabled={saveToolSecret.isPending || !canManageToolSecrets}>{saveToolSecret.isPending ? '保存中…' : '保存密钥'}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
