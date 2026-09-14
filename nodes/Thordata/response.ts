import type { SerpParams } from './request';
import type { SerpEngineSchema } from './schema';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface NormalizedSerpResponse {
  readonly engine: string;
  readonly query: string | number | boolean | null;
  readonly taskId?: string;
  readonly result: JsonValue;
}

export interface NormalizeSerpResponseInput {
  readonly engineSchema: SerpEngineSchema;
  readonly params: SerpParams;
  readonly payload: unknown;
}

interface PropertySnapshot {
  readonly key: string;
  readonly descriptor: PropertyDescriptor & { readonly value: unknown };
}

const BUSINESS_CODE_KEYS = ['code', 'error_code', 'status_code'] as const;
const QUERY_FALLBACK_KEYS = [
  'q',
  'text',
  'url',
  'product_id',
  'patent_id',
  'author_id',
  'trend',
] as const;
const UNSAFE_RESPONSE_MESSAGE = 'Thordata SERP response is not JSON-safe';
const OMIT = Symbol('omit undefined object property');
const ARRAY_INDEX = /^(0|[1-9]\d*)$/u;

function unsafeResponse(): never {
  throw new Error(UNSAFE_RESPONSE_MESSAGE);
}

function snapshotProperties(value: object): readonly PropertySnapshot[] {
  const keys = Reflect.ownKeys(value);
  const snapshots: PropertySnapshot[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') unsafeResponse();
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) unsafeResponse();
    snapshots.push({
      key,
      descriptor: descriptor as PropertyDescriptor & { readonly value: unknown },
    });
  }
  return snapshots;
}

function rejectInheritedToJson(prototype: object | null): void {
  if (prototype === null) return;
  const descriptor = Reflect.getOwnPropertyDescriptor(prototype, 'toJSON');
  if (descriptor && (
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    || typeof descriptor.value === 'function'
  )) unsafeResponse();
}

function materializeArray(
  snapshots: readonly PropertySnapshot[],
  active: WeakSet<object>,
): JsonValue[] {
  const byKey = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot.descriptor]));
  const length = byKey.get('length')?.value;
  if (!Number.isSafeInteger(length) || (length as number) < 0) unsafeResponse();

  let indexCount = 0;
  for (const { key } of snapshots) {
    if (!ARRAY_INDEX.test(key)) continue;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= 0xffff_ffff) continue;
    if (index >= (length as number)) unsafeResponse();
    indexCount += 1;
  }
  if (indexCount !== length) unsafeResponse();

  const result: JsonValue[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = byKey.get(String(index));
    const materialized = descriptor
      ? materializeValue(descriptor.value, true, active)
      : null;
    result.push(materialized === OMIT ? null : materialized);
  }
  return result;
}

function materializeObject(
  snapshots: readonly PropertySnapshot[],
  active: WeakSet<object>,
): JsonObject {
  const result = Object.create(null) as Record<string, JsonValue>;
  for (const { key, descriptor } of snapshots) {
    if (!descriptor.enumerable) continue;
    const materialized = materializeValue(descriptor.value, key === 'result', active);
    if (materialized !== OMIT) result[key] = materialized;
  }
  return result;
}

function materializeValue(
  value: unknown,
  undefinedAsNull: boolean,
  active: WeakSet<object>,
): JsonValue | typeof OMIT {
  if (value === undefined) return undefinedAsNull ? null : OMIT;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsafeResponse();
    return value;
  }
  if (typeof value !== 'object') unsafeResponse();
  if (active.has(value)) unsafeResponse();

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    unsafeResponse();
  }
  rejectInheritedToJson(prototype);

  active.add(value);
  const snapshots = snapshotProperties(value);
  if (snapshots.some(({ key, descriptor }) => key === 'toJSON' && typeof descriptor.value === 'function')) {
    unsafeResponse();
  }
  const result = array
    ? materializeArray(snapshots, active)
    : materializeObject(snapshots, active);
  active.delete(value);
  return result;
}

