import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, Workflow, Activity } from 'lucide-react';
import { api } from '../services/api';
import type { AuthSession } from '../types/domain';
import { BrandMark } from '../components/brand-mark';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

interface LoginPageProps {
  onAuthenticated: (session: AuthSession) => void;
}

const signals = [
  { icon: Workflow, label: '执行入口', value: '/v1/responses' },
  { icon: ShieldCheck, label: '发布状态', value: '未上线 / 已上线 / 停用' },
  { icon: Activity, label: '运行留痕', value: '统一运行证据' },
];

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const session = await api.login({ email, password });
      toast.success('已登录');
      onAuthenticated(session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Story panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="bg-primary-foreground/10 text-primary-foreground" />
          <div>
            <div className="text-lg font-semibold">Agent Studio</div>
            <div className="text-sm text-primary-foreground/70">企业 Agent 生产系统</div>
          </div>
        </div>

        <div className="relative space-y-3">
          <span className="text-sm uppercase tracking-wide text-primary-foreground/70">企业工作区</span>
          <p className="max-w-md text-2xl font-semibold leading-snug">
            把每个 Agent 当成可交付的业务服务。
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-3">
          {signals.map((signal) => (
            <div
              key={signal.label}
              className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 p-3"
            >
              <signal.icon className="size-4 text-primary-foreground/70" />
              <div className="mt-2 text-xs text-primary-foreground/70">{signal.label}</div>
              <div className="mt-0.5 text-sm font-medium">{signal.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <div>
              <div className="text-lg font-semibold text-foreground">Agent Studio</div>
              <div className="text-sm text-muted-foreground">企业 Agent 生产系统</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              组织入口
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">登录 Agent Studio</h1>
            <p className="text-sm text-muted-foreground">
              进入工作区，管理 Agent 服务、模型通道、工具边界和运行证据。
            </p>
          </div>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              <KeyRound />
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
