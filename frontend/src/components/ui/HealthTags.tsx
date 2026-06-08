import { Tag } from 'antd';

interface HealthTagsProps {
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
}

export function HealthTags({ ready, score, blockers, warnings }: HealthTagsProps) {
  return (
    <span className="health-tags">
      <Tag color={ready ? 'success' : 'error'}>{ready ? '就绪' : '未通过'}</Tag>
      <Tag color={score >= 80 ? 'green' : score >= 60 ? 'gold' : 'red'}>{score}</Tag>
      {blockers > 0 && <Tag color="red">{blockers} 未通过项</Tag>}
      {warnings > 0 && <Tag color="gold">{warnings} 风险提示</Tag>}
    </span>
  );
}