function materializeJsonValue(payload: unknown): JsonValue {
  try {
    const materialized = materializeValue(payload, true, new WeakSet<object>());
    return materialized === OMIT ? null : materialized;
  } catch {
    return unsafeResponse();
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function businessCode(payload: JsonValue): JsonValue | undefined {
  if (!isJsonObject(payload)) return undefined;
  for (const key of BUSINESS_CODE_KEYS) {
    if (hasOwn(payload, key)) return payload[key];
  }
  return undefined;
}

function isSuccessfulCode(code: JsonValue | undefined): boolean {
  return code === undefined || code === 0 || code === '0' || code === 200 || code === '200';
}

function nonblankStringProperty(record: JsonObject, key: string): string | undefined {
  const value = hasOwn(record, key) ? record[key] : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function genericBusinessError(code: unknown): string {
  let sanitizedCode = 'unknown';
  if (code === null) sanitizedCode = 'null';
  else if (typeof code === 'string') sanitizedCode = code;
  else if (typeof code === 'number' || typeof code === 'boolean') sanitizedCode = String(code);
  return `Thordata SERP business error: ${sanitizedCode}`;
}

function businessErrorMessage(payload: JsonObject, code: JsonValue): string {
  for (const key of ['message', 'error', 'msg', 'data']) {
    const message = nonblankStringProperty(payload, key);
    if (message !== undefined) return message;
  }
  return genericBusinessError(code);
}

function throwOnSafeBusinessError(payload: JsonValue, code: JsonValue | undefined): void {
  if (!isJsonObject(payload) || isSuccessfulCode(code)) return;
  throw new Error(businessErrorMessage(payload, code as JsonValue));
}

type BusinessProperty =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unsafe' }
  | { readonly kind: 'value'; readonly value: unknown };

function unknownBusinessError(): never {
  throw new Error(genericBusinessError(undefined));
}

function publicBusinessRecord(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  try {
    if (Array.isArray(payload)) return undefined;
  } catch {
    return unknownBusinessError();
  }
  return payload as Record<string, unknown>;
}

function inspectBusinessProperty(record: object, key: string): BusinessProperty {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(record, key);
  } catch {
    return { kind: 'unsafe' };
  }
  if (!descriptor) return { kind: 'missing' };
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { kind: 'unsafe' };
  return { kind: 'value', value: descriptor.value };
}

function publicBusinessCode(record: object): unknown {
  for (const key of BUSINESS_CODE_KEYS) {
    const property = inspectBusinessProperty(record, key);
    if (property.kind === 'unsafe') return unknownBusinessError();
    if (property.kind === 'value' && property.value !== undefined) return property.value;
  }
  return undefined;
}

function publicBusinessMessage(record: object, code: unknown): string {
  for (const key of ['message', 'error', 'msg', 'data']) {
    const property = inspectBusinessProperty(record, key);
    if (
      property.kind === 'value'
      && typeof property.value === 'string'
      && property.value.trim() !== ''
    ) return property.value;
  }
  return genericBusinessError(code);
}

export function throwOnSerpBusinessError(payload: unknown): void {
  const record = publicBusinessRecord(payload);
  if (!record) return;
  const code = publicBusinessCode(record);
  if (code === undefined || code === 0 || code === '0' || code === 200 || code === '200') return;
  if (
    code !== null
    && typeof code !== 'string'
    && typeof code !== 'number'
    && typeof code !== 'boolean'
  ) return unknownBusinessError();
  throw new Error(publicBusinessMessage(record, code));
}

function queryProperty(params: SerpParams, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(params, key);
  } catch {
    return unsafeResponse();
  }
  if (!descriptor) return undefined;
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return unsafeResponse();
  return descriptor.value;
}

function queryValue(params: SerpParams, engineSchema: SerpEngineSchema): string | number | boolean | null {
  const keys = [
    engineSchema.queryField,
    ...QUERY_FALLBACK_KEYS.filter((key) => key !== engineSchema.queryField),
  ];
  for (const key of keys) {
    const value = queryProperty(params, key);
    if (
      value === undefined
      || value === null
      || (typeof value === 'string' && value.trim() === '')
    ) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return unsafeResponse();
      return value;
    }
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'object') {
      const materialized = materializeJsonValue(value);
      if (Array.isArray(materialized) && materialized.length === 0) continue;
    }
    return unsafeResponse();
  }
  return null;
}

function taskIdFrom(record: JsonObject): string | undefined {
  return nonblankStringProperty(record, 'task_id');
}

export function normalizeSerpResponse(input: NormalizeSerpResponseInput): NormalizedSerpResponse {
  const safePayload = materializeJsonValue(input.payload);
  const code = businessCode(safePayload);
  throwOnSafeBusinessError(safePayload, code);

  let result = safePayload;
  let taskId = isJsonObject(safePayload) ? taskIdFrom(safePayload) : undefined;
  const legacyCode = isJsonObject(safePayload) && hasOwn(safePayload, 'code')
    ? safePayload.code
    : undefined;
  if (isJsonObject(safePayload) && (legacyCode === 200 || legacyCode === '200')) {
    const data = safePayload.data;
    if (isJsonObject(data) && (hasOwn(data, 'result') || hasOwn(data, 'task_id'))) {
      taskId = taskIdFrom(data) ?? taskId;
      result = hasOwn(data, 'result') ? data.result : data;
    }
  }

  return {
    engine: input.engineSchema.key,
    query: queryValue(input.params, input.engineSchema),
    ...(taskId ? { taskId } : {}),
    result,
  };
}
