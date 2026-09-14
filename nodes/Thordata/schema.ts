import type {
  FieldType,
  INodePropertyOptions,
  ResourceMapperFields,
} from 'n8n-workflow';

export const SERP_SCHEMA_AUDIENCE = 'is_serp_old=0' as const;

export type SerpSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly SerpSchemaValue[]
  | { readonly [key: string]: SerpSchemaValue };

export interface SerpCondition {
  readonly field: string;
  readonly operator: 'equals' | 'not_equals' | 'in' | 'not_in';
  readonly values: readonly SerpSchemaValue[];
}

export interface SerpValidationRule {
  readonly type: 'required_any_of' | 'mutually_exclusive';
  readonly fields: readonly string[];
}

export interface SerpFieldSchema {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly control: 'input' | 'number' | 'select' | 'multi_select' | 'switch' | 'json';
  readonly visible: boolean;
  readonly required: boolean;
  readonly defaultValue?: SerpSchemaValue;
  readonly placeholder?: string;
  readonly description?: string;
  readonly options?: readonly INodePropertyOptions[];
  readonly showWhen?: SerpCondition;
}

export interface SerpEngineSchema {
  readonly key: string;
  readonly name: string;
  readonly categoryKey: string;
  readonly categoryName: string;
  readonly queryField: string;
  readonly fields: readonly SerpFieldSchema[];
  readonly validationRules: readonly SerpValidationRule[];
}

export interface SerpSchema {
  readonly version: string;
  readonly audience: typeof SERP_SCHEMA_AUDIENCE;
  readonly defaultEngine: string;
  readonly engines: readonly SerpEngineSchema[];
}

export class SerpSchemaValidationError extends Error {
  constructor(message: string) {
    super(`Invalid Thordata SERP schema: ${message}`);
    this.name = 'SerpSchemaValidationError';
  }
}

type RecordValue = Record<string, unknown>;
const CONTROL_TYPES: Record<string, FieldType> = {
  input: 'string',
  number: 'number',
  select: 'options',
  multi_select: 'array',
  switch: 'boolean',
  json: 'object',
};
const CONDITION_OPERATORS = new Set(['equals', 'not_equals', 'in', 'not_in']);
const RULE_TYPES = new Set(['required_any_of', 'mutually_exclusive']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PAYLOAD_KEYS = new Set(['code', 'msg', 'data']);
const DATA_KEYS = new Set(['schema_version', 'audience', 'default_engine', 'categories']);
const CATEGORY_KEYS = new Set(['key', 'name', 'engines']);
const ENGINE_KEYS = new Set(['key', 'name', 'query_field', 'groups', 'validation_rules']);
const GROUP_KEYS = new Set(['key', 'name', 'fields']);
const FIELD_KEYS = new Set([
  'key',
  'label',
  'type',
  'control',
  'visible',
  'required',
  'default_value',
  'placeholder',
  'description',
  'options',
  'show_when',
]);
const OPTION_KEYS = new Set(['label', 'value']);
const CONDITION_KEYS = new Set(['field', 'operator', 'values']);
const RULE_KEYS = new Set(['type', 'fields']);

function fail(path: string, reason: string): never {
  throw new SerpSchemaValidationError(`${path} ${reason}`);
}

function isPlainRecord(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, path: string): RecordValue {
  if (!isPlainRecord(value)) {
    fail(path, value !== null && typeof value === 'object' && !Array.isArray(value) ? 'must be a plain record' : 'must be a record');
  }
  return value;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function requireNonBlankString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-blank string');
  return value;
}

function requireSafeKey(value: unknown, path: string): string {
  const key = requireNonBlankString(value, path);
  if (DANGEROUS_KEYS.has(key)) fail(path, 'contains dangerous key');
  return key;
}

function inspectObjectGraph(
  value: unknown,
  path: string,
  active = new WeakSet<object>(),
  completed = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== 'object' || completed.has(value)) return;
  if (active.has(value)) fail(path, 'contains a cycle');
  active.add(value);
  Object.keys(value).forEach((key) => {
    if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'contains dangerous key');
    const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
    inspectObjectGraph((value as RecordValue)[key], childPath, active, completed);
  });
  active.delete(value);
  completed.add(value);
}

