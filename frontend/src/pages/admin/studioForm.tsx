import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { Switch } from '@/components/ui/switch';
import { Field } from '@/components/layout';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Field path: a top-level string key or a nested array path (antd-style). */
export type FieldPath = string | (string | number)[];

function toSegments(path: FieldPath): (string | number)[] {
  return Array.isArray(path) ? path : [path];
}

function getIn(obj: any, segments: (string | number)[]): any {
  let cursor = obj;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function cloneContainer(value: any, key: string | number): any {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  // Decide container shape from the next key type.
  return typeof key === 'number' ? [] : {};
}

function setIn(obj: any, segments: (string | number)[], next: any): any {
  if (!segments.length) return next;
  const [head, ...rest] = segments;
  const root = cloneContainer(obj, head);
  root[head] = rest.length ? setIn(root[head], rest, next) : next;
  return root;
}

/** Deep-merge a partial values object into the current values (objects merge, arrays replace). */
function deepMerge(base: any, patch: any): any {
  if (patch === null || patch === undefined) return patch;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const result: Record<string, any> = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    const incoming = patch[key];
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
      result[key] = deepMerge(result[key], incoming);
    } else {
      result[key] = incoming;
    }
  }
  return result;
}

export interface ValidationRule {
  required?: boolean;
  pattern?: RegExp;
  max?: number;
  message?: string;
}

export interface StudioFormShim {
  /** Current flat values object (same shape antd Form produced). */
  getFieldsValue: (all?: boolean) => Record<string, any>;
  /** Read a single (possibly nested) field. */
  getFieldValue: (path: FieldPath) => any;
  /** Merge a partial values object into state. */
  setFieldsValue: (values: Record<string, any>) => void;
  /** Set a single (possibly nested) field. */
  setFieldValue: (path: FieldPath, value: any) => void;
  /** Validate registered rules; resolves with values or rejects on first error. */
  validateFields: () => Promise<Record<string, any>>;
  /** Reset to an empty object. */
  resetFields: () => void;
  /** Register validation rules for a field (used by required-marking + submit validation). */
  registerRules: (path: FieldPath, rules: ValidationRule[]) => void;
  /** Subscribe to value changes; returns an unsubscribe fn. */
  subscribe: (listener: () => void) => () => void;
  /** Internal: triggered whenever a field changes (for unsaved tracking + preview revision). */
  __onChange?: () => void;
}

interface FormStore {
  values: Record<string, any>;
  rules: Map<string, ValidationRule[]>;
  listeners: Set<() => void>;
  onChange?: () => void;
}

function pathKey(path: FieldPath): string {
  return toSegments(path).join('.');
}

export function useStudioForm(onChange?: () => void): StudioFormShim {
  const [, forceRender] = React.useReducer((value) => value + 1, 0);
  const storeRef = React.useRef<FormStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = { values: {}, rules: new Map(), listeners: new Set() };
  }
  const store = storeRef.current;
  store.onChange = onChange;

  const notify = React.useCallback(() => {
    forceRender();
    store.listeners.forEach((listener) => listener());
  }, [store]);

  return React.useMemo<StudioFormShim>(() => ({
    getFieldsValue: () => store.values,
    getFieldValue: (path) => getIn(store.values, toSegments(path)),
    setFieldsValue: (values) => {
      store.values = deepMerge(store.values, values);
      notify();
    },
    setFieldValue: (path, value) => {
      store.values = setIn(store.values, toSegments(path), value);
      store.onChange?.();
      notify();
    },
    validateFields: () => {
      for (const [key, rules] of store.rules.entries()) {
        const segments = key.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
        const value = getIn(store.values, segments);
        for (const rule of rules) {
          if (rule.required && (value === undefined || value === null || value === '')) {
            return Promise.reject(new Error(rule.message || '请填写必填项'));
          }
          if (rule.pattern && typeof value === 'string' && value && !rule.pattern.test(value)) {
            return Promise.reject(new Error(rule.message || '格式不正确'));
          }
          if (rule.max !== undefined && typeof value === 'string' && value.length > rule.max) {
            return Promise.reject(new Error(rule.message || `不能超过 ${rule.max} 字`));
          }
        }
      }
      return Promise.resolve(store.values);
    },
    resetFields: () => {
      store.values = {};
      notify();
    },
    registerRules: (path, rules) => {
      store.rules.set(pathKey(path), rules);
    },
    subscribe: (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
  }), [store, notify]);
}

