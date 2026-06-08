import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} />;
}

function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-primary" />
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  );
}

export { Spinner, PageLoader };
