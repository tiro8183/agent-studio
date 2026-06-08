import { BrandMark } from '../brand-mark';

interface BrandLogoProps {
  size?: 'compact' | 'regular';
}

export function BrandLogo({ size = 'regular' }: BrandLogoProps) {
  return <BrandMark className={size === 'compact' ? 'size-8' : 'size-9'} />;
}
