# Agent Studio 前端设计系统（迁移规范）

技术栈:**Tailwind CSS v4 + shadcn/ui 风格组件 + Radix**。现代简约 SaaS,浅色,品牌蓝 `#2563eb`。
正在把旧的 **Ant Design + styles.css** 全量替换为本设计系统。

## 路径别名

`@/` → `src/`。例:`import { Button } from '@/components/ui/button'`。

## 设计 token(Tailwind 工具类直接可用)

颜色:`bg-background text-foreground bg-card bg-muted text-muted-foreground bg-primary text-primary-foreground
bg-accent text-accent-foreground border-border bg-secondary text-success text-warning text-destructive text-info`。
圆角:`rounded-md rounded-lg rounded-xl`。语义色都有 `/N` 透明度(如 `bg-success/12`)。

## 组件库(全部在 `@/components/ui/*`,小写文件名)

| 旧 antd | 新组件 | 备注 |
|---|---|---|
| `Button` | `Button` (`./button`) | `variant`: default/outline/secondary/ghost/destructive/link;`size`: default/sm/lg/icon。图标直接放 children,会自动 size-4 |
| `Tag` | `Badge` (`./badge`) 或 `StatusBadge` (`./status-badge`) | 状态语义优先用 `StatusBadge status="published"` 等 |
| `Input` | `Input` (`./input`) | |
| `Input.Password` | `<Input type="password" />` | |
| `Input.TextArea` | `Textarea` (`./textarea`) | |
| `InputNumber` | `NumberInput` (`./number-input`) | `onChange(value: number\|null)` |
| `Select` | `Select/SelectTrigger/SelectValue/SelectContent/SelectItem` (`./select`) | 受控:`<Select value onValueChange>`;option → `<SelectItem value>` |
| `Switch` | `Switch` (`./switch`) | `checked` / `onCheckedChange` |
| `Checkbox` | `Checkbox` (`./checkbox`) | `checked` / `onCheckedChange` |
| `Table` | `Table/TableHeader/TableBody/TableRow/TableHead/TableCell` (`./table`) | 手写表头/行,不再用 columns 配置 |
| `Popconfirm` | `Confirm` (`./confirm`) | `<Confirm title onConfirm>{trigger}</Confirm>` |
| `Drawer` | `Sheet/SheetContent/SheetHeader/SheetTitle/SheetBody/SheetFooter` (`./sheet`) | `<Sheet open onOpenChange>`;`side="right"` |
| `Modal` | `Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter` (`./dialog`) | |
| `Tooltip` | `Tooltip` (`./tooltip`) | `<Tooltip content="..">{child}</Tooltip>` |
| `Tabs` | `Tabs/TabsList/TabsTrigger/TabsContent` (`./tabs`) | `<Tabs value onValueChange>` |
| `Collapse` | `Accordion/AccordionItem/AccordionTrigger/AccordionContent` (`./accordion`) | `<Accordion type="single"\|"multiple" collapsible>` |
| `Progress` | `Progress` (`./progress`) | `value` 0-100 |
| `Alert` | `Alert/AlertTitle/AlertDescription` (`./alert`) | `variant`: info/success/warning/destructive |
| `Empty` | `EmptyState` (`./empty-state`) | |
| `Spin` | `Spinner` / `PageLoader` (`./spinner`) | |
| `Dropdown` | `DropdownMenu/...` (`./dropdown-menu`) | |
| `Space` | 用 `flex items-center gap-2` | 不需要组件 |
| `Form` | 受控 state + `Field` (`@/components/layout`) | 自己管 `useState`,提交时手动校验 |
| `Upload` | 原生 `<input type="file">`(可隐藏 + Button 触发) | |
| `App.useApp().message` | `toast` from `@/lib/toast` | `toast.success/error/info/warning(msg)` |

## 布局原语(`@/components/layout`)

- `PageContainer` — 页面外层(max-w + gap-6)
- `PageHeader title description actions` — 页面标题区
- `SectionCard title description actions` — 卡片区块(带头部)
- `StatCard label value hint icon tone onClick` — 指标卡
- `Field label hint required htmlFor` — 表单字段包装
- `Toolbar` — 筛选/操作行(flex wrap gap-2)

## 共享(已迁移,可继续用)

`@/components/ui` 仍导出:`WorkspacePage, PageSurface, MetricStrip, EntityCell, TableToolbar,
StatusSummary, WorkspaceMetricGrid, WorkspaceIssueList, RuntimeSummaryStrip, navigateWorkspace,
BrandLogo, StatusTag, HealthTags`。这些已是 Tailwind 实现,API 不变。

## 工具函数

- `@/lib/utils` → `cn()`
- `@/lib/format` → `formatDuration, formatDateTime, formatDate, formatRelativeTime, formatNumber, shortId, formatBytes, formatPercent`
- `@/lib/toast` → `toast`, `errorMessage(error, fallback)`
- `@/services/authz` → `canAtLeast(role, 'editor')`
- 导航:`navigateTo(path)` from `@/pages/agentServiceModel`(或 `navigateWorkspace`)

## 硬性要求

1. **功能零回归**:数据请求(TanStack Query)、事件处理、业务逻辑、props 接口全部保持不变,只改表现层。
2. **彻底移除 antd**:不得再 `from 'antd'` 或 `@ant-design/icons`;图标统一用 `lucide-react`。
3. **不要再用 styles.css 的类名**(`page/surface/eyebrow/metric-strip/...`),改用 Tailwind 工具类或布局原语。
4. 中文文案保持原样。
5. 改完确保 `npx tsc -b` 能通过(从 `frontend/` 运行)。
