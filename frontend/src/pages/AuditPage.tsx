import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, KeyRound, Search, ShieldCheck, UserRound } from 'lucide-react';
import { PageContainer, PageHeader, SectionCard, StatCard, Toolbar } from '../components/layout';
import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '../components/ui/sheet';
import { Spinner } from '../components/ui/spinner';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
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
  const [search, setSearch] = useState('');
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

  function handleSearch(value: string) {
    setSearch(value);
    setAction(value);
  }

  return (
    <PageContainer>
      <PageHeader
        title="审计日志"
        description="登录、访问令牌、模型通道、Tools、Skills 和关键配置变更。"
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ClipboardList className="size-4" />
            <span>治理</span>
          </div>
        }
      />

      {/* Summary strip */}
      <div className="flex flex-wrap items-start gap-3">
        <StatCard
          label="失败操作"
          value={auditStats.failed}
          hint={auditStats.failed ? '需要结合资源和客户端信息复核' : '当前窗口无失败操作'}
          tone={auditStats.failed ? 'destructive' : 'success'}
          icon={<AlertTriangle className="size-4" />}
          className="flex-1 min-w-[160px]"
        />
        <StatCard
          label="操作者"
          value={auditStats.users.size}
          hint="出现在当前审计窗口的用户数"
          icon={<UserRound className="size-4" />}
          className="flex-1 min-w-[160px]"
        />
        <StatCard
          label="敏感记录"
          value={auditStats.sensitive.length}
          hint="命中敏感规则的审计条目"
          tone={auditStats.sensitive.length ? 'warning' : 'default'}
          icon={<ShieldCheck className="size-4" />}
          className="flex-1 min-w-[160px]"
        />
        <StatCard
          label="令牌相关"
          value={auditStats.tokenOps}
          hint="访问令牌相关操作次数"
          icon={<KeyRound className="size-4" />}
          className="flex-1 min-w-[160px]"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Triage panel */}
        <SectionCard
          title="审计分诊"
          description={`失败操作、令牌变更、模型通道和${productTerms.action}治理。`}
        >
          <div className="flex flex-col gap-1">
            {riskItems.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelected(item)}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <Badge variant={item.status === 'success' ? 'warning' : 'destructive'} className="shrink-0">
                  {item.status === 'success' ? '敏感' : '失败'}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{actionLabel(item.action)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.user_email || item.user_id || '系统'} · {item.resource_type || '未知资源'}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
              </button>
            ))}
            {!audits.isLoading && !riskItems.length && (
              <EmptyState
                compact
                icon={<ShieldCheck className="size-5" />}
                title="当前没有需要优先处理的审计项"
                description="最近记录未发现失败、令牌或关键接入变更。"
              />
            )}
            {audits.isLoading && (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            )}
          </div>
        </SectionCard>

        {/* Coverage panel */}
        <SectionCard
          title="审计覆盖"
          description="关键配置、访问令牌和运行入口。"
        >
          <div className="flex flex-col gap-3 py-1">
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              <UserRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{auditStats.users.size} 个操作者出现在当前审计窗口。</span>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{auditStats.tokenOps} 条访问令牌相关操作。</span>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-foreground">{auditStats.failed} 条失败操作需要结合资源和客户端信息复核。</span>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              追踪对象：登录、令牌、模型通道、{productTerms.action}治理。
              点击记录可查看请求详情、资源 ID 与客户端信息。
            </p>
            <div className="mt-1 rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              最近 {auditStats.rows.length} 条记录涉及 {auditStats.users.size} 个操作者，
              其中 {auditStats.sensitive.length} 条命中敏感规则，{auditStats.tokenOps} 条与访问令牌相关。
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Main log table */}
      <SectionCard
        title="操作日志"
        description="点击记录查看请求详情、资源定位和客户端信息。"
        actions={
          <Toolbar>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                list="audit-actions"
                placeholder="按操作精确过滤"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch(search);
                }}
                onBlur={() => handleSearch(search)}
                className="pl-8"
              />
              <datalist id="audit-actions">
                {actions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </div>
          </Toolbar>
        }
        contentPadding={false}
      >
        {audits.isLoading ? (
          <div className="flex items-center justify-center py-14">
            <Spinner />
          </div>
        ) : (audits.data || []).length === 0 ? (
          <EmptyState
            compact
            title="暂无审计记录"
            description="当前过滤条件下没有操作日志。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">状态</TableHead>
                <TableHead className="w-[250px]">操作</TableHead>
                <TableHead className="w-[220px]">用户</TableHead>
                <TableHead className="w-[130px]">资源</TableHead>
                <TableHead className="w-[180px]">资源 ID</TableHead>
                <TableHead className="w-[140px]">IP</TableHead>
                <TableHead className="w-[190px]">时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audits.data || []).map((record) => (
                <TableRow
                  key={record.id}
                  onClick={() => setSelected(record)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <StatusBadge status={record.status} />
                  </TableCell>
                  <TableCell className="max-w-[250px] truncate" title={record.action}>
                    {record.action}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {record.user_email || '-'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{record.resource_type}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {shortResourceId(record.resource_id)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{record.ip || '-'}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(record.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* Detail drawer */}
      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-[620px] max-w-full">
          <SheetHeader>
            <SheetTitle>审计详情</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {selected && (
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {(
                    [
                      ['操作', selected.action],
                      ['状态', <StatusBadge key="status" status={selected.status} />],
                      ['用户', selected.user_email || selected.user_id || '-'],
                      ['组织', selected.org_id || '-'],
                      ['资源', selected.resource_type || '-'],
                      ['资源 ID', selected.resource_id || '-'],
                      ['IP', selected.ip || '-'],
                      ['时间', formatDate(selected.created_at)],
                    ] as [string, React.ReactNode][]
                  ).map(([label, value]) => (
                    <div key={label} className="contents">
                      <span className="text-muted-foreground">{label}</span>
                      <strong className="font-medium text-foreground break-all">{value}</strong>
                    </div>
                  ))}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">请求详情</h3>
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-foreground">
                    {JSON.stringify(selected.metadata || {}, null, 2)}
                  </pre>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">客户端与设备信息</h3>
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-foreground">
                    {selected.user_agent || '-'}
                  </pre>
                </div>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
