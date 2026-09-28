import type { INodePropertyOptions } from 'n8n-workflow';

export interface DatasetPackage {
  readonly id: number;
  readonly name: string;
  readonly is_default: number;
  readonly subscribe_cycle: number;
  readonly list?: readonly DatasetPackageTier[];
}

export interface DatasetPackageTier {
  readonly id: number;
  readonly value: number;
}

export type DatasetPurchaseType = 'snapshot' | 'subscription';

export function datasetPackages(payload: unknown): DatasetPackage[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Dataset capabilities response is invalid');
  }
  const packages = (payload as Record<string, unknown>).packages;
  if (!Array.isArray(packages)) throw new Error('Dataset packages are unavailable');
  return packages.filter((item): item is DatasetPackage => item !== null
    && typeof item === 'object'
    && Number.isInteger((item as DatasetPackage).id)
    && (item as DatasetPackage).id > 0);
}

function matchingPackages(packages: readonly DatasetPackage[], type: DatasetPurchaseType): DatasetPackage[] {
  return packages.filter((item) => type === 'snapshot'
    ? item.subscribe_cycle === 0
    : item.subscribe_cycle > 0);
}

function packageName(item: DatasetPackage): string {
  try {
    const localized = JSON.parse(item.name) as Record<string, { name?: string }>;
    return localized.en?.name || item.name;
  } catch {
    return item.name;
  }
}

export function toDatasetPackageOptions(
  packages: readonly DatasetPackage[], type: DatasetPurchaseType,
): INodePropertyOptions[] {
  return matchingPackages(packages, type).map((item) => ({ name: packageName(item), value: item.id }));
}

export function toDatasetRecordOptions(
  packages: readonly DatasetPackage[], type: DatasetPurchaseType, packageId: number,
): INodePropertyOptions[] {
  const packageInfo = matchingPackages(packages, type).find((item) => item.id === packageId)
    ?? matchingPackages(packages, type).find((item) => item.is_default === 1)
    ?? matchingPackages(packages, type)[0];
  return (packageInfo?.list ?? [])
    .filter((tier) => Number.isFinite(tier.value) && tier.value > 0)
    .sort((a, b) => a.value - b.value)
    .map((tier) => ({ name: `${tier.value.toLocaleString('en-US')} records`, value: tier.value }));
}

export function chooseDatasetPackageId(
  packages: readonly DatasetPackage[], type: DatasetPurchaseType, requested: unknown,
): number {
  const available = matchingPackages(packages, type);
  const id = Number(requested);
  if (requested !== '' && requested !== undefined && requested !== null && id !== 0) {
    if (available.some((item) => item.id === id)) return id;
    throw new Error(`Selected Dataset package is not available for ${type === 'snapshot' ? 'one-time' : 'subscription'} purchase`);
  }
  const selected = available.find((item) => item.is_default === 1) ?? available[0];
  if (!selected) throw new Error(`No Dataset package is available for ${type === 'snapshot' ? 'one-time' : 'subscription'} purchase`);
  return selected.id;
}

export function chooseDatasetRecordLimit(
  packages: readonly DatasetPackage[], type: DatasetPurchaseType, packageId: number, requested: unknown,
): number {
  const options = toDatasetRecordOptions(packages, type, packageId);
  const value = Number(requested);
  if (requested !== '' && requested !== undefined && requested !== null && value !== 0) {
    if (options.some((option) => option.value === value)) return value as number;
    throw new Error('Selected records limit is not available for this package');
  }
  const first = options[0]?.value;
  if (typeof first !== 'number') throw new Error('No records limit is available for this package');
  return first;
}
