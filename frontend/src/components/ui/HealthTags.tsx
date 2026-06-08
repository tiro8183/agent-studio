import { HealthBadges } from './status-badge';

interface HealthTagsProps {
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
}

export function HealthTags(props: HealthTagsProps) {
  return <HealthBadges {...props} />;
}
