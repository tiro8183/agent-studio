import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Form, Input, Spin, Tag } from 'antd';
import {
  Activity,
  BookOpenText,
  Boxes,
  Cable,
  ClipboardList,
  Compass,
  Gauge,
  KeyRound,
  LogOut,
  PlayCircle,
  RadioTower,
  Settings2,
  ShieldCheck,
  SquareStack,
  Wrench,
} from 'lucide-react';
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
import WorkspaceHomePage from '../pages/WorkspaceHomePage';
import { api, clearAccessToken, getAccessToken } from '../services/api';
import { BrandLogo } from '../components/ui';
import type { CurrentUser } from '../types/domain';

const routes = [
  { key: 'home' as const, group: '运营', path: '/', label: '首页', desc: '生产态势、风险、下一步', icon: RadioTower, component: WorkspaceHomePage },
  { key: 'services' as const, group: '运营', path: '/services', label: 'Agent 服务目录', desc: '发现、试用、接入', icon: Compass, component: AgentServiceDirectoryPage },
  { key: 'experience' as const, group: '运营', path: '/experience', label: '体验验证', desc: '真实任务与调用示例', icon: PlayCircle, component: AgentExperiencePage },
  { key: 'runs' as const, group: '运营', path: '/runs', label: '运行证据', desc: '事件、Trace、复验', icon: Activity, component: RunCenterPage },
  { key: 'agents' as const, group: '构建', path: '/agents', label: 'Agent Studio', desc: '设计、检查、上线', icon: SquareStack, component: AgentsPage },
  { key: 'quality' as const, group: '构建', path: '/quality', label: '发布门禁', desc: '验收与复核', icon: ShieldCheck, component: QualityPage },
  { key: 'providers' as const, group: '资产', path: '/providers', label: '模型通道', desc: '接入与可用性', icon: Cable, component: ProvidersPage },
  { key: 'tools' as const, group: '资产', path: '/tools', label: 'Tools', desc: '定义、权限、边界', icon: Wrench, component: ToolsPage },
  { key: 'skills' as const, group: '资产', path: '/skills', label: 'Skills', desc: '指令、allowed tools、版本', icon: BookOpenText, component: SkillsPage },
  { key: 'monitor' as const, group: '治理', path: '/monitor', label: '可观测性', desc: '健康、容量、维护', icon: Gauge, component: MonitorPage },
  { key: 'audit' as const, group: '治理', path: '/audit', label: '审计日志', desc: '关键变更记录', icon: ClipboardList, component: AuditPage },
  { key: 'admin' as const, group: '治理', path: '/admin', label: '访问控制', desc: '成员、令牌、外部接入', icon: Settings2, component: SystemAdminPage },
];

const routeGroups = Array.from(new Set(routes.map((item) => item.group)));

function normalizePath(pathname: string) {
  if (pathname === '/' || pathname === '') return '/';
  if (pathname === '/console') return '/agents';
  return pathname;
}

function routeFromPath(pathname: string) {
  const normalized = normalizePath(pathname);
  return routes.find((item) => item.path === normalized) || routes.find((item) => item.key === 'services') || routes[0];
}

export default function App() {
  const [route, setRoute] = useState(() => routeFromPath(window.location.pathname));
  const [session, setSession] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(Boolean(getAccessToken()));
  const [signingIn, setSigningIn] = useState(false);
  const { message } = AntApp.useApp();
  const Active = route.component;

  useEffect(() => {
    const handlePopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!getAccessToken()) return;
    api.me()
      .then(setSession)
      .catch(() => {
        clearAccessToken();
        setSession(null);
      })
      .finally(() => setBooting(false));
  }, []);

  const userLabel = useMemo(() => session?.user.display_name || session?.user.email || '', [session]);

  async function handleLogin(values: { email: string; password: string }) {
    setSigningIn(true);
    try {
      const authSession = await api.login(values);
      setSession({
        user: authSession.user,
        organization: authSession.organization,
        membership: authSession.membership,
      });
      message.success('已登录');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSigningIn(false);
    }
  }

  function navigate(next: typeof routes[number]) {
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
      <div className="auth-page">
        <Spin />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-page">
        <section className="auth-shell">
          <div className="auth-story">
            <div className="auth-brand">
              <BrandLogo />
              <div>
                <h1>Agent Forge</h1>
                <span>企业 Agent 服务平台</span>
              </div>
            </div>
            <div className="auth-statement">
              <span>企业工作区</span>
              <strong>把每个 Agent 当成可交付的业务服务。</strong>
            </div>
            <div className="auth-signal-board" aria-label="工作区信号">
              <div>
                <span>执行入口</span>
                <strong>POST /v1/responses</strong>
              </div>
              <div>
                <span>Release 状态</span>
                <strong>草稿 / 已上线 / 停用</strong>
              </div>
              <div>
                <span>运行留痕</span>
                <strong>运行证据</strong>
              </div>
            </div>
          </div>
          <div className="auth-panel">
            <div className="auth-copy">
              <span>组织入口</span>
              <strong>登录 Agent Forge</strong>
              <p>进入工作区，构建 Agent 服务，治理模型通道、Tools、Skills，并开放 API 给外部系统调用。</p>
            </div>
            <Form layout="vertical" onFinish={handleLogin}>
              <Form.Item label="邮箱" name="email" rules={[{ required: true, message: '请输入邮箱' }]}>
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password autoComplete="current-password" />
              </Form.Item>
              <Button block type="primary" htmlType="submit" loading={signingIn}>
                <KeyRound size={15} />
                登录
              </Button>
            </Form>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="workspace-topbar">
        <div className="workspace-identity">
          <BrandLogo />
          <div>
            <span>Agent Forge</span>
            <small>企业 Agent 服务平台</small>
          </div>
        </div>
        <nav className="module-nav" aria-label="主导航">
          {routeGroups.map((group) => (
            <section className="module-group" key={group} aria-label={group}>
              <strong>{group}</strong>
              {routes.filter((item) => item.group === group).map((item) => {
                const active = route.key === item.key;
                const Icon = item.icon || Boxes;
                return (
                  <button
                    key={item.key}
                    className={active ? 'module-tab active' : 'module-tab'}
                    type="button"
                    aria-label={item.label}
                    title={`${item.label}：${item.desc}`}
                    onClick={() => navigate(item)}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </nav>
        <div className="workspace-user">
          <div className="user-avatar"><ShieldCheck size={15} /></div>
          <div>
            <span>{userLabel}</span>
            <small>{session.organization.name}</small>
          </div>
          <Tag>{session.membership.role}</Tag>
          <button type="button" title="退出登录" aria-label="退出登录" onClick={handleLogout}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-pane">
        <div className="workspace-frame">
          <Active currentUser={session} />
        </div>
      </main>
    </div>
  );
}
