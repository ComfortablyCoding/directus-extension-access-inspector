import { expect, test } from 'vitest';
import { type PermissionRow, analyzeCollection } from './access.js';
import { type RelationRow, checkPath, relatedCollection } from './relations.js';

const relations: RelationRow[] = [
	{ collection: 'articles', field: 'author', related_collection: 'directus_users', meta: null },
	{ collection: 'articles', field: 'category', related_collection: 'categories', meta: { one_field: 'articles' } },
	{ collection: 'comments', field: 'item', related_collection: null, meta: null },
];

const permission = (collection: string, fields: string[] | null): PermissionRow => ({
	policy: 'p',
	collection,
	action: 'read',
	permissions: null,
	validation: null,
	presets: null,
	fields,
});

const access = {
	articles: analyzeCollection(['id', 'title', 'author', 'category'], [permission('articles', ['*'])]),
	categories: analyzeCollection(['id', 'name', 'articles'], [permission('categories', ['id', 'name', 'articles'])]),
	directus_users: analyzeCollection(['id', 'email', 'token'], []),
};

const check = (path: string, usage: 'fields' | 'filter') =>
	checkPath({ path: path.split('.'), collection: 'articles', relations, access, usage }).result;

test('follows many-to-one, one-to-many and many-to-any relations', () => {
	expect(relatedCollection(relations, 'articles', 'author')).toBe('directus_users');
	expect(relatedCollection(relations, 'categories', 'articles')).toBe('articles');
	expect(relatedCollection(relations, 'comments', 'item')).toBe('any');
	expect(relatedCollection(relations, 'articles', 'title')).toBeNull();
});

test('a collection that can’t be read is left out of fields, but forbidden in filters', () => {
	expect(check('author.email', 'fields')).toBe('dropped');
	expect(check('author.email', 'filter')).toBe('forbidden');
	// The foreign key itself only needs the article's field.
	expect(check('author', 'fields')).toBe('allowed');
});

test('a field outside the permitted ones is forbidden either way', () => {
	expect(check('category.name', 'fields')).toBe('allowed');
	expect(check('category.slug', 'fields')).toBe('forbidden');
	expect(check('category.slug', 'filter')).toBe('forbidden');
	expect(check('category.articles.title', 'fields')).toBe('allowed');
	expect(check('category.*', 'fields')).toBe('allowed');
});

test('a relation that isn’t granted is left out of fields, but forbidden itself and in filters', () => {
	const limited = {
		...access,
		articles: analyzeCollection(['id', 'title', 'author'], [permission('articles', ['id', 'title'])]),
	};
	const result = (path: string, usage: 'fields' | 'filter') =>
		checkPath({ path: path.split('.'), collection: 'articles', relations, access: limited, usage }).result;

	expect(result('author.id', 'fields')).toBe('dropped');
	expect(result('author', 'fields')).toBe('forbidden');
	expect(result('author.id', 'filter')).toBe('forbidden');
});

test('following a plain field is forbidden', () => {
	expect(check('title.length', 'fields')).toBe('forbidden');
});

test('functions need their field, and many-to-any relations need the collection to follow', () => {
	expect(checkPath({ path: ['year(title)'], collection: 'articles', relations, access, usage: 'filter' })).toEqual({
		result: 'allowed',
		collection: 'articles',
		field: 'title',
		fn: 'year',
	});
	expect(check('count(missing)', 'fields')).toBe('forbidden');

	const blocks = {
		...access,
		comments: analyzeCollection(['id', 'item'], [permission('comments', ['*'])]),
	};
	const result = (path: string) =>
		checkPath({ path: path.split('.'), collection: 'comments', relations, access: blocks, usage: 'filter' }).result;

	expect(result('item.title')).toBe('unknown');
	expect(result('item:articles.title')).toBe('allowed');
	expect(result('item:categories.slug')).toBe('forbidden');
});
