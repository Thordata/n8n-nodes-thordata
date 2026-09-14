import {
  findEngine,
  type SerpEngineSchema,
  type SerpFieldSchema,
  type SerpSchema,
} from './schema';

export type SerpParams = Record<string, string | number | boolean | undefined | null>;
export type ParamsJsonInput = string | Record<string, unknown> | undefined | null;

export interface BuildSerpParamsInput {
  readonly schema: SerpSchema;
  readonly engine: string;
  readonly values: Record<string, unknown>;
  readonly extraParameters?: ParamsJsonInput;
  readonly linkedUule?: unknown;
  readonly multiValues?: Record<string, unknown>;
}

export interface BuildSerpRequestOptionsInput {
  readonly endpoint: string;
  readonly params: SerpParams;
}

export interface SerpRequestOptions {
  readonly method: 'POST';
  readonly url: string;
  readonly headers: {
    readonly Accept: 'application/json';
    readonly 'Content-Type': 'application/x-www-form-urlencoded';
    readonly Origin: 'n8n';
    readonly platform: 'n8n';
    readonly 'api-source': 'sdk';
  };
  readonly body: string;
  readonly json: true;
  readonly timeout: 120_000;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
// Dashboard 对 cr / lr 的多值都用 join("|")，其余数组字段用逗号
const PIPE_JOINED_ARRAY_KEYS = new Set(['cr', 'lr']);
const UULE_LENGTH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const AUTO_UULE_ENGINES = new Set([
  'google',
  'google_ai_mode',
  'google_web',
  'google_shopping',
  'google_local',
  'google_videos',
  'google_images',
  'google_jobs',
  'bing',
]);

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isBlank(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

interface InspectedProperty {
  readonly key: string;
  readonly value: unknown;
  readonly enumerable: boolean;
}

const SAFE_ERROR_KEY = /^[A-Za-z0-9_.-]{1,64}$/u;

function childInspectionPath(path: string, key: string, array: boolean): string {
  if (array && /^\d+$/u.test(key)) return `${path}[${key}]`;
  return SAFE_ERROR_KEY.test(key) ? `${path}.${key}` : `${path}.[property]`;
}

function inspectOwnProperties(value: object, path: string): readonly InspectedProperty[] {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new Error(`${path} cannot be safely inspected`);
  }

  const properties: InspectedProperty[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') throw new Error(`${path} contains a symbol key`);
    if (Array.isArray(value) && key === 'length') continue;
    if (DANGEROUS_KEYS.has(key)) throw new Error(`${path} contains dangerous key ${key}`);

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new Error(`${path} cannot be safely inspected`);
    }
    if (!descriptor) throw new Error(`${path} cannot be safely inspected`);
    if (!hasOwn(descriptor, 'value')) throw new Error(`${path} contains an accessor property`);
    if (key === 'toJSON' && typeof descriptor.value === 'function') {
      throw new Error(`${path} contains a custom toJSON function`);
    }
    properties.push({ key, value: descriptor.value, enumerable: descriptor.enumerable ?? false });
  }
  return properties;
}

