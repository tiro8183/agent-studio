import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
}

/** Agent Studio mark — geometric node/path glyph in brand teal. */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-[10px] bg-primary text-primary-foreground shadow-sm',
        'size-9',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
        <path
          d="M5 17.5 12 4l7 13.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.55"
        />
        <circle cx="12" cy="4" r="2.1" fill="currentColor" />
        <circle cx="5" cy="17.5" r="2.1" fill="currentColor" />
        <circle cx="19" cy="17.5" r="2.1" fill="currentColor" />
        <path
          d="M6.6 16 12 6.2 17.4 16"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
      </svg>
    </div>
  );
}
