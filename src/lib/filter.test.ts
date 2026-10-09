import { expect, test } from 'vitest';
import { toFilterTree } from './filter.js';

const condition = (path: string[], operator: string, value: unknown) => ({ type: 'condition', path, operator, value });

test('empty filters have no tree', () => {
	expect(toFilterTree(null)).toBeNull();
	expect(toFilterTree({})).toBeNull();
});

test('a single condition, through relations', () => {
	expect(toFilterTree({ category: { name: { _eq: 'Guides' } } })).toEqual(
		condition(['category', 'name'], '_eq', 'Guides'),
	);
});

test('several keys are all of the following', () => {
	expect(toFilterTree({ status: { _eq: 'draft' }, author: { _eq: '$CURRENT_USER' } })).toEqual({
		type: 'group',
		logic: 'and',
		children: [condition(['status'], '_eq', 'draft'), condition(['author'], '_eq', '$CURRENT_USER')],
	});
});

test('nested groups keep their logic, and single-child groups collapse', () => {
	expect(
		toFilterTree({
			_or: [
				{ category: { _eq: '$CURRENT_USER.section' } },
				{ _and: [{ a: { _null: true } }] },
				{ b: { _gt: 1 }, c: { _lt: 2 } },
			],
		}),
	).toEqual({
		type: 'group',
		logic: 'or',
		children: [
			condition(['category'], '_eq', '$CURRENT_USER.section'),
			condition(['a'], '_null', true),
			{ type: 'group', logic: 'and', children: [condition(['b'], '_gt', 1), condition(['c'], '_lt', 2)] },
		],
	});
	expect(toFilterTree({ _and: [{ a: { _eq: 1 } }] })).toEqual(condition(['a'], '_eq', 1));
});

test('o2m conditions hold their own tree', () => {
	expect(toFilterTree({ articles: { _some: { status: { _eq: 'published' } } } })).toEqual({
		type: 'relation',
		path: ['articles'],
		quantifier: 'some',
		filter: condition(['status'], '_eq', 'published'),
	});
});

test('a bare value is an equality', () => {
	expect(toFilterTree({ status: 'published' })).toEqual(condition(['status'], '_eq', 'published'));
});
