import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Check, ChevronDown, Eye, FileText, GitBranch, MoreHorizontal, PackageCheck, Plus, ShieldAlert, Wrench } from 'lucide-react';
import { HealthTags, PageSurface } from '../../components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/layout';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Confirm } from '@/components/ui/confirm';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
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

interface SkillFormState {
  name: string;
  display_name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  status: 'active' | 'inactive';
}

const defaultSkill: SkillFormState = {
  name: '',
  display_name: '',
  description: '',
  instructions: '# 执行规范\n\n',
  allowed_tools: [],
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

/** Multi-select for Skill allowed tools — replaces antd Select mode="multiple". */
function ToolMultiSelect({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: SelectOption[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelById = useMemo(
    () => Object.fromEntries(options.map((item) => [item.value, item.label])) as Record<string, string>,
    [options],
  );
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((item) => item !== val) : [...value, val]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm shadow-sm transition-colors',
            'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
          )}
        >
          {value.length ? (
            <span className="flex flex-wrap gap-1">
              {value.map((item) => (
                <Badge key={item} variant="muted">
                  {labelById[item] || item}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">选择 Skill allowed tools</span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1.5" align="start">
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 && (
            <div className="px-2 py-2 text-sm text-muted-foreground">暂无可选 Tools</div>
          )}
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                onClick={() => toggle(option.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                <span className="flex size-4 items-center justify-center">
                  {checked ? <Check className="size-4 text-primary" /> : null}
                </span>
                <span className="flex-1">{option.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
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
  const [skillForm, setSkillForm] = useState<SkillFormState>(defaultSkill);
  const [skillFormErrors, setSkillFormErrors] = useState<Partial<Record<keyof SkillFormState, boolean>>>({});
  const [importOpts, setImportOpts] = useState({ overwrite: false, preserve_id: false });
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const queryClient = useQueryClient();

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
    mutationFn: (values: SkillFormState) => {
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
      toast.success('Skill 已保存');
      setSkillOpen(false);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Skill 保存失败');
    },
  });

  const publishSkill = useMutation({
    mutationFn: (id: string) => api.publishSkillVersion(id),
    onSuccess: () => {
      toast.success('Skill 版本已记录');
      queryClient.invalidateQueries({ queryKey: ['skill-versions', versioningSkill?.id] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Skill 版本记录失败');
    },
  });

  const restoreSkill = useMutation({
    mutationFn: (params: { id: string; version: number }) => api.restoreSkillVersion(params.id, params.version),
    onSuccess: (saved) => {
      toast.success('Skill 已恢复为历史版本');
      setVersioningSkill(saved);
      queryClient.invalidateQueries({ queryKey: ['skill-versions', saved.id] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Skill 恢复失败');
    },
  });

  const exportSkill = useMutation({
    mutationFn: (id: string) => api.exportSkill(id),
    onSuccess: (result) => {
      setSkillExportText(JSON.stringify(result, null, 2));
      toast.success('Skill 导出包已生成');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Skill 导出失败');
    },
  });

  const importSkill = useMutation({
    mutationFn: (values: { overwrite: boolean; preserve_id: boolean }) => {
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
      toast.success('Skill 已导入');
      setSkillImportOpen(false);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Skill 导入失败');
    },
  });

  const previewSkillImport = useMutation({
    mutationFn: (values: { overwrite: boolean; preserve_id: boolean }) => {
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
      toast.success('导入检查完成');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '导入检查失败');
    },
  });

  const diffSkillVersion = useMutation({
    mutationFn: (params: { id: string; version: number }) => api.diffSkillVersion(params.id, params.version),
    onSuccess: (result) => setSkillVersionDiff(result),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '版本差异加载失败');
    },
  });

  const openSkill = (record?: Skill) => {
    setEditingSkill(record || null);
    setSkillFormErrors({});
    if (record) {
      setSkillForm({
        name: record.name,
        display_name: record.display_name,
        description: record.description,
        instructions: record.instructions,
        allowed_tools: record.allowed_tools || [],
        status: record.status,
      });
    } else {
      setSkillForm(defaultSkill);
    }
    setSkillMetadataText(JSON.stringify((record || defaultSkill as unknown as Skill).metadata || {}, null, 2));
    setSkillOpen(true);
  };

  const submitSkill = () => {
    const errors: Partial<Record<keyof SkillFormState, boolean>> = {};
    if (!skillForm.name.trim()) errors.name = true;
    if (!skillForm.display_name.trim()) errors.display_name = true;
    if (!skillForm.description.trim()) errors.description = true;
    if (!skillForm.instructions.trim()) errors.instructions = true;
    setSkillFormErrors(errors);
    if (Object.keys(errors).length) return;
    saveSkill.mutate(skillForm);
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
      toast.error(error instanceof Error ? error.message : 'Skill Runtime Preview 加载失败');
    }
  };

  const openSkillImpact = async (record: Skill) => {
    try {
      setSkillImpact(await api.getSkillImpact(record.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Skill 影响分析加载失败');
    }
  };

  const openSkillImport = () => {
    setImportOpts({ overwrite: false, preserve_id: false });
    setSkillImportText('{\n  "kind": "agent-forge.skill",\n  "schema_version": 1,\n  "skill": {}\n}');
    setSkillImportPreview(null);
    setSkillImportOpen(true);
  };

  const confirmDeleteSkill = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteSkill(deleteTarget.id);
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill-health'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-preflight'] });
      toast.success('Skill 已删除');
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Skill 删除失败');
    }
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Skill overview">
        {[
          { label: 'Skills', value: governanceMetrics.totalSkills, hint: '可复用资产' },
          { label: '可用状态', value: governanceMetrics.activeSkills, hint: '可被 Agent 绑定' },
          { label: 'Skill allowed tools', value: governanceMetrics.totalTools, hint: '授权引用' },
          { label: '上线检查', value: governanceMetrics.readyCount, hint: '通过检查' },
          { label: '已上线', value: governanceMetrics.publishedBindings, hint: '已上线引用' },
        ].map((item) => (
          <div key={item.label} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
            <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
            <strong className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</strong>
            <em className="text-xs not-italic text-muted-foreground">{item.hint}</em>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PageSurface
          title="Skill 治理边界"
          description="执行规范、Skill allowed tools、Runtime Preview、版本记录和影响范围共同决定一个 Skill 是否可进入生产。"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 text-sm text-foreground">
              <Brain size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{governanceMetrics.activeSkills}/{governanceMetrics.totalSkills} 个 Skill 可用，平均检查分 {skillHealth.isLoading ? '-' : governanceMetrics.avgScore}。</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-foreground">
              <Wrench size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{governanceMetrics.totalTools} 个 Skill allowed tools 会进入 Agent Runtime 配置和上线检查。</span>
            </div>
            <div className="flex items-start gap-2 text-sm text-foreground">
              <PackageCheck size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>{governanceMetrics.publishedBindings} 个已上线 Agent 引用 Skill，修改后需要重新评估影响。</span>
            </div>
          </div>
        </PageSurface>

        <PageSurface
          title="待处理 Skills"
          description="只展示需要处理的上线检查和线上影响；日常治理以台账为主。"
        >
          {skillHealth.isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">正在加载 Skill 上线检查状态...</div>
          ) : riskItems.length > 0 ? (
            <div className="flex flex-col gap-2">
              {riskItems.map((item) => {
                const checks = item.checks.filter((check) => !check.passed);
                const skill = skillsData.find((record) => record.id === item.skill_id);
                return (
                  <button
                    type="button"
                    className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    key={item.skill_id}
                    onClick={() => skill && openSkill(skill)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{item.display_name || item.name}</span>
                      <HealthTags ready={item.ready} score={item.score} blockers={item.blockers} warnings={item.warnings} />
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><GitBranch size={13} /> {item.bound_agents} 个 Agent 绑定</span>
                      <span className="inline-flex items-center gap-1"><PackageCheck size={13} /> {item.published_agents} 个线上引用</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {checks.slice(0, 3).map((check) => (
                        <Badge variant={check.severity === 'blocker' ? 'destructive' : 'warning'} key={check.key}>
                          {check.label}
                        </Badge>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <ShieldAlert size={18} className="text-muted-foreground" />
              <strong className="text-sm text-foreground">当前没有待处理风险</strong>
              <span className="text-xs text-muted-foreground">所有 Skills 已具备上线前要求的基础检查状态。</span>
            </div>
          )}
        </PageSurface>
      </div>

      <PageSurface className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skill Registry</span>
            <strong className="block text-sm font-semibold text-foreground">说明书、Skill allowed tools、影响范围和版本治理在同一处判断。</strong>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <MoreHorizontal size={14} />
                  更多
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={openSkillImport}>导入 Skill</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openSkill()}>
              <Plus size={16} />
              新建 Skill
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="flex flex-col gap-2" aria-label="Skill list">
            {skills.isLoading && <div className="py-6 text-center text-sm text-muted-foreground">正在加载 Skill 资产...</div>}
            {!skills.isLoading && skillsData.map((record) => {
              const health = skillHealthById[record.id];
              const active = selectedSkill?.id === record.id;
              return (
                <button
                  type="button"
                  key={record.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40',
                    active ? 'border-primary ring-1 ring-primary/30' : 'border-border',
                  )}
                  onClick={() => setSelectedSkillId(record.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-foreground">{record.display_name || record.name}</strong>
                      <span className="block truncate text-xs text-muted-foreground">{record.description || '未填写使用边界'}</span>
                    </div>
                    <Badge variant={record.status === 'active' ? 'success' : 'muted'}>
                      {record.status === 'active' ? '启用' : '停用'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <Brain size={18} className="text-muted-foreground" />
                <strong className="text-sm text-foreground">还没有 Skill</strong>
                <span className="text-xs text-muted-foreground">创建第一个 Skill，把可复用的执行规范沉淀为 Agent 可绑定资产。</span>
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-border bg-card p-4" aria-label="Skill detail">
            {selectedSkill ? (
              <>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">{selectedSkill.name} · v{selectedSkill.version}</span>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">{selectedSkill.display_name || selectedSkill.name}</h2>
                  <p className="text-sm text-muted-foreground">{selectedSkill.description || '未填写使用边界。'}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={() => openSkill(selectedSkill)}>编辑说明书</Button>
                  <Button variant="outline" onClick={() => openSkillRuntimePreview(selectedSkill)}>
                    <Eye size={14} />
                    运行预览
                  </Button>
                  <Button variant="outline" onClick={() => openSkillImpact(selectedSkill)}>
                    <GitBranch size={14} />
                    影响范围
                  </Button>
                  <Button variant="outline" onClick={() => openSkillVersions(selectedSkill)}>
                    <FileText size={14} />
                    版本
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreHorizontal size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={openSkillImport}>导入 Skill</DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setDeleteTarget(selectedSkill)}
                      >
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <section className="mt-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ShieldAlert size={15} className="text-muted-foreground" />
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
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-md border border-border bg-muted/30 p-2.5">
                          <span className="block text-xs text-muted-foreground">绑定 Agent</span>
                          <strong className="text-base text-foreground">{selectedSkillHealth.bound_agents}</strong>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 p-2.5">
                          <span className="block text-xs text-muted-foreground">线上引用</span>
                          <strong className="text-base text-foreground">{selectedSkillHealth.published_agents}</strong>
                        </div>
                        <div className="rounded-md border border-border bg-muted/30 p-2.5">
                          <span className="block text-xs text-muted-foreground">状态</span>
                          <strong className="text-base text-foreground">{selectedSkillHealth.ready ? '可用' : '待处理'}</strong>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {selectedSkillHealth.checks.map((check) => (
                          <div
                            className={cn(
                              'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm',
                              check.passed
                                ? 'border-success/30 bg-success/8'
                                : check.severity === 'blocker'
                                  ? 'border-destructive/30 bg-destructive/8'
                                  : 'border-warning/30 bg-warning/8',
                            )}
                            key={check.key}
                          >
                            <span className="text-muted-foreground">{check.label}</span>
                            <strong className="text-foreground">{check.passed ? '通过' : check.detail}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">上线检查加载中。</div>
                  )}
                </section>

                <section className="mt-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Wrench size={15} className="text-muted-foreground" />
                    <span>Skill allowed tools</span>
                    <strong className="text-muted-foreground">{selectedSkill.allowed_tools.length}</strong>
                  </div>
                  {selectedSkill.allowed_tools.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedSkill.allowed_tools.map((toolId) => (
                        <Badge variant="muted" key={toolId}>{toolLabelById[toolId] || toolId}</Badge>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">不绑定 Tools，仅提供执行规范。</div>
                  )}
                </section>

                <section className="mt-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Brain size={15} className="text-muted-foreground" />
                    <span>执行规范摘要</span>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground">{selectedInstructions.length > 900 ? `${selectedInstructions.slice(0, 900)}...` : selectedInstructions || '未填写执行规范。'}</pre>
                </section>

                <details className="mt-5 rounded-md border border-border bg-muted/20 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">高级属性</summary>
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{JSON.stringify(selectedSkill.metadata || {}, null, 2)}</pre>
                </details>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <Brain size={18} className="text-muted-foreground" />
                <strong className="text-sm text-foreground">选择一个 Skill</strong>
                <span className="text-xs text-muted-foreground">查看 Runtime Preview、Skill allowed tools 和线上影响。</span>
              </div>
            )}
          </aside>
        </div>
      </PageSurface>

      <Sheet open={skillOpen} onOpenChange={setSkillOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <SheetHeader>
            <SheetTitle>{editingSkill ? '编辑 Skill' : '新建 Skill'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">基本信息</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Skill 标识" required>
                    <Input
                      disabled={Boolean(editingSkill)}
                      placeholder="structured-planning"
                      value={skillForm.name}
                      onChange={(event) => setSkillForm((prev) => ({ ...prev, name: event.target.value }))}
                      className={skillFormErrors.name ? 'border-destructive' : undefined}
                    />
                  </Field>
                  <Field label="显示名称" required>
                    <Input
                      placeholder="结构化任务规划"
                      value={skillForm.display_name}
                      onChange={(event) => setSkillForm((prev) => ({ ...prev, display_name: event.target.value }))}
                      className={skillFormErrors.display_name ? 'border-destructive' : undefined}
                    />
                  </Field>
                </div>
                <Field label="使用边界" required>
                  <Textarea
                    rows={3}
                    placeholder="适用场景、输入边界、需要交付的结果口径"
                    value={skillForm.description}
                    onChange={(event) => setSkillForm((prev) => ({ ...prev, description: event.target.value }))}
                    className={skillFormErrors.description ? 'border-destructive' : undefined}
                  />
                </Field>
                <Field label="状态">
                  <Select
                    value={skillForm.status}
                    onValueChange={(value) => setSkillForm((prev) => ({ ...prev, status: value as SkillFormState['status'] }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">启用</SelectItem>
                      <SelectItem value="inactive">停用</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Skill allowed tools</h3>
                <Field label="Skill allowed tools">
                  <ToolMultiSelect
                    value={skillForm.allowed_tools}
                    options={toolOptions}
                    onChange={(next) => setSkillForm((prev) => ({ ...prev, allowed_tools: next }))}
                  />
                </Field>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">执行规范</h3>
                <Field label="执行规范正文" required>
                  <Textarea
                    rows={12}
                    value={skillForm.instructions}
                    onChange={(event) => setSkillForm((prev) => ({ ...prev, instructions: event.target.value }))}
                    className={cn('font-mono', skillFormErrors.instructions && 'border-destructive')}
                  />
                </Field>
              </section>

              <Accordion type="single" collapsible>
                <AccordionItem value="metadata">
                  <AccordionTrigger>技术详情</AccordionTrigger>
                  <AccordionContent>
                    <Field label="Skill metadata JSON">
                      <Textarea
                        className="font-mono"
                        rows={5}
                        value={skillMetadataText}
                        onChange={(event) => setSkillMetadataText(event.target.value)}
                        placeholder='{"domain":"planning"}'
                      />
                    </Field>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button onClick={submitSkill} disabled={saveSkill.isPending}>保存 Skill</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={skillVersionOpen} onOpenChange={setSkillVersionOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[820px]">
          <SheetHeader>
            <SheetTitle>{versioningSkill ? `Skill 版本 · ${versioningSkill.display_name || versioningSkill.name}` : 'Skill 版本'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {versioningSkill && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button
                    disabled={publishSkill.isPending}
                    onClick={() => publishSkill.mutate(versioningSkill.id)}
                  >
                    记录当前版本
                  </Button>
                  <Button
                    variant="outline"
                    disabled={exportSkill.isPending}
                    onClick={() => exportSkill.mutate(versioningSkill.id)}
                  >
                    生成导出包
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[90px]">版本</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>Skill allowed tools</TableHead>
                      <TableHead className="w-[210px]">记录时间</TableHead>
                      <TableHead className="w-[160px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skillVersions.isLoading && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">加载中...</TableCell>
                      </TableRow>
                    )}
                    {!skillVersions.isLoading && (skillVersions.data || []).map((record) => (
                      <TableRow key={record.id}>
                        <TableCell><Badge variant="outline">v{record.version}</Badge></TableCell>
                        <TableCell>{record.display_name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            {(record.allowed_tools || []).map((item) => <Badge variant="muted" key={item}>{item}</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell>{new Date(record.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={diffSkillVersion.isPending}
                              onClick={() => diffSkillVersion.mutate({ id: versioningSkill.id, version: record.version })}
                            >
                              差异
                            </Button>
                            <Confirm
                              title={`恢复到 v${record.version}？当前内容会生成新的待记录版本。`}
                              danger={false}
                              onConfirm={() => restoreSkill.mutate({ id: versioningSkill.id, version: record.version })}
                            >
                              <Button size="sm" variant="outline" disabled={restoreSkill.isPending}>恢复</Button>
                            </Confirm>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!skillVersions.isLoading && !(skillVersions.data || []).length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">暂无版本记录</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {skillVersionDiff && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">与 v{skillVersionDiff.version} 的差异</h3>
                    {renderSkillChanges(skillVersionDiff.changes)}
                  </section>
                )}
                {skillExportText && (
                  <div className="space-y-2">
                    <strong className="text-sm font-semibold text-foreground">导出包已生成</strong>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="export">
                        <AccordionTrigger>查看导出包技术内容</AccordionTrigger>
                        <AccordionContent>
                          <Textarea className="font-mono" rows={10} value={skillExportText} onChange={(event) => setSkillExportText(event.target.value)} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                )}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(skillRuntimePreview)} onOpenChange={(open) => { if (!open) setSkillRuntimePreview(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-[820px]">
          <SheetHeader>
            <SheetTitle>{skillRuntimePreview ? `Skill Runtime Preview · ${skillRuntimePreview.name}` : 'Skill Runtime Preview'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {skillRuntimePreview && (
              <div className="space-y-5">
                {skillRuntimePreview.warnings.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {skillRuntimePreview.warnings.map((item) => <Badge variant="warning" key={item}>{item}</Badge>)}
                  </div>
                )}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Skill allowed tools</h3>
                  {renderRuntimeResources(skillRuntimePreview.allowed_tools)}
                  {(skillRuntimePreview.missing_tools.length > 0 || skillRuntimePreview.inactive_tools.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {skillRuntimePreview.missing_tools.map((item) => <Badge variant="destructive" key={`missing-${item}`}>缺失: {item}</Badge>)}
                      {skillRuntimePreview.inactive_tools.map((item) => <Badge variant="warning" key={`inactive-${item}`}>未启用: {item}</Badge>)}
                    </div>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">运行配置检查</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">Skill allowed tools</span>
                      <strong className="text-base text-foreground">{skillRuntimePreview.allowed_tools.length}</strong>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">缺失 Tools</span>
                      <strong className="text-base text-foreground">{skillRuntimePreview.missing_tools.length}</strong>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">未启用 Tools</span>
                      <strong className="text-base text-foreground">{skillRuntimePreview.inactive_tools.length}</strong>
                    </div>
                  </div>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="runtime">
                      <AccordionTrigger>执行规范原文</AccordionTrigger>
                      <AccordionContent>
                        <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">{skillRuntimePreview.markdown}</pre>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </section>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(skillImpact)} onOpenChange={(open) => { if (!open) setSkillImpact(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-[720px]">
          <SheetHeader>
            <SheetTitle>{skillImpact ? `Skill 影响分析 · ${skillImpact.skill_name}` : 'Skill 影响分析'}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {skillImpact && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border bg-muted/30 p-2.5">
                    <span className="block text-xs text-muted-foreground">绑定 Agent</span>
                    <strong className="text-base text-foreground">{skillImpact.total_agents}</strong>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2.5">
                    <span className="block text-xs text-muted-foreground">线上引用</span>
                    <strong className="text-base text-foreground">{skillImpact.published_agents}</strong>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="w-[110px]">状态</TableHead>
                      <TableHead className="w-[170px]">绑定位置</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skillImpact.bindings.map((record) => (
                      <TableRow key={`${record.agent_id}-${record.binding}-${record.subagent_name || 'main'}`}>
                        <TableCell>{record.agent_name}</TableCell>
                        <TableCell>
                          <Badge variant={record.agent_status === 'published' ? 'success' : record.agent_status === 'inactive' ? 'muted' : 'info'}>
                            {agentStatusLabel(record.agent_status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{record.binding === 'main' ? '主流程' : `协作角色 · ${record.subagent_name || '-'}`}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {skillImpact.bindings.length === 0 && <div className="py-3 text-center text-sm text-muted-foreground">当前没有 Agent 绑定这个 Skill。</div>}
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={skillImportOpen} onOpenChange={setSkillImportOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[760px]">
          <SheetHeader>
            <SheetTitle>导入 Skill</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="覆盖同名 Skill">
                  <Switch
                    checked={importOpts.overwrite}
                    onCheckedChange={(checked) => setImportOpts((prev) => ({ ...prev, overwrite: checked }))}
                  />
                </Field>
                <Field label="保留原 ID">
                  <Switch
                    checked={importOpts.preserve_id}
                    onCheckedChange={(checked) => setImportOpts((prev) => ({ ...prev, preserve_id: checked }))}
                  />
                </Field>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <strong className="block text-sm font-semibold text-foreground">导入包</strong>
                <span className="text-xs text-muted-foreground">粘贴从版本面板导出的 Skill；导入后会恢复当前内容和历史版本清单。</span>
              </div>
              <Accordion type="single" collapsible>
                <AccordionItem value="package">
                  <AccordionTrigger>查看或编辑导入包 JSON</AccordionTrigger>
                  <AccordionContent>
                    <Field label="Skill 导入原文">
                      <Textarea
                        className="font-mono"
                        rows={12}
                        value={skillImportText}
                        onChange={(event) => setSkillImportText(event.target.value)}
                      />
                    </Field>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => previewSkillImport.mutate(importOpts)} disabled={previewSkillImport.isPending}>
                  导入检查
                </Button>
                <Button onClick={() => importSkill.mutate(importOpts)} disabled={importSkill.isPending}>导入 Skill</Button>
              </div>
              {skillImportPreview && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">导入检查 · {skillImportPreview.name}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">处理方式</span>
                      <strong className="text-sm text-foreground">{skillImportPreview.action === 'overwrite' ? '覆盖同名 Skill' : '创建新 Skill'}</strong>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">导入版本</span>
                      <strong className="text-sm text-foreground">v{skillImportPreview.incoming_version}</strong>
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2.5">
                      <span className="block text-xs text-muted-foreground">历史版本</span>
                      <strong className="text-sm text-foreground">{skillImportPreview.imported_versions}</strong>
                    </div>
                  </div>
                  {skillImportPreview.warnings.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {skillImportPreview.warnings.map((item) => <Badge variant="warning" key={item}>{item}</Badge>)}
                    </div>
                  )}
                  {(skillImportPreview.missing_tools.length > 0 || skillImportPreview.inactive_tools.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {skillImportPreview.missing_tools.map((item) => <Badge variant="destructive" key={`missing-${item}`}>缺失: {item}</Badge>)}
                      {skillImportPreview.inactive_tools.map((item) => <Badge variant="warning" key={`inactive-${item}`}>未启用: {item}</Badge>)}
                    </div>
                  )}
                  {renderSkillChanges(skillImportPreview.changes)}
                </section>
              )}
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确定删除该 Skill？</DialogTitle>
            <DialogDescription>
              仍被 Agent、上线版本或存量运行引用时会被后端拒绝；请先在 Agent 中显式解绑。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={confirmDeleteSkill}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
