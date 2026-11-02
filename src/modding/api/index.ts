import { REGISTER_API } from './register';
import { SANDBOX_API } from './sandbox';
import { SYSTEM_API } from './system';
import type { ApiFn } from './types';
import { WORLD_API } from './world';

export const ALL_API: ApiFn[] = [...SYSTEM_API, ...REGISTER_API, ...WORLD_API, ...SANDBOX_API];

/** namespace -> function names, for the linter. */
export const API_NAMESPACES: Record<string, Set<string>> = {};
for (const f of ALL_API) (API_NAMESPACES[f.ns] ??= new Set()).add(f.name);
