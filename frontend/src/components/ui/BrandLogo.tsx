interface BrandLogoProps {
  size?: 'compact' | 'regular';
}

export function BrandLogo({ size = 'regular' }: BrandLogoProps) {
  return (
    <div className={`brand-logo ${size === 'compact' ? 'compact' : ''}`} aria-label="Agent Forge">
      <svg viewBox="0 0 48 48" focusable="false">
        <rect className="logo-frame" x="5.5" y="5.5" width="37" height="37" rx="7" />
        <path className="logo-axis" d="M15.4 17.8h17.2M15.4 30.2h17.2" />
        <path className="logo-path" d="M17.2 30.2c6.1 0 13.6-1.8 13.6-6.2s-7.5-6.2-13.6-6.2" />
        <path className="logo-mark" d="M18.4 34.2L24 13.8l5.6 20.4" />
        <circle className="logo-node primary" cx="17.2" cy="17.8" r="2.35" />
        <circle className="logo-node" cx="30.8" cy="24" r="2.35" />
        <circle className="logo-node light" cx="17.2" cy="30.2" r="2.35" />
      </svg>
    </div>
  );
}
