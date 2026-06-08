import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, KeyRound, Plus, RefreshCw, Settings, ShieldCheck, Users } from 'lucide-react';
import { EntityCell, PageSurface, StatusTag, TableToolbar, WorkspaceIssueList, WorkspaceMetricGrid, WorkspacePage } from '../components/ui';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@/components/ui/sheet';
import { Confirm } from '@/components/ui/confirm';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Field, SectionCard } from '@/components/layout';
import { toast } from '@/lib/toast';
import { api } from '../services/api';
import { productTerms } from '../services/productLanguage';
import { workspaceApi } from '../services/workspaceApi';
import type { ApiToken, OrganizationApiToken, OrganizationMemberUser, OrganizationRole, PlatformReadinessCheck } from '../types/domain';

const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const roleMeta: Record<OrganizationRole, { label: string; description: string }> = {
  owner: { label: '所有者', description: '组织、成员与关键策略最高权限' },
  admin: { label: '管理员', description: '成员治理、密钥和运维策略' },
  editor: { label: '编辑者', description: `Agent、${productTerms.action}、${productTerms.capabilityPackage}配置写入` },
  viewer: { label: '观察者', description: '只读查看运行、配置和审计' },
};

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatLastUsed(value?: string | null) {
  return value ? formatDate(value) : '从未使用';
}

function formatRevokedBy(record: OrganizationApiToken) {
  if (record.status !== 'revoked') return '-';
  return record.revoked_by_display_name || record.revoked_by_email || record.revoked_by || '-';
}

function formatExpiresAt(value?: string | null) {
  return value ? formatDate(value) : <Badge variant="warning">永不过期</Badge>;
}

