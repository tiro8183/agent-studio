import { toast as sonnerToast } from 'sonner';

/**
 * Lightweight replacement for Ant Design's `App.useApp().message`.
 * Usage: `import { toast } from '@/lib/toast'; toast.success('已保存')`.
 */
export const toast = {
  success: (msg: string, description?: string) => sonnerToast.success(msg, { description }),
  error: (msg: string, description?: string) => sonnerToast.error(msg, { description }),
  info: (msg: string, description?: string) => sonnerToast(msg, { description }),
  warning: (msg: string, description?: string) => sonnerToast.warning(msg, { description }),
  loading: (msg: string) => sonnerToast.loading(msg),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export function errorMessage(error: unknown, fallback = '操作失败') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  return fallback;
}
