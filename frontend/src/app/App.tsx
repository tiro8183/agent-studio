import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity,
  ChevronsUpDown,
  ClipboardList,
  Compass,
  Gauge,
  LogOut,
  PlayCircle,
  RadioTower,
  Settings2,
  ShieldCheck,
  SquareStack,
  Wrench,
  BookOpenText,
  Cable,
  type LucideIcon,
} from 'lucide-react';
import HomePage from '../pages/HomePage';
import LoginPage from './LoginPage';
import AgentsPage from '../pages/AgentsPage';
import AgentExperiencePage from '../pages/AgentExperiencePage';
import AgentServiceDirectoryPage from '../pages/AgentServiceDirectoryPage';
import AuditPage from '../pages/AuditPage';
import MonitorPage from '../pages/MonitorPage';
import ProvidersPage from '../pages/ProvidersPage';
import QualityPage from '../pages/QualityPage';
import RunCenterPage from '../pages/RunCenterPage';
import SkillsPage from '../pages/SkillsPage';
import SystemAdminPage from '../pages/SystemAdminPage';
import ToolsPage from '../pages/ToolsPage';
import { api, clearAccessToken, getAccessToken } from '../services/api';
import type { CurrentUser, OrganizationRole } from '../types/domain';
import { BrandMark } from '../components/brand-mark';
import { Badge } from '../components/ui/badge';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface RouteDef {
  key: string;
  group: string;
  path: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  component: ComponentType<{ currentUser?: CurrentUser | null }>;
  modern?: boolean;
}

const routes: RouteDef[] = [
  { key: 'home', group: '生产工作台', path: '/', label: '生产台', desc: '上线、风险、证据', icon: RadioTower, component: HomePage, modern: true },
  { key: 'services', group: '生产工作台', path: '/services', label: 'Agent 广场', desc: '发现、试用、接入', icon: Compass, component: AgentServiceDirectoryPage },
  { key: 'experience', group: '生产工作台', path: '/experience', label: '体验台', desc: '业务任务复核', icon: PlayCircle, component: AgentExperiencePage },
  { key: 'runs', group: '生产工作台', path: '/runs', label: '运行证据', desc: '事件、轨迹、复验', icon: Activity, component: RunCenterPage },
  { key: 'agents', group: '服务建设', path: '/agents', label: 'Agent Studio', desc: '设计、检查、上线', icon: SquareStack, component: AgentsPage },
  { key: 'quality', group: '服务建设', path: '/quality', label: '发布门禁', desc: '验收与复核', icon: ShieldCheck, component: QualityPage },
  { key: 'providers', group: '平台资产', path: '/providers', label: '模型接入', desc: '通道与可用性', icon: Cable, component: ProvidersPage },
  { key: 'tools', group: '平台资产', path: '/tools', label: '工具治理', desc: '工具、权限、边界', icon: Wrench, component: ToolsPage },
  { key: 'skills', group: '平台资产', path: '/skills', label: '能力包资产', desc: '指令与版本', icon: BookOpenText, component: SkillsPage },
  { key: 'monitor', group: '平台治理', path: '/monitor', label: '平台观测', desc: '健康、容量、维护', icon: Gauge, component: MonitorPage },
  { key: 'audit', group: '平台治理', path: '/audit', label: '审计日志', desc: '关键变更记录', icon: ClipboardList, component: AuditPage },
  { key: 'admin', group: '平台治理', path: '/admin', label: '组织权限', desc: '成员与访问令牌', icon: Settings2, component: SystemAdminPage },
];

const routeGroups = Array.from(new Set(routes.map((item) => item.group)));

const roleLabel: Record<OrganizationRole, string> = {
  owner: '拥有者',
  admin: '管理员',
  editor: '编辑',
  viewer: '查看',
};

function normalizePath(pathname: string) {
  if (pathname === '/' || pathname === '') return '/';
  if (pathname === '/console') return '/agents';
  return pathname;
}

function routeFromPath(pathname: string) {
  const normalized = normalizePath(pathname);
  return routes.find((item) => item.path === normalized) || routes[0];
}

function initials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '·';
  return trimmed.slice(0, 2).toUpperCase();
}

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [session, setSession] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(Boolean(getAccessToken()));

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!getAccessToken()) return;
    api
      .me()
      .then(setSession)
      .catch(() => {
        clearAccessToken();
        setSession(null);
      })
      .finally(() => setBooting(false));
  }, []);

  const userLabel = useMemo(
    () => session?.user.display_name || session?.user.email || '',
    [session],
  );

  function navigateRoute(next: RouteDef) {
    if (route.key === next.key) return;
    window.history.pushState({}, '', next.path);
    setRoute(next);
  }

  function handleLogout() {
    clearAccessToken();
    setSession(null);
    window.history.replaceState({}, '', '/');
    setRoute(routeFromPath('/'));
  }

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="size-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <LoginPage
        onAuthenticated={(authSession) => {
          setSession({
            user: authSession.user,
            organization: authSession.organization,
            membership: authSession.membership,
          });
          setBooting(false);
        }}
      />
    );
  }

  const Active = route.component;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <BrandMark className="size-8" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight text-foreground">Agent Studio</div>
            <div className="truncate text-[11px] text-muted-foreground">Agent 生产系统</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="主导航">
          {routeGroups.map((group) => (
            <div key={group} className="space-y-1">
              <div className="px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              {routes
                .filter((item) => item.group === group)
                .map((item) => {
                  const active = route.key === item.key;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      title={`${item.label}：${item.desc}`}
                      onClick={() => navigateRoute(item)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        active
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">{initials(userLabel)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{userLabel}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {session.organization.name}
                  </div>
                </div>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-[216px]">
              <DropdownMenuLabel>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{session.user.email}</span>
                  <Badge variant="secondary">{roleLabel[session.membership.role]}</Badge>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <route.icon className="size-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">{route.label}</h1>
          </div>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-xs text-muted-foreground">{route.desc}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Active currentUser={session} />
        </main>
      </div>
    </div>
  );
}
