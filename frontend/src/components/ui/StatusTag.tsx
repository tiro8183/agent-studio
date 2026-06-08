import { Tag } from 'antd';
import { agentLifecycleLabel } from '../../services/agentLifecycle';

const statusMeta = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' },
  inactive: { label: '停用', color: 'default' },
  revoked: { label: '已撤销', color: 'default' },
  expired: { label: '已过期', color: 'warning' },
  unpublished: { label: agentLifecycleLabel('unpublished'), color: 'warning' },
  published: { label: agentLifecycleLabel('published'), color: 'success' },
  success: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  healthy: { label: '可用', color: 'success' },
  unchecked: { label: '未检测', color: 'default' },
  running: { label: '运行中', color: 'processing' },
  completed: { label: '完成', color: 'success' },
  error: { label: '错误', color: 'error' },
} as const;

interface StatusTagProps {
  status?: string | boolean | null;
  trueLabel?: string;
  falseLabel?: string;
}

export function StatusTag({ status, trueLabel = '是', falseLabel = '否' }: StatusTagProps) {
  if (typeof status === 'boolean') {
    return <Tag color={status ? 'success' : 'warning'}>{status ? trueLabel : falseLabel}</Tag>;
  }
  const value = status || '';
  const meta = statusMeta[value as keyof typeof statusMeta] || { label: value || '-', color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
