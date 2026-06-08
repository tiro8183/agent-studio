import { Space, Table, Tag } from 'antd';
import type { RuntimeResource, SkillChange } from '../../types/domain';

export function renderRuntimeResources(resources: RuntimeResource[]) {
  if (!resources.length) return <span className="muted">无</span>;
  return (
    <Space wrap>
      {resources.map((item) => (
        <Tag key={item.id} color={item.status === 'active' ? 'blue' : 'default'}>
          {item.name || item.id} · {item.kind}
        </Tag>
      ))}
    </Space>
  );
}

export function renderSkillChanges(changes: SkillChange[]) {
  if (!changes.length) return <div className="mini-empty">没有字段差异</div>;
  return (
    <Table
      size="small"
      rowKey="field"
      pagination={false}
      dataSource={changes}
      columns={[
        { title: '字段', dataIndex: 'field', width: 150 },
        { title: '当前值', dataIndex: 'before', render: (value) => <pre className="inline-diff">{value || '-'}</pre> },
        { title: '目标值', dataIndex: 'after', render: (value) => <pre className="inline-diff">{value || '-'}</pre> },
      ]}
    />
  );
}