function assertAllowedKeys(record: RecordValue, path: string, allowed: ReadonlySet<string>): void {
  Object.keys(record).forEach((key) => {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'is an unknown key');
  });
}

function validateJsonSafe(value: unknown, path: string, stack = new WeakSet<object>()): asserts value is SerpSchemaValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    fail(path, 'must be JSON-safe');
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) fail(path, 'must be JSON-safe');
    stack.add(value);
    value.forEach((entry, index) => validateJsonSafe(entry, `${path}[${index}]`, stack));
    stack.delete(value);
    return;
  }
  if (isPlainRecord(value)) {
    if (stack.has(value)) fail(path, 'must be JSON-safe');
    stack.add(value);
    Object.keys(value).forEach((key) => {
      if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, 'contains dangerous key');
      validateJsonSafe(value[key], `${path}.${key}`, stack);
    });
    stack.delete(value);
    return;
  }
  fail(path, 'must be JSON-safe');
}

function cloneJsonValue(value: SerpSchemaValue): SerpSchemaValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainRecord(value)) {
    const copy: Record<string, SerpSchemaValue> = Object.create(null) as Record<string, SerpSchemaValue>;
    Object.keys(value).forEach((key) => { copy[key] = cloneJsonValue(value[key] as SerpSchemaValue); });
    return copy;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as RecordValue).forEach((entry) => deepFreeze(entry));
  }
  return value;
}

function requireScalar(value: unknown, path: string): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail(path, 'must be a string, finite number, or boolean');
}

function sameScalarValue(left: string | number | boolean, right: string | number | boolean): boolean {
  return typeof left === typeof right && left === right;
}

