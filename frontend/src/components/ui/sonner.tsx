import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            'group rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          error: 'text-destructive',
          success: 'text-success',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