/** Subscribe to a single field value, re-rendering only the caller (antd Form.useWatch replacement). */
export function useFormWatch(form: StudioFormShim, path: FieldPath): any {
  const [value, setValue] = React.useState(() => form.getFieldValue(path));
  React.useEffect(() => {
    const update = () => setValue(form.getFieldValue(path));
    update();
    return form.subscribe(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, pathKey(path)]);
  return value;
}

// ---------------------------------------------------------------------------
// Controlled form primitives bound to the shim by field path.
// These replace antd `Form.Item` + control pairs while keeping the same flat
// values shape (field names / nesting) that the contract payload expects.
// ---------------------------------------------------------------------------

export interface Option {
  value: string;
  label: string;
}

interface FieldShellProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Lightweight label wrapper matching the layout `Field` primitive. */
export function StudioField({ label, hint, required, className, children }: FieldShellProps) {
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      {children}
    </Field>
  );
}

interface BoundProps {
  form: StudioFormShim;
  name: FieldPath;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function StudioInput({ form, name, label, hint, required, ...rest }: BoundProps) {
  const value = useFormWatch(form, name);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <Input
        value={value ?? ''}
        onChange={(event) => form.setFieldValue(name, event.target.value)}
        disabled={rest.disabled}
        placeholder={rest.placeholder}
        className={rest.className}
      />
    </StudioField>
  );
}

export function StudioTextarea({
  form,
  name,
  label,
  hint,
  required,
  rows = 3,
  ...rest
}: BoundProps & { rows?: number }) {
  const value = useFormWatch(form, name);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <Textarea
        rows={rows}
        value={value ?? ''}
        onChange={(event) => form.setFieldValue(name, event.target.value)}
        disabled={rest.disabled}
        placeholder={rest.placeholder}
        className={rest.className}
      />
    </StudioField>
  );
}

export function StudioNumber({
  form,
  name,
  label,
  hint,
  required,
  min,
  max,
  step,
  ...rest
}: BoundProps & { min?: number; max?: number; step?: number }) {
  const value = useFormWatch(form, name);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <NumberInput
        value={value ?? null}
        min={min}
        max={max}
        step={step}
        disabled={rest.disabled}
        placeholder={rest.placeholder}
        onChange={(next) => form.setFieldValue(name, next)}
      />
    </StudioField>
  );
}

export function StudioSwitch({ form, name, label, hint, disabled }: BoundProps) {
  const value = useFormWatch(form, name);
  return (
    <div className="space-y-1.5">
      {label ? <div className="text-sm font-medium text-foreground">{label}</div> : null}
      <div className="flex h-9 items-center">
        <Switch
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked) => form.setFieldValue(name, checked)}
        />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface StudioSelectProps extends BoundProps {
  options: Option[];
  allowClear?: boolean;
}

/** Single-value select bound to the shim. */
export function StudioSelect({
  form,
  name,
  label,
  hint,
  required,
  options,
  allowClear,
  disabled,
  placeholder,
}: StudioSelectProps) {
  const raw = useFormWatch(form, name);
  const value = raw === undefined || raw === null ? '' : String(raw);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <div className="relative">
        <Select
          value={value || undefined}
          disabled={disabled}
          onValueChange={(next) => form.setFieldValue(name, next)}
        >
          <SelectTrigger className={cn(allowClear && value && 'pr-9')}>
            <SelectValue placeholder={placeholder || '请选择'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allowClear && value && !disabled ? (
          <button
            type="button"
            aria-label="清除"
            className="absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => form.setFieldValue(name, null)}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    </StudioField>
  );
}

interface MultiSelectControlProps {
  value: string[];
  options: Option[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (next: string[]) => void;
}

/** Multi-select from a fixed option list (antd `mode="multiple"`). */
export function MultiSelectControl({
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: MultiSelectControlProps) {
  const [open, setOpen] = React.useState(false);
  const selected = value || [];
  const labelFor = (val: string) => options.find((option) => option.value === val)?.label || val;
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((item) => item !== val) : [...selected, val]);
  };
  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm shadow-sm transition-colors',
            'focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className="flex flex-1 flex-wrap gap-1">
            {selected.length ? (
              selected.map((val) => (
                <Badge key={val} variant="secondary" className="gap-1">
                  {labelFor(val)}
                  {!disabled ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="cursor-pointer opacity-70 hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(val);
                      }}
                    >
                      <X className="size-3" />
                    </span>
                  ) : null}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">{placeholder || '请选择'}</span>
            )}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1.5" align="start">
        {options.length ? (
          options.map((option) => {
            const active = selected.includes(option.value);
            return (
              <button
                type="button"
                key={option.value}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                  'hover:bg-accent hover:text-accent-foreground',
                  active && 'bg-accent/60',
                )}
                onClick={() => toggle(option.value)}
              >
                <span className="flex size-4 items-center justify-center">
                  {active ? <Check className="size-4" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })
        ) : (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">暂无可选项</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function StudioMultiSelect({
  form,
  name,
  label,
  hint,
  required,
  options,
  disabled,
  placeholder,
}: StudioSelectProps) {
  const value = useFormWatch(form, name);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <MultiSelectControl
        value={value || []}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(next) => form.setFieldValue(name, next)}
      />
    </StudioField>
  );
}

