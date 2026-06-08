import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import type { RuntimeResource, SkillChange } from '../../types/domain';

export function renderRuntimeResources(resources: RuntimeResource[]) {
  if (!resources.length) return <span className="text-sm text-muted-foreground">无</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {resources.map((item) => (
        <Badge key={item.id} variant={item.status === 'active' ? 'info' : 'muted'}>
          {item.name || item.id} · {item.kind}
        </Badge>
      ))}
    </div>
  );
}

export function renderSkillChanges(changes: SkillChange[]) {
  if (!changes.length) return <div className="py-3 text-sm text-muted-foreground">没有字段差异</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[150px]">字段</TableHead>
          <TableHead>当前值</TableHead>
          <TableHead>目标值</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((change) => (
          <TableRow key={change.field}>
            <TableCell className="font-medium">{change.field}</TableCell>
            <TableCell>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                {change.before || '-'}
              </pre>
            </TableCell>
            <TableCell>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                {change.after || '-'}
              </pre>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
