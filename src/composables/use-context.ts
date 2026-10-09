import { type ComputedRef, type InjectionKey, inject } from 'vue';
import type { CollectionAccess } from '../lib/access.js';
import type { PolicySource, Resolution, RoleRow, Subject } from '../lib/policies.js';
import type { RelationRow } from '../lib/relations.js';

/** What policy badges need to show where a policy is attached, without passing it through every component. */
export interface InspectorContext {
	sources: ComputedRef<Map<string, PolicySource[]>>;
	roles: ComputedRef<RoleRow[]>;
	userId: ComputedRef<string | null>;
	subject: ComputedRef<Subject | null>;
	resolution: ComputedRef<Resolution | null>;
	/** The subject's access to every collection, for following relations. */
	access: ComputedRef<Record<string, CollectionAccess>>;
	relations: ComputedRef<RelationRow[]>;
	collectionName: (collection: string) => string;
}

export const inspectorContext: InjectionKey<InspectorContext> = Symbol('access-inspector');

export function useInspectorContext() {
	return inject(inspectorContext, null);
}
