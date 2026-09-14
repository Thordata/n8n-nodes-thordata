import rawSnapshot from './serp-schema.snapshot.json';
import { normalizeSerpSchema } from './schema';

export const BUNDLED_SERP_SCHEMA = normalizeSerpSchema(rawSnapshot);
