// How Directus checks fields reached through relations, such as `author.first_name`, measured against its API:
//
// | Situation                                        | In `fields`                  | In `filter` or `sort` |
// | ------------------------------------------------ | ---------------------------- | --------------------- |
// | The relational field itself isn't granted        | Left out of the response     | 403                   |
// | No read access to the related collection         | Left out of the response     | 403                   |
// | Related collection readable, field not granted   | 403                          | 403                   |
// | Field granted (maybe only on some related items) | Allowed, null where not      | Allowed               |
//
// Fields and filters always need the field to be in the union of the permissions' fields, at every step. A function such
// as `year(published_at)` or `count(comments)` needs its field; many-to-any relations name the collection to follow,
// as in `item:articles.title`.
import type { Action, CollectionAccess } from './access.js';

export interface RelationRow {
	collection: string;
	field: string;
	related_collection: string | null;
	meta: { one_field?: string | null } | null;
}

/** The collection a relational field leads to, `any` for many-to-any, or null for a plain field. */
export function relatedCollection(relations: RelationRow[], collection: string, field: string): string | 'any' | null {
	const manyToOne = relations.find((relation) => relation.collection === collection && relation.field === field);
	if (manyToOne) return manyToOne.related_collection ?? 'any';
	const oneToMany = relations.find(
		(relation) => relation.related_collection === collection && relation.meta?.one_field === field,
	);
	return oneToMany ? oneToMany.collection : null;
}

export type PathOutcome =
	/** With the last field reached, and its function, when the path ends in one. */
	| { result: 'allowed'; collection?: string; field?: string; fn?: string }
	/** The related collection can't be read, so Directus leaves the relation out of the response. */
	| { result: 'dropped'; collection: string }
	| { result: 'forbidden'; collection: string; field?: string }
	/** Through a many-to-any relation, which depends on each item's collection. */
	| { result: 'unknown'; collection: string };

/** The fields the permissions for an action allow at all, or null without any permission for it. */
export function permittedFields(access: CollectionAccess | undefined, action: Action): Set<string> | null {
	const entry = access?.[action];
	if (!entry || entry.level === 'none') return null;
	return new Set(entry.permissions.flatMap(({ fields }) => fields ?? []));
}

/**
 * Whether a field path is allowed: in `fields` for the request's action, or in `filter` and `sort`, which always need
 * read access.
 */
export function checkPath({
	path,
	collection,
	relations,
	access,
	usage,
	action = 'read',
	admin = false,
}: {
	path: string[];
	collection: string;
	relations: RelationRow[];
	access: Record<string, CollectionAccess>;
	usage: 'fields' | 'filter';
	action?: Action;
	admin?: boolean;
}): PathOutcome {
	if (admin) return { result: 'allowed' };
	let current = collection;

	for (const [index, part] of path.entries()) {
		const allowed = permittedFields(access[current], index === 0 && usage === 'fields' ? action : 'read');

		if (!allowed) {
			if (index > 0 && usage === 'fields') return { result: 'dropped', collection: current };
			return { result: 'forbidden', collection: current };
		}

		if (part === '*') return { result: 'allowed' };

		const call = /^(\w+)\((.+)\)$/.exec(part);
		const [field = part, scope] = (call ? call[2]! : part).split(':');

		// A field that doesn't exist is refused like one that can't be read, even where every field is allowed.
		const known = access[current]?.read.fields;
		if (known && !(field in known)) return { result: 'forbidden', collection: current, field };

		if (!allowed.has('*') && !allowed.has(field)) {
			// A relation that can't be read is left out of the response rather than refused.
			const last = index === path.length - 1;
			if (!last && usage === 'fields') return { result: 'dropped', collection: current };
			return { result: 'forbidden', collection: current, field };
		}

		if (index === path.length - 1) return { result: 'allowed', collection: current, field, fn: call?.[1] };

		const next = relatedCollection(relations, current, field);
		if (next === 'any') {
			if (!scope) return { result: 'unknown', collection: current };
			current = scope;
			continue;
		}
		// Following a field that isn't relational doesn't exist, which Directus also answers with 403.
		if (!next) return { result: 'forbidden', collection: current, field: path[index + 1] };
		current = next;
	}

	return { result: 'allowed' };
}