function validateDefault(
  value: unknown,
  field: { type: FieldType; control: string; options: readonly INodePropertyOptions[] },
  path: string,
): SerpSchemaValue | undefined {
  if (value === null) return undefined;
  validateJsonSafe(value, path);
  switch (field.type) {
    case 'string':
      if (typeof value !== 'string') fail(path, 'does not match type string');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'does not match type number');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail(path, 'does not match type boolean');
      break;
    case 'options': {
      const scalar = requireScalar(value, path);
      if (!field.options.some((option) => sameScalarValue(option.value, scalar))) {
        fail(path, 'does not match an option');
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) fail(path, 'does not match type array');
      value.forEach((entry, index) => {
        const entryPath = `${path}[${index}]`;
        if (entry === null || (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean')) {
          fail(entryPath, 'must be a JSON-safe scalar');
        }
        const scalar = requireScalar(entry, entryPath);
        if (field.options.length > 0 && !field.options.some((option) => sameScalarValue(option.value, scalar))) {
          fail(entryPath, 'does not match an option');
        }
      });
      break;
    case 'object':
      if (!isPlainRecord(value)) fail(path, 'does not match type object');
      break;
    default:
      fail(path, 'has unsupported type');
  }
  return cloneJsonValue(value);
}

export function normalizeSerpSchema(payload: unknown): SerpSchema {
  inspectObjectGraph(payload, 'payload');
  const root = requireRecord(payload, 'payload');
  assertAllowedKeys(root, 'payload', PAYLOAD_KEYS);
  if (Object.prototype.hasOwnProperty.call(root, 'msg') && typeof root.msg !== 'string') {
    fail('payload.msg', 'must be a string');
  }
  if (typeof root.code !== 'number' || root.code !== 0 || !Number.isFinite(root.code)) {
    fail('payload.code', 'must be the number 0');
  }
  const data = requireRecord(root.data, 'payload.data');
  assertAllowedKeys(data, 'data', DATA_KEYS);
  const version = requireNonBlankString(data.schema_version, 'data.schema_version');
  const audience = requireNonBlankString(data.audience, 'data.audience');
  if (audience !== SERP_SCHEMA_AUDIENCE) fail('data.audience', `must equal ${SERP_SCHEMA_AUDIENCE}`);
  const defaultEngine = requireNonBlankString(data.default_engine, 'data.default_engine');
  const categories = requireArray(data.categories, 'data.categories');
  const categoryKeys = new Set<string>();
  const engineKeys = new Set<string>();
  const engines: SerpEngineSchema[] = [];

  categories.forEach((categoryValue, categoryIndex) => {
    const categoryPath = `data.categories[${categoryIndex}]`;
    const category = requireRecord(categoryValue, categoryPath);
    assertAllowedKeys(category, categoryPath, CATEGORY_KEYS);
    const categoryKey = requireSafeKey(category.key, `${categoryPath}.key`);
    const categoryName = requireNonBlankString(category.name, `${categoryPath}.name`);
    if (categoryKeys.has(categoryKey)) fail(`data.categories[${categoryIndex}].key`, `duplicates category key ${categoryKey}`);
    categoryKeys.add(categoryKey);
    const categoryEngines = requireArray(category.engines, `data.categories[${categoryIndex}].engines`);
    categoryEngines.forEach((engineValue, engineIndex) => {
      const enginePath = `data.categories[${categoryIndex}].engines[${engineIndex}]`;
      const engine = requireRecord(engineValue, enginePath);
      assertAllowedKeys(engine, enginePath, ENGINE_KEYS);
      const key = requireSafeKey(engine.key, `${enginePath}.key`);
      const name = requireNonBlankString(engine.name, `${enginePath}.name`);
      const queryField = requireNonBlankString(engine.query_field, `${enginePath}.query_field`);
      if (engineKeys.has(key)) fail(`${enginePath}.key`, `duplicates engine key ${key}`);
      engineKeys.add(key);
      const groups = requireArray(engine.groups, `${enginePath}.groups`);
      const groupKeys = new Set<string>();
      const fieldKeys = new Set<string>();
      const fieldPaths = new Map<string, string>();
      const fields: SerpFieldSchema[] = [];
      groups.forEach((groupValue, groupIndex) => {
        const groupPath = `${enginePath}.groups[${groupIndex}]`;
        const group = requireRecord(groupValue, groupPath);
        assertAllowedKeys(group, groupPath, GROUP_KEYS);
        const groupKey = requireSafeKey(group.key, `${groupPath}.key`);
        requireNonBlankString(group.name, `${groupPath}.name`);
        if (groupKeys.has(groupKey)) fail(`${groupPath}.key`, `duplicates group key ${groupKey}`);
        groupKeys.add(groupKey);
        const groupFields = requireArray(group.fields, `${groupPath}.fields`);
        groupFields.forEach((fieldValue, fieldIndex) => {
          const fieldPath = `${groupPath}.fields[${fieldIndex}]`;
          const field = requireRecord(fieldValue, fieldPath);
          assertAllowedKeys(field, fieldPath, FIELD_KEYS);
          const fieldKey = requireSafeKey(field.key, `${fieldPath}.key`);
          const label = requireNonBlankString(field.label, `${fieldPath}.label`);
          const control = typeof field.control === 'string' && field.control.trim() !== ''
            ? field.control
            : fail(`${fieldPath}.control`, 'is unsupported (must be a non-blank string)');
          const type = typeof field.type === 'string' && field.type.trim() !== ''
            ? field.type
            : fail(`${fieldPath}.type`, 'is unsupported (must be a non-blank string)');
          if (!(control in CONTROL_TYPES)) fail(`${fieldPath}.control`, 'is unsupported');
          if (!(type in { string: true, number: true, options: true, array: true, boolean: true, object: true })) fail(`${fieldPath}.type`, 'is unsupported');
          if (CONTROL_TYPES[control] !== type) fail(`${fieldPath}.control`, `control ${control} requires type ${CONTROL_TYPES[control]}`);
          if (fieldKeys.has(fieldKey)) fail(`${fieldPath}.key`, `duplicates field key ${fieldKey}`);
          fieldKeys.add(fieldKey);
          fieldPaths.set(fieldKey, fieldPath);
          if (typeof field.visible !== 'boolean') fail(`${fieldPath}.visible`, 'must be a boolean');
          if (typeof field.required !== 'boolean') fail(`${fieldPath}.required`, 'must be a boolean');
          if (field.required && !field.visible) fail(`${fieldPath}`, 'cannot be required and invisible');
          const hasOptions = field.options !== undefined;
          const isOptionControl = control === 'select' || control === 'multi_select';
          const optionsRaw = hasOptions ? requireArray(field.options, `${fieldPath}.options`) : [];
          if (isOptionControl && optionsRaw.length === 0) fail(`${fieldPath}.options`, 'requires non-empty options');
          if (!isOptionControl && hasOptions) fail(`${fieldPath}.control`, `control ${control} cannot have options`);
          const optionValues = new Set<string | number | boolean>();
          const options: INodePropertyOptions[] = [];
          optionsRaw.forEach((optionValue, optionIndex) => {
            const optionPath = `${fieldPath}.options[${optionIndex}]`;
            const option = requireRecord(optionValue, optionPath);
            assertAllowedKeys(option, optionPath, OPTION_KEYS);
            const optionLabel = requireNonBlankString(option.label, `${optionPath}.label`);
            const optionValueScalar = requireScalar(option.value, `${optionPath}.value`);
            if (optionValues.has(optionValueScalar)) {
              fail(`${optionPath}.value`, 'duplicate typed option value');
            }
            optionValues.add(optionValueScalar);
            options.push({ name: optionLabel, value: optionValueScalar });
          });
          const defaultValue = Object.prototype.hasOwnProperty.call(field, 'default_value')
            ? validateDefault(field.default_value, { type: type as FieldType, control, options }, `${fieldPath}.default_value`)
            : undefined;
          let showWhen: SerpCondition | undefined;
          if (field.show_when !== undefined) {
            const conditionPath = `${fieldPath}.show_when`;
            const condition = requireRecord(field.show_when, conditionPath);
            assertAllowedKeys(condition, conditionPath, CONDITION_KEYS);
            const conditionField = requireNonBlankString(condition.field, `${conditionPath}.field`);
            const operator = requireNonBlankString(condition.operator, `${conditionPath}.operator`);
            if (!CONDITION_OPERATORS.has(operator)) fail(`${conditionPath}.operator`, 'is unsupported');
            const values = requireArray(condition.values, `${conditionPath}.values`);
            if (values.length === 0) fail(`${conditionPath}.values`, 'must be non-empty');
            values.forEach((entry, index) => {
              if ((typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean' && entry !== null) || (typeof entry === 'number' && !Number.isFinite(entry))) {
                fail(`${conditionPath}.values[${index}]`, 'must be a JSON-safe scalar');
              }
            });
            showWhen = {
              field: conditionField,
              operator: operator as SerpCondition['operator'],
              values: values.map((entry) => cloneJsonValue(entry as SerpSchemaValue)),
            };
          }
          if (field.placeholder !== undefined && typeof field.placeholder !== 'string') {
            fail(`${fieldPath}.placeholder`, 'must be a string');
          }
          if (field.description !== undefined && typeof field.description !== 'string') {
            fail(`${fieldPath}.description`, 'must be a string');
          }
          fields.push({
            key: fieldKey,
            label,
            type: type as FieldType,
            control: control as SerpFieldSchema['control'],
            visible: field.visible,
            required: field.required,
            ...(defaultValue === undefined ? {} : { defaultValue }),
            ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
            ...(field.description === undefined ? {} : { description: field.description }),
            ...(options.length === 0 ? {} : { options }),
            ...(showWhen === undefined ? {} : { showWhen }),
          });
        });
      });
      fields.forEach((field) => {
        if (field.showWhen && !fieldKeys.has(field.showWhen.field)) {
          fail(`${fieldPaths.get(field.key)}.show_when.field`, `references unknown field ${field.showWhen.field}`);
        }
      });
      if (!fieldKeys.has(queryField)) fail(`${enginePath}.query_field`, `references unknown field ${queryField}`);
      const rulesRaw = engine.validation_rules === undefined ? [] : requireArray(engine.validation_rules, `${enginePath}.validation_rules`);
      const validationRules: SerpValidationRule[] = rulesRaw.map((ruleValue, ruleIndex) => {
        const rulePath = `${enginePath}.validation_rules[${ruleIndex}]`;
        const rule = requireRecord(ruleValue, rulePath);
        assertAllowedKeys(rule, rulePath, RULE_KEYS);
        const ruleType = requireNonBlankString(rule.type, `${rulePath}.type`);
        if (!RULE_TYPES.has(ruleType)) fail(`${rulePath}.type`, 'is unsupported');
        const ruleFields = requireArray(rule.fields, `${rulePath}.fields`);
        if (ruleFields.length < 2) fail(`${rulePath}.fields`, 'requires at least two distinct fields');
        const seen = new Set<string>();
        const normalizedFields = ruleFields.map((fieldValue, fieldIndex) => {
          const fieldName = requireNonBlankString(fieldValue, `${rulePath}.fields[${fieldIndex}]`);
          if (!fieldKeys.has(fieldName)) fail(`${rulePath}.fields[${fieldIndex}]`, `references unknown field ${fieldName}`);
          if (seen.has(fieldName)) fail(`${rulePath}.fields`, `repeats field ${fieldName}`);
          seen.add(fieldName);
          return fieldName;
        });
        return { type: ruleType as SerpValidationRule['type'], fields: normalizedFields };
      });
      engines.push({ key, name, categoryKey, categoryName, queryField, fields, validationRules });
    });
  });
  if (engines.length === 0) fail('data.categories', 'must contain at least one engine');
  if (!engineKeys.has(defaultEngine)) fail('data.default_engine', `references unknown engine ${defaultEngine}`);
  return deepFreeze({ version, audience: SERP_SCHEMA_AUDIENCE, defaultEngine, engines });
}

export function findEngine(schema: SerpSchema, engine: string): SerpEngineSchema {
  const found = schema.engines.find((candidate) => candidate.key === engine);
  if (!found) throw new Error(`Thordata SERP engine not found: ${engine}`);
  return found;
}

export function toOperationOptions(schema: SerpSchema): INodePropertyOptions[] {
  return schema.engines.map((engine) => ({ name: `${engine.categoryName}: ${engine.name}`, value: engine.key }));
}

function mapperDefault(field: SerpFieldSchema): string | number | boolean | undefined {
  const value = field.defaultValue;
  if (value === null || value === undefined || Array.isArray(value) || typeof value === 'object') return undefined;
  if (field.type === 'string' && typeof value === 'string') return value;
  if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (field.type === 'boolean' && typeof value === 'boolean') return value;
  if (field.type === 'options' && field.options?.some((option) => sameScalarValue(option.value, value))) return value;
  return undefined;
}

type ResourceMapperFieldWithDefault = ResourceMapperFields['fields'][number] & {
  defaultValue?: string | number | boolean;
};

// n8n 的 resourceMapper 只能存标量：编辑器把非 string/number/boolean 的值写成 null
// （isResourceMapperValue 只接受这三种 typeof），所以多选字段不进 mapper，
// 由节点顶层属性单独渲染（见 Thordata.node.ts 的 multiOptions 属性）。
export function isMultiValueField(field: SerpFieldSchema): boolean {
  return field.control === 'multi_select';
}

export function toResourceMapperFields(schema: SerpSchema, engine: string): ResourceMapperFields {
  const selected = findEngine(schema, engine);
  const fields: ResourceMapperFieldWithDefault[] = selected.fields
    .filter((field) => field.visible === true && field.key !== 'uule' && !isMultiValueField(field))
    .map((field) => {
      const mapped: ResourceMapperFieldWithDefault = {
        id: field.key,
        displayName: field.label,
        defaultMatch: false,
        canBeUsedToMatch: false,
        required: field.required,
        display: true,
        type: field.type,
      };
      const defaultValue = mapperDefault(field);
      if (defaultValue !== undefined) mapped.defaultValue = defaultValue;
      if (field.options) mapped.options = field.options.map((option) => ({ ...option }));
      return mapped;
    });
  return { fields };
}