function inspectSafeJson(
  value: unknown,
  path: string,
  active = new WeakSet<object>(),
  completed = new WeakSet<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${path} contains an unsupported ${typeof value} value`);
  if (!Array.isArray(value) && !isPlainRecord(value)) throw new Error(`${path} contains a non-plain object`);
  if (active.has(value)) throw new Error(`${path} contains a cycle`);
  if (completed.has(value)) return;

  active.add(value);
  for (const property of inspectOwnProperties(value, path)) {
    inspectSafeJson(
      property.value,
      childInspectionPath(path, property.key, Array.isArray(value)),
      active,
      completed,
    );
  }
  active.delete(value);
  completed.add(value);
}

function inspectStructure(
  value: unknown,
  path: string,
  active = new WeakSet<object>(),
  completed = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== 'object') return;
  if (active.has(value)) throw new Error(`${path} contains a cycle`);
  if (completed.has(value)) return;

  active.add(value);
  for (const property of inspectOwnProperties(value, path)) {
    inspectStructure(
      property.value,
      childInspectionPath(path, property.key, Array.isArray(value)),
      active,
      completed,
    );
  }
  active.delete(value);
  completed.add(value);
}

function emptyRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

export function parseExtraParameters(input: ParamsJsonInput): Record<string, unknown> {
  if (input === undefined || (typeof input === 'string' && input.trim() === '')) return emptyRecord();
  if (input === null) throw new Error('Extra Parameters JSON must be an object');

  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch {
      throw new Error('Extra Parameters JSON is invalid JSON');
    }
  }

  if (!isPlainRecord(parsed)) throw new Error('Extra Parameters JSON must be an object');
  inspectStructure(parsed, 'Extra Parameters JSON');

  const result = emptyRecord();
  for (const property of inspectOwnProperties(parsed, 'Extra Parameters JSON')) {
    if (property.enumerable) result[property.key] = property.value;
  }
  return result;
}

function invalidKnown(field: SerpFieldSchema, engine: string, reason: string): never {
  throw new Error(`Invalid SERP parameter ${field.key} for engine ${engine}: ${reason}`);
}

function normalizeScalar(value: unknown, field: SerpFieldSchema, engine: string): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return invalidKnown(field, engine, 'expected a string, finite number, or boolean');
}

function normalizeBoolean(value: unknown, field: SerpFieldSchema, engine: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return invalidKnown(field, engine, 'expected a boolean');
}

function normalizeNumber(value: unknown, field: SerpFieldSchema, engine: string): number {
  if (typeof value === 'boolean') return invalidKnown(field, engine, 'expected a finite number');
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(normalized)) return invalidKnown(field, engine, 'expected a finite number');
  return normalized;
}

function normalizeArrayEntry(value: unknown, field: SerpFieldSchema, engine: string): string {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/[\u0000-\u001f\u007f]/.test(normalized)) {
      return invalidKnown(field, engine, 'array entries cannot contain control characters');
    }
    return normalized;
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return invalidKnown(field, engine, 'array entries must be scalar values');
}

function normalizeCountry(value: string): string {
  if (/^[a-z]{2}$/i.test(value)) return `country${value.toUpperCase()}`;
  const country = /^country([a-z]{2})$/i.exec(value);
  return country ? `country${country[1].toUpperCase()}` : value;
}

function normalizeArray(value: unknown, field: SerpFieldSchema, engine: string): string {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(normalized) as unknown;
      } catch {
        return invalidKnown(field, engine, 'expected a JSON array or comma-separated values');
      }
      if (!Array.isArray(parsed)) return invalidKnown(field, engine, 'expected a JSON array');
      entries = parsed;
    } else {
      entries = normalized.split(',');
    }
  } else {
    entries = [value];
  }

  const normalized = entries
    .map((entry) => normalizeArrayEntry(entry, field, engine))
    .filter((entry) => entry !== '');
  const serialized = field.key === 'cr' ? normalized.map(normalizeCountry) : normalized;
  return serialized.join(PIPE_JOINED_ARRAY_KEYS.has(field.key) ? '|' : ',');
}

function normalizeObject(value: unknown, field: SerpFieldSchema, engine: string): string {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value.trim()) as unknown;
    } catch {
      return invalidKnown(field, engine, 'expected a JSON object');
    }
  }
  if (!isPlainRecord(parsed)) return invalidKnown(field, engine, 'expected a plain object');
  try {
    inspectSafeJson(parsed, `SERP parameter ${field.key}`);
    return JSON.stringify(parsed);
  } catch {
    return invalidKnown(field, engine, 'value is not JSON-safe');
  }
}

function normalizeKnown(value: unknown, field: SerpFieldSchema, engine: string): string | number | boolean {
  let normalized: string | number | boolean;
  switch (field.type) {
    case 'boolean':
      normalized = normalizeBoolean(value, field, engine);
      break;
    case 'number':
      normalized = normalizeNumber(value, field, engine);
      break;
    case 'array':
      normalized = normalizeArray(value, field, engine);
      break;
    case 'object':
      normalized = normalizeObject(value, field, engine);
      break;
    case 'options':
    case 'string':
      normalized = normalizeScalar(value, field, engine);
      break;
    default:
      return invalidKnown(field, engine, `unsupported schema type ${String(field.type)}`);
  }
  if (field.key !== 'cr') return normalized;
  const serialized = String(normalized);
  if (/[\u0000-\u001f\u007f]/.test(serialized)) {
    return invalidKnown(field, engine, 'country restriction cannot contain control characters');
  }
  return normalizeCountry(serialized);
}

function invalidExtra(key: string): never {
  const label = SAFE_ERROR_KEY.test(key) ? ` ${key}` : '';
  throw new Error(`Invalid Extra Parameter${label}: value is not JSON-safe`);
}

function normalizeUnknown(value: unknown, key: string): string | number | boolean {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value !== null && typeof value === 'object') {
    try {
      inspectSafeJson(value, `Extra Parameter ${key}`);
      return JSON.stringify(value);
    } catch {
      return invalidExtra(key);
    }
  }
  return invalidExtra(key);
}

function applyKnown(
  params: SerpParams,
  field: SerpFieldSchema,
  engine: string,
  value: unknown,
): void {
  if (isBlank(value)) {
    delete params[field.key];
    return;
  }
  const normalized = normalizeKnown(value, field, engine);
  if (isBlank(normalized)) delete params[field.key];
  else params[field.key] = normalized;
}

function resolveMapperDefault(field: SerpFieldSchema, value: unknown): unknown {
  if (
    field.type === 'number'
    && typeof field.defaultValue === 'number'
    && field.defaultValue > 0
    && (value === 0 || value === '0')
  ) {
    return field.defaultValue;
  }
  return value;
}

function applyExtra(
  params: SerpParams,
  selected: SerpEngineSchema,
  extra: Record<string, unknown>,
): void {
  const fields = new Map(selected.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(extra)) {
    if (key === 'engine' || key === 'isjson') continue;
    const value = extra[key];
    if (isBlank(value)) {
      delete params[key];
      continue;
    }
    const known = fields.get(key);
    params[key] = known ? normalizeKnown(value, known, selected.key) : normalizeUnknown(value, key);
  }
}

function isPresent(params: SerpParams, key: string): boolean {
  return hasOwn(params, key) && !isBlank(params[key]);
}

function validateParams(selected: SerpEngineSchema, params: SerpParams): void {
  for (const field of selected.fields) {
    if (field.required && !isPresent(params, field.key)) {
      throw new Error(`SERP engine ${selected.key} required field ${field.key} is missing`);
    }
  }
  for (const rule of selected.validationRules) {
    const presentCount = rule.fields.filter((key) => {
      if (!isPresent(params, key)) return false;
      const field = selected.fields.find((candidate) => candidate.key === key);
      const value = params[key];
      if (rule.type === 'mutually_exclusive' && field?.type === 'boolean' && value === false) {
        return false;
      }
      if (
        rule.type === 'mutually_exclusive'
        && field?.type === 'options'
        && typeof value === 'string'
        && ['false', '0', 'off'].includes(value.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    }).length;
    const failed = rule.type === 'required_any_of' ? presentCount === 0 : presentCount > 1;
    if (failed) {
      throw new Error(
        `SERP engine ${selected.key} validation ${rule.type} failed for fields ${rule.fields.join(', ')}`,
      );
    }
  }
}

function removeDisabledMutuallyExclusiveValues(
  selected: SerpEngineSchema,
  params: SerpParams,
): void {
  const fields = new Map(selected.fields.map((field) => [field.key, field]));
  for (const rule of selected.validationRules) {
    if (rule.type !== 'mutually_exclusive') continue;
    for (const key of rule.fields) {
      const field = fields.get(key);
      const value = params[key];
      if (
        (field?.type === 'boolean' && value === false)
        || (
          field?.type === 'options'
          && typeof value === 'string'
          && ['false', '0', 'off'].includes(value.trim().toLowerCase())
        )
      ) {
        delete params[key];
      }
    }
  }
}

export function encodeUuleLocation(location: string): string {
  const normalized = location.trim();
  if (normalized === '') return '';
  const bytes = Buffer.allocUnsafe(normalized.length);
  for (let index = 0; index < normalized.length; index += 1) {
    const codeUnit = normalized.charCodeAt(index);
    if (codeUnit > 0xff) throw new Error('UULE location must contain Latin-1 characters');
    bytes[index] = codeUnit;
  }
  const lengthCharacter = UULE_LENGTH_ALPHABET[normalized.length % UULE_LENGTH_ALPHABET.length];
  const encoded = bytes
    .toString('base64')
    .replace(/=+$/u, '');
  return `w+CAIQICI${lengthCharacter}${encoded}`;
}

export function buildSerpParams(input: BuildSerpParamsInput): SerpParams {
  const selected = findEngine(input.schema, input.engine);
  const params = Object.create(null) as SerpParams;

  for (const field of selected.fields) {
    if (field.visible && hasOwn(field, 'defaultValue') && !isBlank(field.defaultValue)) {
      applyKnown(params, field, selected.key, field.defaultValue);
    }
  }
  for (const field of selected.fields) {
    if (field.visible && hasOwn(input.values, field.key)) {
      applyKnown(params, field, selected.key, resolveMapperDefault(field, input.values[field.key]));
    }
  }
  // 顶层多选属性（cr / lr）：只在用户实际选了值时才生效，
  // 空数组不覆盖 mapper 或旧工作流里已有的值
  if (input.multiValues) {
    for (const [key, value] of Object.entries(input.multiValues)) {
      if (isBlank(value)) continue;
      const field = selected.fields.find(
        (candidate) => candidate.key === key && candidate.visible,
      );
      if (field) applyKnown(params, field, selected.key, value);
    }
  }
  let extra: Record<string, unknown>;
  try {
    extra = parseExtraParameters(input.extraParameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'contains invalid data';
    const cycle = /^Extra Parameters JSON\.([^.\[]+).* contains a cycle$/.exec(message);
    if (cycle) {
      const field = selected.fields.find((candidate) => candidate.key === cycle[1]);
      if (field) invalidKnown(field, selected.key, message);
      throw new Error(`Invalid Extra Parameter ${cycle[1]}: ${message}`);
    }
    throw error;
  }
  applyExtra(params, selected, extra);
  const acceptsLinkedUule = selected.fields.some((field) => field.key === 'uule' && field.visible);
  if (acceptsLinkedUule && !isPresent(params, 'uule') && typeof input.linkedUule === 'string' && input.linkedUule.trim() !== '') {
    params.uule = input.linkedUule.trim();
  }
  removeDisabledMutuallyExclusiveValues(selected, params);

  params.engine = selected.key;
  params.isjson = 1;
  if (!isPresent(params, 'json')) params.json = '1';
  if (String(params.json) === '5') params.render_js = true;

  if (
    AUTO_UULE_ENGINES.has(selected.key)
    && !isPresent(params, 'uule')
    && isPresent(params, 'location')
  ) {
    params.uule = encodeUuleLocation(String(params.location));
  }

  validateParams(selected, params);
  return params;
}

export function toFormUrlEncoded(params: SerpParams): string {
  const encoded = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (!isBlank(value)) encoded.append(key, String(value));
  }
  return encoded.toString();
}

export function buildSerpRequestOptions(input: BuildSerpRequestOptionsInput): SerpRequestOptions {
  const endpoint = input.endpoint.trim();
  if (endpoint === '') throw new Error('Thordata SERP endpoint must not be blank');
  return {
    method: 'POST',
    url: endpoint,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'n8n',
      platform: 'n8n',
      'api-source': 'sdk',
    },
    body: toFormUrlEncoded(input.params),
    json: true,
    timeout: 120_000,
  };
}
