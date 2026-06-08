import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { AlertTriangle, Copy, KeyRound, Plus, RefreshCw, Settings, ShieldCheck, Users } from 'lucide-react';
import { EntityCell, PageSurface, StatusTag, TableToolbar, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { productTerms } from '../services/productLanguage';
import type { ApiToken, OrganizationApiToken, OrganizationMemberUser, OrganizationRole, PlatformReadinessCheck } from '../types/domain';

const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

const roleMeta: Record<OrganizationRole, { label: string; color: string; description: string }> = {
  owner: { label: '所有者', color: 'gold', description: '组织、成员与关键策略最高权限' },
  admin: { label: '管理员', color: 'blue', description: '成员治理、密钥和运维策略' },
  editor: { label: '编辑者', color: 'processing', description: `Agent、${productTerms.action}、${productTerms.capabilityPackage}配置写入` },
  viewer: { label: '观察者', color: 'default', description: '只读查看运行、配置和审计' },
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
  return value ? formatDate(value) : <Tag color="warning">永不过期</Tag>;
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function roleTag(role: OrganizationRole) {
  const meta = roleMeta[role];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function readinessStatusTag(record: PlatformReadinessCheck) {
  if (record.ready) return <Tag color="success">通过</Tag>;
  return <Tag color={record.severity === 'blocker' ? 'error' : 'warning'}>{record.severity === 'blocker' ? '未通过' : productTerms.riskNotice}</Tag>;
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
  const [memberForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [tokenForm] = Form.useForm();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
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
      message.success('成员权限已更新');
      refreshGovernance();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '成员权限更新失败');
    },
  });

  const createMember = useMutation({
    mutationFn: (values: { email: string; display_name: string; password: string; role: OrganizationRole }) =>
      api.createOrganizationMember(values),
    onSuccess: () => {
      message.success('成员已创建');
      memberForm.resetFields();
      setMemberDrawerOpen(false);
      refreshGovernance();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '成员创建失败');
    },
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.resetOrganizationMemberPassword(id, { password }),
    onSuccess: () => {
      message.success('成员密码已重置');
      passwordForm.resetFields();
      setPasswordResetMember(null);
      refreshGovernance();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '密码重置失败');
    },
  });

  const revokeToken = useMutation({
    mutationFn: (id: string) => api.revokeApiToken(id),
    onSuccess: () => {
      message.success('访问令牌已撤销');
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '令牌撤销失败');
    },
  });

  const revokeOrganizationToken = useMutation({
    mutationFn: (id: string) => api.revokeOrganizationApiToken(id),
    onSuccess: () => {
      message.success('组织访问令牌已撤销');
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '组织令牌撤销失败');
    },
  });

  const createToken = useMutation({
    mutationFn: (values: { name: string; expires_at?: string }) =>
      api.createApiToken({ name: values.name, expires_at: values.expires_at || null }),
    onSuccess: (result) => {
      message.success('访问令牌已创建');
      setCreatedToken(result.token);
      tokenForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
      queryClient.invalidateQueries({ queryKey: ['organization-api-tokens'] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : '令牌创建失败');
    },
  });

  const copyCreatedToken = async () => {
    try {
      await navigator.clipboard.writeText(createdToken);
      message.success('令牌已复制');
    } catch {
      message.warning('无法自动复制，请手动选中令牌');
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

  return (
    <WorkspacePage
      icon={<Settings size={14} />}
      eyebrow="组织与权限"
      title="组织与权限"
      description="管理成员、角色、访问令牌与平台就绪状态。"
      actions={
        <Button icon={<RefreshCw size={15} />} onClick={refreshGovernance}>
          刷新
        </Button>
      }
    >
      <section className="admin-command-center" aria-label="组织治理总览">
        <div className="admin-command-copy">
          <span className={`admin-status-badge ${readinessTone}`}>
            {canManageMembers ? readinessLabel : '只读视图'}
          </span>
          <h2>组织访问控制台</h2>
          <p className="admin-command-context">
            <strong>{organizationName}</strong>
            <span>当前角色 {currentRoleLabel}</span>
          </p>
          <div className="admin-command-actions">
            <Button
              icon={<RefreshCw size={15} />}
              disabled={!canManageMembers}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-readiness'] })}
            >
              重新检查
            </Button>
            {canManageMembers && (
              <Button type="primary" icon={<Plus size={15} />} onClick={() => setMemberDrawerOpen(true)}>
                新建成员
              </Button>
            )}
          </div>
        </div>
        <div className="admin-ledger">
          <div>
            <span>组织</span>
            <strong>{organizationName}</strong>
            <em>{currentRoleLabel}</em>
          </div>
          <div>
            <span>成员</span>
            <strong>{canManageMembers ? memberRows.length : '-'}</strong>
            <em>{canManageMembers ? `${activeMembers} 启用 / ${disabledMembers} 停用` : '需管理员权限'}</em>
          </div>
          <div>
            <span>{canManageMembers ? '组织令牌' : '我的令牌'}</span>
            <strong>{canManageMembers ? activeOrganizationTokens : personalTokenRows.length}</strong>
            <em>{canManageMembers ? `${neverExpiringOrganizationTokens} 永不过期` : '当前账号名下'}</em>
          </div>
          <div>
            <span>就绪未通过</span>
            <strong>{canManageMembers ? readinessBlockers.length : '-'}</strong>
            <em>{canManageMembers ? `${readinessIssues} 个待处理项` : '需管理员权限'}</em>
          </div>
        </div>
      </section>

      <div className="admin-governance-grid">
        <PageSurface
          className="admin-governance-surface"
          title="成员与角色"
          description="所有者冗余、成员启停和当前管理权限。"
        >
          <div className="admin-risk-list">
            <div className={ownerCount >= 2 ? 'resolved' : 'attention'}>
              <ShieldCheck size={16} />
              <strong>所有者冗余</strong>
              <span>{ownerCount >= 2 ? `${ownerCount} 个所有者，具备交接冗余` : `${ownerCount} 个所有者，建议至少保留 2 个`}</span>
            </div>
            <div className={activeMembers ? 'resolved' : 'attention'}>
              <Users size={16} />
              <strong>可用成员</strong>
              <span>{activeMembers} 个启用成员，{disabledMembers} 个停用成员</span>
            </div>
            <div className={canManageMembers ? 'resolved' : 'readonly'}>
              <ShieldCheck size={16} />
              <strong>当前权限</strong>
              <span>{roleMeta[currentRole].description}</span>
            </div>
          </div>
        </PageSurface>
        <PageSurface
          className="admin-governance-surface"
          title="访问令牌"
          description="组织令牌有效期、失效状态和撤销边界。"
        >
          <div className="admin-risk-list">
            <div className={neverExpiringOrganizationTokens ? 'attention' : 'resolved'}>
              <KeyRound size={16} />
              <strong>永不过期令牌</strong>
              <span>{canManageMembers ? `${neverExpiringOrganizationTokens} 个组织令牌未设置过期时间` : '管理员可查看组织级风险'}</span>
            </div>
            <div className={expiredOrganizationTokens ? 'attention' : 'resolved'}>
              <AlertTriangle size={16} />
              <strong>疑似失效</strong>
              <span>{canManageMembers ? `${expiredOrganizationTokens} 个活跃令牌已超过过期时间` : `${personalTokenRows.length} 个个人令牌`}</span>
            </div>
            <div className="readonly">
              <KeyRound size={16} />
              <strong>完整令牌</strong>
              <span>只在创建时展示一次，后续只能撤销后重建。</span>
            </div>
          </div>
        </PageSurface>
      </div>

      <PageSurface className="table-surface admin-table-surface">
        <TableToolbar
          title="平台就绪检查"
          description="生产交付前的关键配置检查；检查依据仅管理员可见。"
          actions={
            <Space>
              <Tag color={!canManageMembers ? 'default' : readiness.data?.status === 'ready' ? 'success' : readiness.data?.status === 'blocked' ? 'error' : 'warning'}>
                {readinessLabel}
              </Tag>
              <Button
                icon={<RefreshCw size={15} />}
                disabled={!canManageMembers}
                title={canManageMembers ? '重新检查' : '需管理员权限'}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['platform-readiness'] })}
              >
                重新检查
              </Button>
            </Space>
          }
        />
        <Table
          rowKey="key"
          size="small"
          loading={readiness.isLoading}
          dataSource={canManageMembers ? readiness.data?.checks || [] : []}
          locale={{ emptyText: canManageMembers ? '暂无就绪检查结果' : '当前角色无权查看部署检查依据' }}
          pagination={false}
          scroll={{ x: 960 }}
          columns={[
            {
              title: '检查项',
              dataIndex: 'label',
              width: 220,
              render: (_, record: PlatformReadinessCheck) => (
                <EntityCell
                  icon={<ShieldCheck size={18} />}
                  title={record.label}
                  subtitle={record.key}
                />
              ),
            },
            {
              title: '状态',
              width: 110,
              render: (_, record: PlatformReadinessCheck) => readinessStatusTag(record),
            },
            {
              title: '级别',
              dataIndex: 'severity',
              width: 100,
              render: (value: PlatformReadinessCheck['severity']) => (
                <Tag color={value === 'blocker' ? 'error' : value === 'warning' ? 'warning' : 'default'}>
                  {readinessSeverityLabel(value)}
                </Tag>
              ),
            },
            {
              title: '说明',
              dataIndex: 'detail',
              width: 320,
            },
            {
              title: '依据',
              dataIndex: 'evidence',
              render: (value: PlatformReadinessCheck['evidence']) => (
                <span className="readiness-evidence">{JSON.stringify(value)}</span>
              ),
            },
          ]}
        />
      </PageSurface>

      <PageSurface className="table-surface admin-table-surface">
        <TableToolbar
          title="成员与角色"
          description="管理员可调整编辑者和观察者；所有者角色只能由所有者授予或撤销。"
          actions={
            <Space>
              <Tag color={canManageMembers ? 'success' : 'default'}>{canManageMembers ? '可管理' : '只读'}</Tag>
              {canManageMembers && (
                <Button type="primary" icon={<Plus size={15} />} onClick={() => setMemberDrawerOpen(true)}>
                  新建成员
                </Button>
              )}
            </Space>
          }
        />
        <Table
          rowKey="id"
          loading={members.isLoading}
          dataSource={members.data || []}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            {
              title: '成员',
              dataIndex: 'user_display_name',
              width: 260,
              render: (_, record: OrganizationMemberUser) => (
                <EntityCell
                  icon={<Users size={18} />}
                  title={record.user_display_name || record.user_email}
                  subtitle={record.user_email}
                />
              ),
            },
            {
              title: '角色',
              dataIndex: 'role',
              width: 150,
              render: (value: OrganizationRole) => roleTag(value),
              filters: (Object.keys(roleMeta) as OrganizationRole[]).map((role) => ({ text: roleMeta[role].label, value: role })),
              onFilter: (value, record) => record.role === value,
            },
            {
              title: '成员状态',
              dataIndex: 'status',
              width: 120,
              render: (value) => <StatusTag status={value} />,
              filters: [
                { text: '启用', value: 'active' },
                { text: '停用', value: 'disabled' },
              ],
              onFilter: (value, record) => record.status === value,
            },
            { title: '账号状态', dataIndex: 'user_status', width: 120, render: (value) => <StatusTag status={value} /> },
            { title: '最近登录', dataIndex: 'user_last_login_at', width: 190, render: formatDate },
            { title: '加入时间', dataIndex: 'created_at', width: 190, render: formatDate },
            {
              title: '操作',
              width: 310,
              fixed: 'right',
              render: (_, record: OrganizationMemberUser) => {
                const isSelf = record.user_id === me.data?.user.id;
                const isLastActiveOwner = record.role === 'owner' && record.status === 'active' && ownerCount <= 1;
                const canEditOwner = currentRole === 'owner';
                const roleDisabled = !canManageMembers || isSelf || (record.role === 'owner' && !canEditOwner) || isLastActiveOwner;
                const statusDisabled = !canManageMembers || isSelf || isLastActiveOwner || (record.role === 'owner' && !canEditOwner);
                const passwordDisabled = !canManageMembers || isSelf || (record.role === 'owner' && !canEditOwner);

                return (
                  <Space>
                    <Select
                      size="small"
                      value={record.role}
                      style={{ width: 124 }}
                      disabled={roleDisabled}
                      options={roleOptions}
                      onChange={(role) => updateMember.mutate({ id: record.id, role })}
                    />
                    {record.status === 'active' ? (
                      <Popconfirm
                        title="停用该成员？"
                        description="停用后该成员在当前组织下的访问令牌会立即撤销。"
                        onConfirm={() => updateMember.mutate({ id: record.id, status: 'disabled' })}
                      >
                        <Button type="link" danger disabled={statusDisabled} loading={updateMember.isPending}>
                          停用
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button
                        type="link"
                        disabled={!canManageMembers || (record.role === 'owner' && !canEditOwner)}
                        loading={updateMember.isPending}
                        onClick={() => updateMember.mutate({ id: record.id, status: 'active' })}
                      >
                        启用
                      </Button>
                    )}
                    <Button type="link" disabled={passwordDisabled} onClick={() => setPasswordResetMember(record)}>
                      重置密码
                    </Button>
                  </Space>
                );
              },
            },
          ]}
        />
      </PageSurface>

      <PageSurface className="table-surface admin-table-surface">
        <TableToolbar
          title="组织访问令牌"
          description="管理员可查看组织内个人 API Token 的归属、有效期和最近使用情况；完整令牌仅在创建时显示一次。"
          actions={<Tag color={canManageMembers ? 'success' : 'default'}>{canManageMembers ? '管理员可见' : '无管理权限'}</Tag>}
        />
        <Table
          rowKey="id"
          loading={organizationTokens.isLoading}
          dataSource={canManageMembers ? organizationTokens.data || [] : []}
          scroll={{ x: 1420 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: canManageMembers ? '暂无组织访问令牌' : '当前角色只能查看个人访问令牌' }}
          columns={[
            {
              title: '令牌',
              dataIndex: 'name',
              width: 260,
              render: (_, record: OrganizationApiToken) => (
                <EntityCell
                  icon={<KeyRound size={18} />}
                  title={record.name}
                  subtitle={`ID ${shortId(record.id)}`}
                />
              ),
            },
            {
              title: '归属成员',
              dataIndex: 'user_display_name',
              width: 280,
              render: (_, record: OrganizationApiToken) => (
                <EntityCell
                  icon={<Users size={18} />}
                  title={record.user_display_name || record.user_email}
                  subtitle={
                    <Space size={6} wrap className="admin-token-owner">
                      <span>{record.user_email}</span>
                      {record.user_role && roleTag(record.user_role)}
                    </Space>
                  }
                />
              ),
            },
            { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusTag status={value} /> },
            { title: '账号状态', dataIndex: 'user_status', width: 120, render: (value) => <StatusTag status={value} /> },
            { title: '过期时间', dataIndex: 'expires_at', width: 190, render: formatExpiresAt },
            { title: '最后使用', dataIndex: 'last_used_at', width: 190, render: formatLastUsed },
            { title: '创建时间', dataIndex: 'created_at', width: 190, render: formatDate },
            { title: '撤销时间', dataIndex: 'revoked_at', width: 190, render: formatDate },
            { title: '撤销人', width: 180, render: (_, record: OrganizationApiToken) => formatRevokedBy(record) },
            {
              title: '操作',
              width: 120,
              fixed: 'right',
              render: (_, record: OrganizationApiToken) => {
                const isOwnerToken = record.user_role === 'owner';
                const disabled = record.status !== 'active' || (isOwnerToken && currentRole !== 'owner');
                return (
                  <Popconfirm
                    title="撤销组织访问令牌？"
                    description="撤销后依赖该令牌的自动化任务、CI 或外部集成会立即失效。"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => revokeOrganizationToken.mutate(record.id)}
                    disabled={disabled}
                  >
                    <Button type="link" danger disabled={disabled} loading={revokeOrganizationToken.isPending}>
                      撤销
                    </Button>
                  </Popconfirm>
                );
              },
            },
          ]}
        />
      </PageSurface>

      <Drawer
        title="新建本地成员"
        width={480}
        open={memberDrawerOpen}
        onClose={() => setMemberDrawerOpen(false)}
      >
        <Form
          form={memberForm}
          layout="vertical"
          initialValues={{ role: 'viewer' }}
          onFinish={(values) => createMember.mutate(values)}
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input placeholder="name@example.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="display_name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="成员姓名" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '请输入初始密码' },
              { min: 8, message: '至少 8 个字符' },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="至少 8 个字符" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={createRoleOptions} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={createMember.isPending}>
              创建成员
            </Button>
            <Button onClick={() => setMemberDrawerOpen(false)}>取消</Button>
          </Space>
        </Form>
      </Drawer>

      <Drawer
        title="重置成员密码"
        width={420}
        open={Boolean(passwordResetMember)}
        onClose={() => setPasswordResetMember(null)}
      >
        {passwordResetMember && (
          <Form
            form={passwordForm}
            layout="vertical"
            onFinish={(values) => resetPassword.mutate({ id: passwordResetMember.id, password: values.password })}
          >
            <div className="secret-note">
              <strong>{passwordResetMember.user_display_name || passwordResetMember.user_email}</strong>
              <span>提交后该成员在当前组织下的既有访问令牌会立即撤销。</span>
            </div>
            <Form.Item
              name="password"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '至少 8 个字符' },
              ]}
            >
              <Input.Password autoComplete="new-password" placeholder="至少 8 个字符" />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label="确认新密码"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" placeholder="再次输入新密码" />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={resetPassword.isPending}>
                重置密码
              </Button>
              <Button onClick={() => setPasswordResetMember(null)}>取消</Button>
            </Space>
          </Form>
        )}
      </Drawer>

      <PageSurface
        className="table-surface"
        title="我的访问令牌"
        description="令牌只展示当前账号名下记录；新令牌只在创建时显示一次。"
        actions={
          <Button type="primary" icon={<Plus size={15} />} onClick={() => {
            setCreatedToken('');
            setTokenDrawerOpen(true);
          }}>
            新建令牌
          </Button>
        }
      >
        <Table
          rowKey="id"
          loading={tokens.isLoading}
          dataSource={tokens.data || []}
          scroll={{ x: 820 }}
          pagination={false}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              width: 240,
              render: (value: string) => <span className="admin-token-name">{value}</span>,
            },
            { title: '状态', dataIndex: 'status', width: 120, render: (value) => <StatusTag status={value} /> },
            { title: '过期时间', dataIndex: 'expires_at', width: 190, render: formatDate },
            { title: '最后使用', dataIndex: 'last_used_at', width: 190, render: formatDate },
            { title: '创建时间', dataIndex: 'created_at', width: 190, render: formatDate },
            {
              title: '操作',
              width: 120,
              render: (_, record: ApiToken) => (
                <Popconfirm
                  title="撤销该令牌？"
                  onConfirm={() => revokeToken.mutate(record.id)}
                  disabled={record.status !== 'active'}
                >
                  <Button type="link" danger disabled={record.status !== 'active'} loading={revokeToken.isPending}>
                    撤销
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </PageSurface>

      <Drawer
        title="新建访问令牌"
        width={520}
        open={tokenDrawerOpen}
        onClose={() => setTokenDrawerOpen(false)}
      >
        <Form form={tokenForm} layout="vertical" onFinish={(values) => createToken.mutate(values)}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入令牌名称' }]}>
            <Input placeholder="例如 本地调试 / CI 上线 / 运维脚本" autoComplete="off" />
          </Form.Item>
          <Form.Item name="expires_at" label="过期时间">
            <Input placeholder="可选，ISO 时间，例如 2026-12-31T23:59:59+08:00" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={createToken.isPending}>
              创建令牌
            </Button>
            <Button onClick={() => setTokenDrawerOpen(false)}>关闭</Button>
          </Space>
        </Form>

        {createdToken && (
          <div className="secret-note" style={{ marginTop: 16 }}>
            <strong>令牌只显示一次</strong>
            <span>关闭后无法再次查看完整令牌，请立即保存到安全位置。</span>
            <Input.TextArea value={createdToken} rows={3} readOnly />
            <Button icon={<Copy size={15} />} onClick={copyCreatedToken}>
              复制令牌
            </Button>
          </div>
        )}
      </Drawer>
    </WorkspacePage>
  );
}
