import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, Input, Space, Table, Tag } from 'antd';
import { AlertTriangle, ClipboardList, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { PageSurface, StatusTag, TableToolbar, WorkspacePage } from '../components/ui';
import { api } from '../services/api';
import { auditSubjectLabel, productTerms } from '../services/productLanguage';
import type { AuditLog } from '../types/domain';

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function shortResourceId(value?: string | null) {
  if (!value) return '-';
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-4)}` : value;
}

function actionLabel(value: string) {
  return auditSubjectLabel(value);
}

function isSensitiveAudit(item: AuditLog) {
  const action = item.action.toLowerCase();
  return (
    item.status !== 'success'
    || action.includes('token')
    || action.includes('secret')
    || action.includes('delete')
    || action.includes('revoke')
    || action.includes('llm')
    || action.includes('tool')
  );
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const audits = useQuery({
    queryKey: ['audits', action],
    queryFn: () => api.listAudits({ action: action || undefined, limit: 200 }),
    refetchInterval: 15000,
  });
  const actions = useMemo(
    () => Array.from(new Set((audits.data || []).map((item) => item.action))).sort(),
    [audits.data],
  );
  const auditStats = useMemo(() => {
    const rows = audits.data || [];
    const failed = rows.filter((item) => item.status !== 'success').length;
    const users = new Set(rows.map((item) => item.user_email || item.user_id).filter(Boolean));
    const sensitive = rows.filter(isSensitiveAudit);
    const tokenOps = rows.filter((item) => item.action.toLowerCase().includes('token')).length;
    return {
      failed,
      rows,
      sensitive,
      tokenOps,
      users,
    };
  }, [audits.data]);
  const riskItems = auditStats.sensitive.slice(0, 5);

  return (
      <WorkspacePage
        icon={<ClipboardList size={14} />}
        eyebrow="审计日志"
        title="审计日志"
      description="登录、令牌和关键配置变更。"
    >
      <section className="audit-command-center" aria-label="审计窗口摘要">
        <div>
          <span className={auditStats.failed ? 'audit-alert-badge danger' : 'audit-alert-badge ready'}>
            {auditStats.failed ? `${auditStats.failed} 条失败` : '无失败操作'}
          </span>
          <h2>{auditStats.sensitive.length ? '敏感变更与失败操作' : '当前窗口无高优先级风险'}</h2>
          <p>
            最近 {auditStats.rows.length} 条记录涉及 {auditStats.users.size} 个操作者，
            其中 {auditStats.sensitive.length} 条命中敏感规则，{auditStats.tokenOps} 条与访问令牌相关。
          </p>
        </div>
        <div className="audit-window-ledger">
          <span>追踪对象</span>
          <strong>登录、令牌、模型通道、{productTerms.action}治理</strong>
          <em>点击记录可查看请求详情、资源 ID 与客户端信息。</em>
        </div>
      </section>
      <div className="audit-workbench-grid">
        <PageSurface
          className="audit-risk-surface"
          title="审计分诊"
          description={`失败操作、令牌变更、模型通道和${productTerms.action}治理。`}
        >
          <div className="audit-risk-list">
            {riskItems.map((item) => (
              <button type="button" key={item.id} onClick={() => setSelected(item)}>
                <Tag color={item.status === 'success' ? 'warning' : 'error'}>{item.status === 'success' ? '敏感' : '失败'}</Tag>
                <div>
                  <strong>{actionLabel(item.action)}</strong>
                  <span>{item.user_email || item.user_id || '系统'} · {item.resource_type || '未知资源'}</span>
                </div>
                <em>{formatDate(item.created_at)}</em>
              </button>
            ))}
            {!audits.isLoading && !riskItems.length && (
              <div className="tool-empty-state audit-empty-state">
                <ShieldCheck size={18} />
                <strong>当前没有需要优先处理的审计项</strong>
                <span>最近记录未发现失败、令牌或关键接入变更。</span>
              </div>
            )}
          </div>
        </PageSurface>
        <PageSurface
          className="audit-policy-surface"
          title="审计覆盖"
          description="关键配置、访问令牌和运行入口。"
        >
          <div className="tool-policy-list">
            <div><UserRound size={16} /><span>{auditStats.users.size} 个操作者出现在当前审计窗口。</span></div>
            <div><KeyRound size={16} /><span>{auditStats.tokenOps} 条访问令牌相关操作。</span></div>
            <div><AlertTriangle size={16} /><span>{auditStats.failed} 条失败操作需要结合资源和客户端信息复核。</span></div>
          </div>
        </PageSurface>
      </div>
      <PageSurface className="run-table-surface">
        <TableToolbar
          title="操作日志"
          description="点击记录查看请求详情、资源定位和客户端信息。"
          filters={
            <Space>
            <Input.Search
              allowClear
              list="audit-actions"
              placeholder="按操作精确过滤"
              onSearch={setAction}
              style={{ width: 260 }}
            />
            <datalist id="audit-actions">
              {actions.map((item) => <option key={item} value={item} />)}
            </datalist>
            </Space>
          }
        />
        <Table
          rowKey="id"
          loading={audits.isLoading}
          dataSource={audits.data || []}
          scroll={{ x: 1180 }}
          onRow={(record) => ({ onClick: () => setSelected(record) })}
          columns={[
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value) => <StatusTag status={value} />,
            },
            { title: '操作', dataIndex: 'action', width: 250, ellipsis: true },
            { title: '用户', dataIndex: 'user_email', width: 220, render: (value) => value || '-' },
            { title: '资源', dataIndex: 'resource_type', width: 130 },
            { title: '资源 ID', dataIndex: 'resource_id', width: 180, render: (value) => shortResourceId(value) },
            { title: 'IP', dataIndex: 'ip', width: 140, render: (value) => value || '-' },
            { title: '时间', dataIndex: 'created_at', width: 190, render: formatDate },
          ]}
        />
      </PageSurface>
      <Drawer
        title="审计详情"
        width={620}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div className="run-detail">
            <div className="kv-list">
              <div><span>操作</span><strong>{selected.action}</strong></div>
              <div><span>状态</span><strong>{selected.status}</strong></div>
              <div><span>用户</span><strong>{selected.user_email || selected.user_id || '-'}</strong></div>
              <div><span>组织</span><strong>{selected.org_id || '-'}</strong></div>
              <div><span>资源</span><strong>{selected.resource_type || '-'}</strong></div>
              <div><span>资源 ID</span><strong>{selected.resource_id || '-'}</strong></div>
              <div><span>IP</span><strong>{selected.ip || '-'}</strong></div>
              <div><span>时间</span><strong>{formatDate(selected.created_at)}</strong></div>
            </div>
            <h3>请求详情</h3>
            <pre>{JSON.stringify(selected.metadata || {}, null, 2)}</pre>
            <h3>客户端与设备信息</h3>
            <pre>{selected.user_agent || '-'}</pre>
          </div>
        )}
      </Drawer>
    </WorkspacePage>
  );
}
