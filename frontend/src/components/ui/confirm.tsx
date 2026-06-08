import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from './popover';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ConfirmProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}

/** Popconfirm replacement — wraps a trigger element and confirms inline before firing onConfirm. */
function Confirm({
  title,
  description,
  okText = '确认',
  cancelText = '取消',
  danger = true,
  disabled,
  onConfirm,
  children,
}: ConfirmProps) {
  const [open, setOpen] = React.useState(false);
  if (disabled) return <>{children}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="flex gap-2.5">
          <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', danger ? 'text-destructive' : 'text-warning')} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{title}</div>
            {description ? <div className="mt-1 text-xs text-muted-foreground">{description}</div> : null}
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <PopoverClose asChild>
            <Button size="sm" variant="ghost">
              {cancelText}
            </Button>
          </PopoverClose>
          <Button
            size="sm"
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {okText}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { Confirm };