function shortTokenId(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function RoleTag({ role }: { role: OrganizationRole }) {
  const meta = roleMeta[role];
  const variantMap: Record<OrganizationRole, 'warning' | 'info' | 'default' | 'muted'> = {
    owner: 'warning',
    admin: 'info',
    editor: 'default',
    viewer: 'muted',
  };
  return <Badge variant={variantMap[role]}>{meta.label}</Badge>;
}

function ReadinessStatusBadge({ record }: { record: PlatformReadinessCheck }) {
  if (record.ready) return <Badge variant="success">通过</Badge>;
  return (
    <Badge variant={record.severity === 'blocker' ? 'destructive' : 'warning'}>
      {record.severity === 'blocker' ? '未通过' : productTerms.riskNotice}
    </Badge>
  );
}

function readinessSeverityLabel(value: PlatformReadinessCheck['severity']) {
  if (value === 'blocker') return '未通过';
  if (value === 'warning') return productTerms.riskNotice;
  return '信息';
}

function activeOwners(members: OrganizationMemberUser[]) {
  return members.filter((item) => item.role === 'owner' && item.status === 'active').length;
}

function isExpired(value?: string | null) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

export default function SystemAdminPage() {
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [passwordResetMember, setPasswordResetMember] = useState<OrganizationMemberUser | null>(null);
  const [tokenDrawerOpen, setTokenDrawerOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string>('');

  // Controlled form state — member create
  const [memberEmail, setMemberEmail] = useState('');
  const [memberDisplayName, setMemberDisplayName] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberRole, setMemberRole] = useState<OrganizationRole>('viewer');
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});

  // Controlled form state — password reset
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  // Controlled form state — token create
  const [tokenName, setTokenName] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState('');
  const [tokenErrors, setTokenErrors] = useState<Record<string, string>>({});

  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const workspace = useQuery({ queryKey: ['workspace', 'operations', 'access-control'], queryFn: workspaceApi.operations, enabled: true });
  const currentRole = me.data?.membership.role || 'viewer';
  const canManageMembers = roleRank[currentRole] >= roleRank.admin;
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: api.listApiTokens });
  const readiness = useQuery({
    queryKey: ['platform-readiness'],
    queryFn: api.readiness,
    enabled: canManageMembers,
    refetchInterval: canManageMembers ? 30000 : false,
  });
  const organizationTokens = useQuery({
    queryKey: ['organization-api-tokens'],
    queryFn: api.listOrganizationApiTokens,
    enabled: canManageMembers,
  });
  const members = useQuery({
    queryKey: ['organization-members'],
    queryFn: api.listOrganizationMembers,
    enabled: canManageMembers,
  });
  const ownerCount = activeOwners(members.data || []);
  const memberRows = members.data || [];
  const organizationTokenRows = organizationTokens.data || [];
  const personalTokenRows = tokens.data || [];
  const activeMembers = memberRows.filter((item) => item.status === 'active').length;
  const disabledMembers = memberRows.filter((item) => item.status !== 'active').length;
  const activeOrganizationTokens = organizationTokenRows.filter((item) => item.status === 'active').length;
  const neverExpiringOrganizationTokens = organizationTokenRows.filter((item) => item.status === 'active' && !item.expires_at).length;
  const expiredOrganizationTokens = organizationTokenRows.filter((item) => item.status === 'active' && isExpired(item.expires_at)).length;
  const readinessChecks = readiness.data?.checks || [];
  const readinessBlockers = readinessChecks.filter((item) => !item.ready && item.severity === 'blocker');
  const readinessWarnings = readinessChecks.filter((item) => !item.ready && item.severity === 'warning');
  const readinessIssues = readinessBlockers.length + readinessWarnings.length;
  const organizationName = me.data?.organization.name || '-';
  const currentRoleLabel = currentRole ? roleMeta[currentRole].label : '-';
  const readinessLabel = !canManageMembers
    ? '仅管理员'
    : readiness.data?.status === 'ready' ? '就绪' : readiness.data?.status === 'degraded' ? '降级' : readiness.data?.status === 'blocked' ? '未通过' : '-';
  const readinessTone = !canManageMembers ? 'readonly' : readiness.data?.status === 'ready' ? 'ready' : readiness.data?.status === 'blocked' ? 'blocked' : 'warning';

  const refreshGovernance = () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    queryClient.invalidateQueries({ queryKey: ['organization-members'] });
    queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    queryClient.invalidateQueries({ queryKey: ['platform-readiness'] });
  };

  const updateMember = useMutation({
    mutationFn: ({ id, role, status }: { id: string; role?: OrganizationRole; status?: 'active' | 'disabled' }) =>
      api.updateOrganizationMember(id, { role, status }),
    onSuccess: () => {
      toast.success('成员权限已更新');
      refreshGovernance();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '成员权限更新失败');
    },
  });

  const createMember = useMutation({
    mutationFn: (values: { email: string; display_name: string; password: string; role: OrganizationRole }) =>
      api.createOrganizationMember(values),
    onSuccess: () => {
      toast.success('成员已创建');
      setMemberEmail('');
      setMemberDisplayName('');
      setMemberPassword('');
      setMemberRole('viewer');
      setMemberErrors({});
      setMemberDrawerOpen(false);
      refreshGovernance();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '成员创建失败');
    },
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.resetOrganizationMemberPassword(id, { password }),
    onSuccess: () => {
      toast.success('成员密码已重置');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordErrors({});
      setPasswordResetMember(null);
      refreshGovernance();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '密码重置失败');
    },
  });

  const revokeToken = useMutation({
    mutationFn: (id: string) => api.revokeApiToken(id),
    onSuccess: () => {
      toast.success('访问令牌已撤销');
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '令牌撤销失败');
    },
  });

  const revokeOrganizationToken = useMutation({
    mutationFn: (id: string) => api.revokeOrganizationApiToken(id),
    onSuccess: () => {
      toast.success('组织访问令牌已撤销');
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '组织令牌撤销失败');
    },
  });

  const createToken = useMutation({
    mutationFn: (values: { name: string; expires_at?: string }) =>
      api.createApiToken({ name: values.name, expires_at: values.expires_at || null }),
    onSuccess: (result) => {
      toast.success('访问令牌已创建');
      setCreatedToken(result.token);
      setTokenName('');
      setTokenExpiresAt('');
      setTokenErrors({});
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '令牌创建失败');
    },
  });

  const copyCreatedToken = async () => {
    try {
      await navigator.clipboard.writeText(createdToken);
      toast.success('令牌已复制');
    } catch {
      toast.warning('无法自动复制，请手动选中令牌');
    }
  };

  const roleOptions = useMemo(
    () => (Object.keys(roleMeta) as OrganizationRole[]).map((role) => ({
      value: role,
      label: `${roleMeta[role].label} - ${roleMeta[role].description}`,
      disabled: role === 'owner' && currentRole !== 'owner',
    })),
    [currentRole],
  );

  const createRoleOptions = useMemo(
    () => roleOptions.filter((item) => !item.disabled),
    [roleOptions],
  );

  // Handlers for form submissions
  function handleCreateMember(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!memberEmail) errors.email = '请输入邮箱';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) errors.email = '邮箱格式不正确';
    if (!memberDisplayName) errors.display_name = '请输入姓名';
    if (!memberPassword) errors.password = '请输入初始密码';
    else if (memberPassword.length < 8) errors.password = '至少 8 个字符';
    if (!memberRole) errors.role = '请选择角色';
    if (Object.keys(errors).length > 0) {
      setMemberErrors(errors);
      return;
    }
    setMemberErrors({});
    createMember.mutate({ email: memberEmail, display_name: memberDisplayName, password: memberPassword, role: memberRole });
  }

  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordResetMember) return;
    const errors: Record<string, string> = {};
    if (!newPassword) errors.password = '请输入新密码';
    else if (newPassword.length < 8) errors.password = '至少 8 个字符';
    if (!confirmPassword) errors.confirm_password = '请再次输入新密码';
    else if (newPassword !== confirmPassword) errors.confirm_password = '两次输入的密码不一致';
    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }
    setPasswordErrors({});
    resetPassword.mutate({ id: passwordResetMember.id, password: newPassword });
  }

  function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!tokenName) errors.name = '请输入令牌名称';
    if (Object.keys(errors).length > 0) {
      setTokenErrors(errors);
      return;
    }
    setTokenErrors({});
    createToken.mutate({ name: tokenName, expires_at: tokenExpiresAt || undefined });
  }

  const readinessBadgeVariant =
    !canManageMembers ? 'muted' :
    readiness.data?.status === 'ready' ? 'success' :
    readiness.data?.status === 'blocked' ? 'destructive' : 'warning';

  return (
    <WorkspacePage
      icon={<Settings size={14} />}
      eyebrow="治理"
      title="访问控制"
      description="管理成员、角色、访问令牌与外部系统调用 Agent 的权限边界。"
      actions={
        <Button variant="outline" size="sm" onClick={refreshGovernance}>
          <RefreshCw size={15} />
          刷新
        </Button>
      }
    >
      {/* Workspace summary */}
      <SectionCard title="访问与接入状态" description="访问控制与运维视图共用后端 workspace read model，统一呈现成员、令牌和平台风险。">
        <div className="space-y-4">
          <WorkspaceMetricGrid items={workspace.data?.metrics || []} />
          <WorkspaceIssueList items={workspace.data?.issues || []} emptyLabel="当前没有平台级治理未通过项。" />
        </div>
      </SectionCard>

      {/* Command center summary */}
      <div className="rounded-xl border border-border bg-card p-5" aria-label="组织治理总览">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <Badge variant={readinessTone === 'ready' ? 'success' : readinessTone === 'blocked' ? 'destructive' : readinessTone === 'readonly' ? 'muted' : 'warning'} className="w-fit">
              {canManageMembers ? readinessLabel : '只读视图'}
            </Badge>
            <div>
              <h2 className="text-base font-semibold text-foreground">组织访问控制台</h2>
              <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <strong className="text-foreground">{organizationName}</strong>
                <span>当前角色 {currentRoleLabel}</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canManageMembers}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-readiness'] })}
              >
                <RefreshCw size={15} />
                重新检查
              </Button>
              {canManageMembers && (
                <Button size="sm" onClick={() => setMemberDrawerOpen(true)}>
                  <Plus size={15} />
                  新建成员
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="text-xs text-muted-foreground">组织</span>
              <strong className="text-sm font-semibold text-foreground">{organizationName}</strong>
              <em className="text-xs not-italic text-muted-foreground">{currentRoleLabel}</em>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="text-xs text-muted-foreground">成员</span>
              <strong className="text-sm font-semibold text-foreground">{canManageMembers ? memberRows.length : '-'}</strong>
              <em className="text-xs not-italic text-muted-foreground">{canManageMembers ? `${activeMembers} 启用 / ${disabledMembers} 停用` : '需管理员权限'}</em>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="text-xs text-muted-foreground">{canManageMembers ? '组织令牌' : '我的令牌'}</span>
              <strong className="text-sm font-semibold text-foreground">{canManageMembers ? activeOrganizationTokens : personalTokenRows.length}</strong>
              <em className="text-xs not-italic text-muted-foreground">{canManageMembers ? `${neverExpiringOrganizationTokens} 永不过期` : '当前账号名下'}</em>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="text-xs text-muted-foreground">就绪未通过</span>
              <strong className="text-sm font-semibold text-foreground">{canManageMembers ? readinessBlockers.length : '-'}</strong>
              <em className="text-xs not-italic text-muted-foreground">{canManageMembers ? `${readinessIssues} 个待处理项` : '需管理员权限'}</em>
            </div>
          </div>
        </div>
      </div>

      {/* Governance grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PageSurface title="成员与角色" description="所有者冗余、成员启停和当前管理权限。">
          <div className="space-y-2">
            <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${ownerCount >= 2 ? 'bg-success/8 text-success' : 'bg-warning/8 text-warning'}`}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">所有者冗余</strong>
                <span className="text-xs text-muted-foreground">{ownerCount >= 2 ? `${ownerCount} 个所有者，具备交接冗余` : `${ownerCount} 个所有者，建议至少保留 2 个`}</span>
              </div>
            </div>
            <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${activeMembers ? 'bg-success/8 text-success' : 'bg-warning/8 text-warning'}`}>
              <Users size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">可用成员</strong>
                <span className="text-xs text-muted-foreground">{activeMembers} 个启用成员，{disabledMembers} 个停用成员</span>
              </div>
            </div>
            <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${canManageMembers ? 'bg-success/8 text-success' : 'bg-muted/40 text-muted-foreground'}`}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">当前权限</strong>
                <span className="text-xs text-muted-foreground">{roleMeta[currentRole].description}</span>
              </div>
            </div>
          </div>
        </PageSurface>
        <PageSurface title="访问令牌" description="组织令牌有效期、失效状态和撤销边界。">
          <div className="space-y-2">
            <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${neverExpiringOrganizationTokens ? 'bg-warning/8 text-warning' : 'bg-success/8 text-success'}`}>
              <KeyRound size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">永不过期令牌</strong>
                <span className="text-xs text-muted-foreground">{canManageMembers ? `${neverExpiringOrganizationTokens} 个组织令牌未设置过期时间` : '管理员可查看组织级风险'}</span>
              </div>
            </div>
            <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${expiredOrganizationTokens ? 'bg-warning/8 text-warning' : 'bg-success/8 text-success'}`}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">疑似失效</strong>
                <span className="text-xs text-muted-foreground">{canManageMembers ? `${expiredOrganizationTokens} 个活跃令牌已超过过期时间` : `${personalTokenRows.length} 个个人令牌`}</span>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-muted-foreground">
              <KeyRound size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong className="block text-sm font-medium">完整令牌</strong>
                <span className="text-xs text-muted-foreground">只在创建时展示一次，后续只能撤销后重建。</span>
              </div>
            </div>
          </div>
        </PageSurface>
      </div>

      {/* Platform readiness table */}
      <PageSurface>
        <TableToolbar
          title="平台就绪检查"
          description="生产交付前的关键配置检查；检查依据仅管理员可见。"
          actions={
            <div className="flex items-center gap-2">
              <Badge variant={readinessBadgeVariant}>{readinessLabel}</Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={!canManageMembers}
                title={canManageMembers ? '重新检查' : '需管理员权限'}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-readiness'] })}
              >
                <RefreshCw size={15} />
                重新检查
              </Button>
            </div>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">检查项</TableHead>
              <TableHead className="w-[110px]">状态</TableHead>
              <TableHead className="w-[100px]">级别</TableHead>
              <TableHead className="w-[320px]">说明</TableHead>
              <TableHead>依据</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {readiness.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : (canManageMembers ? readiness.data?.checks || [] : []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {canManageMembers ? '暂无就绪检查结果' : '当前角色无权查看部署检查依据'}
                </TableCell>
              </TableRow>
            ) : (
              (canManageMembers ? readiness.data?.checks || [] : []).map((record) => (
                <TableRow key={record.key}>
                  <TableCell>
                    <EntityCell
                      icon={<ShieldCheck size={18} />}
                      title={record.label}
                      subtitle={record.key}
                    />
                  </TableCell>
                  <TableCell>
                    <ReadinessStatusBadge record={record} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={record.severity === 'blocker' ? 'destructive' : record.severity === 'warning' ? 'warning' : 'muted'}>
                      {readinessSeverityLabel(record.severity)}
                    </Badge>
                  </TableCell>
                  <TableCell>{record.detail}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{JSON.stringify(record.evidence)}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PageSurface>

      {/* Members table */}
      <PageSurface>
        <TableToolbar
          title="成员与角色"
          description="管理员可调整编辑者和观察者；所有者角色只能由所有者授予或撤销。"
          actions={
            <div className="flex items-center gap-2">
              <Badge variant={canManageMembers ? 'success' : 'muted'}>{canManageMembers ? '可管理' : '只读'}</Badge>
              {canManageMembers && (
                <Button size="sm" onClick={() => setMemberDrawerOpen(true)}>
                  <Plus size={15} />
                  新建成员
                </Button>
              )}
            </div>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">成员</TableHead>
              <TableHead className="w-[150px]">角色</TableHead>
              <TableHead className="w-[120px]">成员状态</TableHead>
              <TableHead className="w-[120px]">账号状态</TableHead>
              <TableHead className="w-[190px]">最近登录</TableHead>
              <TableHead className="w-[190px]">加入时间</TableHead>
              <TableHead className="w-[310px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : memberRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  暂无成员
                </TableCell>
              </TableRow>
            ) : (
              memberRows.map((record) => {
                const isSelf = record.user_id === me.data?.user.id;
                const isLastActiveOwner = record.role === 'owner' && record.status === 'active' && ownerCount <= 1;
                const canEditOwner = currentRole === 'owner';
                const roleDisabled = !canManageMembers || isSelf || (record.role === 'owner' && !canEditOwner) || isLastActiveOwner;
                const statusDisabled = !canManageMembers || isSelf || isLastActiveOwner || (record.role === 'owner' && !canEditOwner);
                const passwordDisabled = !canManageMembers || isSelf || (record.role === 'owner' && !canEditOwner);
                return (
                  <TableRow key={record.id}>
                    <TableCell>
                      <EntityCell
                        icon={<Users size={18} />}
                        title={record.user_display_name || record.user_email}
                        subtitle={record.user_email}
                      />
                    </TableCell>
                    <TableCell>
                      <RoleTag role={record.role} />
                    </TableCell>
                    <TableCell>
                      <StatusTag status={record.status} />
                    </TableCell>
                    <TableCell>
                      <StatusTag status={record.user_status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(record.user_last_login_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(record.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={record.role}
                          disabled={roleDisabled}
                          onValueChange={(role) => updateMember.mutate({ id: record.id, role: role as OrganizationRole })}
                        >
                          <SelectTrigger className="h-8 w-[124px] text-xs" disabled={roleDisabled}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {record.status === 'active' ? (
                          <Confirm
                            title="停用该成员？"
                            description="停用后该成员在当前组织下的访问令牌会立即撤销。"
                            disabled={statusDisabled}
                            onConfirm={() => updateMember.mutate({ id: record.id, status: 'disabled' })}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={statusDisabled}
                            >
                              {updateMember.isPending ? <Spinner className="size-3" /> : null}
                              停用
                            </Button>
                          </Confirm>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!canManageMembers || (record.role === 'owner' && !canEditOwner)}
                            onClick={() => updateMember.mutate({ id: record.id, status: 'active' })}
                          >
                            {updateMember.isPending ? <Spinner className="size-3" /> : null}
                            启用
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={passwordDisabled}
                          onClick={() => {
                            setNewPassword('');
                            setConfirmPassword('');
                            setPasswordErrors({});
                            setPasswordResetMember(record);
                          }}
                        >
                          重置密码
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </PageSurface>

      {/* Organization tokens table */}
      <PageSurface>
        <TableToolbar
          title="组织访问令牌"
          description="管理员可查看组织内个人 API Token 的归属、有效期和最近使用情况；完整令牌仅在创建时显示一次。"
          actions={
            <Badge variant={canManageMembers ? 'success' : 'muted'}>{canManageMembers ? '管理员可见' : '无管理权限'}</Badge>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">令牌</TableHead>
              <TableHead className="w-[280px]">归属成员</TableHead>
              <TableHead className="w-[120px]">状态</TableHead>
              <TableHead className="w-[120px]">账号状态</TableHead>
              <TableHead className="w-[190px]">过期时间</TableHead>
              <TableHead className="w-[190px]">最后使用</TableHead>
              <TableHead className="w-[190px]">创建时间</TableHead>
              <TableHead className="w-[190px]">撤销时间</TableHead>
              <TableHead className="w-[180px]">撤销人</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizationTokens.isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : (canManageMembers ? organizationTokenRows : []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  {canManageMembers ? '暂无组织访问令牌' : '当前角色只能查看个人访问令牌'}
                </TableCell>
              </TableRow>
            ) : (
              (canManageMembers ? organizationTokenRows : []).map((record) => {
                const isOwnerToken = record.user_role === 'owner';
                const disabled = record.status !== 'active' || (isOwnerToken && currentRole !== 'owner');
                return (
                  <TableRow key={record.id}>
                    <TableCell>
                      <EntityCell
                        icon={<KeyRound size={18} />}
                        title={record.name}
                        subtitle={`ID ${shortTokenId(record.id)}`}
                      />
                    </TableCell>
                    <TableCell>
                      <EntityCell
                        icon={<Users size={18} />}
                        title={record.user_display_name || record.user_email}
                        subtitle={
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span>{record.user_email}</span>
                            {record.user_role && <RoleTag role={record.user_role} />}
                          </span>
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <StatusTag status={record.status} />
                    </TableCell>
                    <TableCell>
                      <StatusTag status={record.user_status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatExpiresAt(record.expires_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatLastUsed(record.last_used_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(record.created_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(record.revoked_at)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatRevokedBy(record)}</TableCell>
                    <TableCell>
                      <Confirm
                        title="撤销组织访问令牌？"
                        description="撤销后依赖该令牌的自动化任务、CI 或外部集成会立即失效。"
                        disabled={disabled}
                        onConfirm={() => revokeOrganizationToken.mutate(record.id)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={disabled}
                        >
                          {revokeOrganizationToken.isPending ? <Spinner className="size-3" /> : null}
                          撤销
                        </Button>
                      </Confirm>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </PageSurface>

      {/* Personal tokens table */}
      <PageSurface
        title="我的访问令牌"
        description="令牌只展示当前账号名下记录；新令牌只在创建时显示一次。"
        actions={
          <Button size="sm" onClick={() => {
            setCreatedToken('');
            setTokenDrawerOpen(true);
          }}>
            <Plus size={15} />
            新建令牌
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[240px]">名称</TableHead>
              <TableHead className="w-[120px]">状态</TableHead>
              <TableHead className="w-[190px]">过期时间</TableHead>
              <TableHead className="w-[190px]">最后使用</TableHead>
              <TableHead className="w-[190px]">创建时间</TableHead>
              <TableHead className="w-[120px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  <Spinner className="mx-auto" />
                </TableCell>
              </TableRow>
            ) : personalTokenRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  暂无访问令牌
                </TableCell>
              </TableRow>
            ) : (
              personalTokenRows.map((record: ApiToken) => (
                <TableRow key={record.id}>
                  <TableCell className="text-sm font-medium text-foreground">{record.name}</TableCell>
                  <TableCell>
                    <StatusTag status={record.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(record.expires_at)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(record.last_used_at)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(record.created_at)}</TableCell>
                  <TableCell>
                    <Confirm
                      title="撤销该令牌？"
                      disabled={record.status !== 'active'}
                      onConfirm={() => revokeToken.mutate(record.id)}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={record.status !== 'active'}
                      >
                        {revokeToken.isPending ? <Spinner className="size-3" /> : null}
                        撤销
                      </Button>
                    </Confirm>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </PageSurface>

      {/* Create member drawer */}
      <Sheet open={memberDrawerOpen} onOpenChange={setMemberDrawerOpen}>
        <SheetContent side="right" className="w-[480px] max-w-full">
          <SheetHeader>
            <SheetTitle>新建本地成员</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <form id="create-member-form" onSubmit={handleCreateMember} className="space-y-4">
              <Field label="邮箱" required htmlFor="member-email" hint={memberErrors.email}>
                <Input
                  id="member-email"
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="off"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  className={memberErrors.email ? 'border-destructive' : ''}
                />
              </Field>
              <Field label="姓名" required htmlFor="member-display-name" hint={memberErrors.display_name}>
                <Input
                  id="member-display-name"
                  placeholder="成员姓名"
                  autoComplete="off"
                  value={memberDisplayName}
                  onChange={(e) => setMemberDisplayName(e.target.value)}
                  className={memberErrors.display_name ? 'border-destructive' : ''}
                />
              </Field>
              <Field label="初始密码" required htmlFor="member-password" hint={memberErrors.password}>
                <Input
                  id="member-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="至少 8 个字符"
                  value={memberPassword}
                  onChange={(e) => setMemberPassword(e.target.value)}
                  className={memberErrors.password ? 'border-destructive' : ''}
                />
              </Field>
              <Field label="角色" required htmlFor="member-role" hint={memberErrors.role}>
                <Select value={memberRole} onValueChange={(v) => setMemberRole(v as OrganizationRole)}>
                  <SelectTrigger id="member-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {createRoleOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </form>
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setMemberDrawerOpen(false)}>取消</Button>
            <Button type="submit" form="create-member-form" disabled={createMember.isPending}>
              {createMember.isPending ? <Spinner className="size-4" /> : null}
              创建成员
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Reset password drawer */}
      <Sheet open={Boolean(passwordResetMember)} onOpenChange={(open) => { if (!open) setPasswordResetMember(null); }}>
        <SheetContent side="right" className="w-[420px] max-w-full">
          <SheetHeader>
            <SheetTitle>重置成员密码</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {passwordResetMember && (
              <form id="reset-password-form" onSubmit={handleResetPassword} className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                  <strong className="block font-medium text-foreground">{passwordResetMember.user_display_name || passwordResetMember.user_email}</strong>
                  <span className="text-muted-foreground">提交后该成员在当前组织下的既有访问令牌会立即撤销。</span>
                </div>
                <Field label="新密码" required htmlFor="new-password" hint={passwordErrors.password}>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="至少 8 个字符"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={passwordErrors.password ? 'border-destructive' : ''}
                  />
                </Field>
                <Field label="确认新密码" required htmlFor="confirm-password" hint={passwordErrors.confirm_password}>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="再次输入新密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={passwordErrors.confirm_password ? 'border-destructive' : ''}
                  />
                </Field>
              </form>
            )}
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setPasswordResetMember(null)}>取消</Button>
            <Button type="submit" form="reset-password-form" disabled={resetPassword.isPending}>
              {resetPassword.isPending ? <Spinner className="size-4" /> : null}
              重置密码
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Create token drawer */}
      <Sheet open={tokenDrawerOpen} onOpenChange={setTokenDrawerOpen}>
        <SheetContent side="right" className="w-[520px] max-w-full">
          <SheetHeader>
            <SheetTitle>新建访问令牌</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <form id="create-token-form" onSubmit={handleCreateToken} className="space-y-4">
              <Field label="名称" required htmlFor="token-name" hint={tokenErrors.name}>
                <Input
                  id="token-name"
                  placeholder="例如 本地调试 / CI 上线 / 运维脚本"
                  autoComplete="off"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className={tokenErrors.name ? 'border-destructive' : ''}
                />
              </Field>
              <Field label="过期时间" htmlFor="token-expires-at" hint="可选，ISO 时间，例如 2026-12-31T23:59:59+08:00">
                <Input
                  id="token-expires-at"
                  placeholder="可选，ISO 时间，例如 2026-12-31T23:59:59+08:00"
                  value={tokenExpiresAt}
                  onChange={(e) => setTokenExpiresAt(e.target.value)}
                />
              </Field>
            </form>

            {createdToken && (
              <div className="mt-4 space-y-3 rounded-lg border border-warning/40 bg-warning/8 p-4">
                <div>
                  <strong className="block text-sm font-medium text-foreground">令牌只显示一次</strong>
                  <span className="text-xs text-muted-foreground">关闭后无法再次查看完整令牌，请立即保存到安全位置。</span>
                </div>
                <Textarea value={createdToken} rows={3} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={copyCreatedToken}>
                  <Copy size={15} />
                  复制令牌
                </Button>
              </div>
            )}
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setTokenDrawerOpen(false)}>关闭</Button>
            <Button type="submit" form="create-token-form" disabled={createToken.isPending}>
              {createToken.isPending ? <Spinner className="size-4" /> : null}
              创建令牌
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </WorkspacePage>
  );
}
