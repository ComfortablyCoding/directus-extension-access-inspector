// Turns a permission filter into the tree Directus' filter interface draws: groups of all/any of the following, and
// conditions of a field path, an operator and a value.

export type FilterNode =
	| { type: 'group'; logic: 'and' | 'or'; children: FilterNode[] }
	| { type: 'condition'; path: string[]; operator: string; value: unknown }
	/** An o2m or m2m condition, such as articles with some item matching a filter. */
	| { type: 'relation'; path: string[]; quantifier: 'some' | 'none'; filter: FilterNode | null };

export function toFilterTree(filter: unknown): FilterNode | null {
	const nodes = parse(filter, []);
	if (nodes.length === 0) return null;
	return nodes.length === 1 ? nodes[0]! : { type: 'group', logic: 'and', children: nodes };
}

function parse(filter: unknown, path: string[]): FilterNode[] {
	if (!isObject(filter)) return path.length > 0 ? [{ type: 'condition', path, operator: '_eq', value: filter }] : [];

	return Object.entries(filter).flatMap(([key, value]): FilterNode[] => {
		if (key === '_and' || key === '_or') {
			const children = (Array.isArray(value) ? value : []).flatMap((child) => {
				const nodes = parse(child, path);
				return nodes.length > 1 ? [{ type: 'group', logic: 'and', children: nodes } as FilterNode] : nodes;
			});

			// A group with one condition reads the same as the condition.
			if (children.length <= 1) return children;
			return [{ type: 'group', logic: key === '_and' ? 'and' : 'or', children }];
		}

		if (key === '_some' || key === '_none') {
			return [{ type: 'relation', path, quantifier: key === '_some' ? 'some' : 'none', filter: toFilterTree(value) }];
		}

		if (key.startsWith('_')) return [{ type: 'condition', path, operator: key, value }];

		return parse(value, [...path, key]);
	});
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Operators that take no value, and so show none. */
export const VALUELESS_OPERATORS = new Set(['_null', '_nnull', '_empty', '_nempty', '_submitted']);

/** How a value reads in a rule or preset: plain text, lists separated by commas, and dynamic variables as they are. */
export function formatFilterValue(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) return value.map(formatFilterValue).join(', ');
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}