interface TagsControlProps {
  value: string[];
  options?: Option[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (next: string[]) => void;
}

/** Free-form tag entry with optional suggestions (antd `mode="tags"`). */
export function TagsControl({ value, options, disabled, placeholder, onChange }: TagsControlProps) {
  const [draft, setDraft] = React.useState('');
  const tags = value || [];
  const addTag = (raw: string) => {
    const tokens = raw.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    if (!tokens.length) return;
    const next = [...tags];
    for (const token of tokens) {
      if (!next.includes(token)) next.push(token);
    }
    onChange(next);
    setDraft('');
  };
  const removeTag = (tag: string) => onChange(tags.filter((item) => item !== tag));
  const labelFor = (val: string) => options?.find((option) => option.value === val)?.label || val;
  const suggestions = (options || []).filter((option) => !tags.includes(option.value));
  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-card px-2 py-1.5 text-sm shadow-sm',
        'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1">
          {labelFor(tag)}
          {!disabled ? (
            <span
              role="button"
              tabIndex={-1}
              className="cursor-pointer opacity-70 hover:opacity-100"
              onClick={() => removeTag(tag)}
            >
              <X className="size-3" />
            </span>
          ) : null}
        </Badge>
      ))}
      <input
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        value={draft}
        disabled={disabled}
        placeholder={tags.length ? '' : placeholder || '输入后回车'}
        onChange={(event) => {
          const raw = event.target.value;
          if (/[,，]/.test(raw)) {
            addTag(raw);
          } else {
            setDraft(raw);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addTag(draft);
          } else if (event.key === 'Backspace' && !draft && tags.length) {
            removeTag(tags[tags.length - 1]);
          }
        }}
        onBlur={() => addTag(draft)}
      />
      {suggestions.length && !disabled ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="选择建议">
              <ChevronDown className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-h-72 w-56 overflow-y-auto p-1.5" align="end">
            {suggestions.map((option) => (
              <button
                type="button"
                key={option.value}
                className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => addTag(option.value)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

export function StudioTags({
  form,
  name,
  label,
  hint,
  required,
  options,
  disabled,
  placeholder,
}: BoundProps & { options?: Option[] }) {
  const value = useFormWatch(form, name);
  return (
    <StudioField label={label} hint={hint} required={required}>
      <TagsControl
        value={value || []}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(next) => form.setFieldValue(name, next)}
      />
    </StudioField>
  );
}

/** Register validation rules once on mount (used to mark required fields + submit validation). */
export function useRegisterRules(form: StudioFormShim, name: FieldPath, rules: ValidationRule[]) {
  React.useEffect(() => {
    form.registerRules(name, rules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, pathKey(name)]);
}

interface FieldListApi<T = any> {
  /** Current items (live array). */
  items: T[];
  /** Append an item. */
  add: (initial?: T) => void;
  /** Remove the item at `index`. */
  remove: (index: number) => void;
}

/** Dynamic array helper replacing antd `Form.List`. */
export function useFieldList<T = any>(form: StudioFormShim, name: FieldPath): FieldListApi<T> {
  const items: T[] = useFormWatch(form, name) || [];
  return {
    items,
    add: (initial) => {
      const current: T[] = form.getFieldValue(name) || [];
      form.setFieldValue(name, [...current, initial as T]);
    },
    remove: (index) => {
      const current: T[] = form.getFieldValue(name) || [];
      form.setFieldValue(name, current.filter((_, i) => i !== index));
    },
  };
}
