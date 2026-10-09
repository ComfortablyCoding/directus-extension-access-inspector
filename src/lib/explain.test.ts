import { describe, expect, test } from 'vitest';
import { type PermissionRow, analyzeCollection } from './access.js';
import { type ExplainContext, type ParsedRequest, explain, filterPaths, parseRequest } from './explain.js';
import { checkRule } from './validate.js';
import type { FieldInfo } from './schema.js';
import type { VariableContext } from './variables.js';

const collections = ['articles', 'directus_users'];

test('reads a method, path, query and body', () => {
	expect(
		parseRequest(
			'PATCH /items/articles/3?fields=title,author.first_name&sort=-published_at\n{ "status": "published" }',
			collections,
		),
	).toEqual({
		method: 'PATCH',
		collection: 'articles',
		key: '3',
		fields: ['title', 'author.first_name'],
		filter: null,
		sort: ['-published_at'],
		body: { status: 'published' },
	});
});

test('defaults to GET, and maps system endpoints to their collections', () => {
	expect(parseRequest('/users/abc', collections)).toMatchObject({
		method: 'GET',
		collection: 'directus_users',
		key: 'abc',
	});
	expect(parseRequest('https://example.com/items/articles', collections)).toMatchObject({
		collection: 'articles',
		key: null,
	});
});

test('reads numbered brackets as lists, as Directus does', () => {
	expect(
		parseRequest('GET /items/articles?filter[_or][0][title][_eq]=a&filter[_or][1][notes][_eq]=b', collections),
	).toMatchObject({
		filter: { _or: [{ title: { _eq: 'a' } }, { notes: { _eq: 'b' } }] },
	});
});

test('accepts JSON and bracketed filters', () => {
	expect(parseRequest('GET /items/articles?filter={"status":{"_eq":"draft"}}', collections)).toMatchObject({
		filter: { status: { _eq: 'draft' } },
	});
	expect(parseRequest('GET /items/articles?filter[author][first_name][_eq]=Ada', collections)).toMatchObject({
		filter: { author: { first_name: { _eq: 'Ada' } } },
	});
});

test.each([
	['', 'Enter a request'],
	['GET /flows', 'Use an items endpoint'],
	['GET /users/me', 'Use the user’s id'],
	['POST /items/articles\n[{}]', 'single object'],
	['POST /items/articles\n{oops', 'valid JSON'],
	['GET /items/a%zz', 'valid URL'],
])('explains what’s wrong with %j', (text, message) => {
	expect((parseRequest(text, collections) as { error: string }).error).toContain(message);
});

test('lists the paths a filter uses', () => {
	expect(
		filterPaths({
			_and: [{ status: { _eq: 'x' } }, { author: { team: { name: { _null: true } } } }],
			tags: { _some: { name: { _eq: 'y' } } },
		}),
	).toEqual([['status'], ['author', 'team', 'name'], ['tags', 'name']]);
});

const permission = (row: Partial<PermissionRow> & Pick<PermissionRow, 'policy' | 'action'>): PermissionRow => ({
	collection: 'articles',
	permissions: null,
	validation: null,
	presets: null,
	fields: ['*'],
	...row,
});

const request = (text: string) => parseRequest(text, ['articles', 'signups', 'logs']) as ParsedRequest;

describe('explain', () => {
	// Two policies on articles: Staff reads published items' title and status, and updates their title. Own Writing reads
	// the author's own items without notes, updates their title and notes, deletes them, and on create validates the
	// status and presets the author.
	const permissions = [
		permission({
			policy: 'staff',
			action: 'read',
			permissions: { status: { _eq: 'published' } },
			fields: ['id', 'title', 'status', 'published_at', 'token'],
		}),
		permission({
			policy: 'own',
			action: 'read',
			permissions: { author: { _eq: '$CURRENT_USER' } },
			fields: ['id', 'title', 'status', 'author'],
		}),
		permission({
			policy: 'own',
			action: 'create',
			validation: { status: { _in: ['draft'] } },
			presets: { author: '$CURRENT_USER' },
		}),
		permission({
			policy: 'own',
			action: 'update',
			permissions: { author: { _eq: '$CURRENT_USER' } },
			fields: ['title', 'notes'],
		}),
		permission({ policy: 'staff', action: 'update', permissions: { status: { _eq: 'published' } }, fields: ['title'] }),
		permission({ policy: 'own', action: 'delete', permissions: { author: { _eq: '$CURRENT_USER' } } }),
	];

	const items: Record<string, Record<string, unknown>> = {
		1: { id: 1, title: 'Mine', status: 'draft', author: 'ada', notes: 'x' },
		2: { id: 2, title: 'Theirs', status: 'published', author: 'bob', notes: 'y' },
		3: { id: 3, title: 'Their draft', status: 'draft', author: 'bob', notes: 'z' },
	};

	const user: VariableContext = { user: { id: 'ada' }, userUnknown: false, role: null, roles: [], policies: [] };
	const role: VariableContext = { ...user, user: null, userUnknown: true };

	// Signups can be created but not read; logs updated but not read.
	const blind = [
		permission({ policy: 'public', action: 'create', collection: 'signups' }),
		permission({ policy: 'staff', action: 'update', collection: 'logs' }),
	];

	const types: Record<string, Pick<FieldInfo, 'type' | 'special'>> = {
		id: { type: 'integer', special: null },
		title: { type: 'string', special: null },
		status: { type: 'string', special: null },
		published_at: { type: 'dateTime', special: null },
		token: { type: 'string', special: ['conceal'] },
		author: { type: 'uuid', special: null },
		notes: { type: 'text', special: null },
	};

	function context(variables = user, admin = false): ExplainContext {
		return {
			access: {
				articles: analyzeCollection(Object.keys(types), permissions, 'id'),
				signups: analyzeCollection(['id', 'email'], blind, 'id'),
				logs: analyzeCollection(['id', 'message'], blind, 'id'),
			},
			relations: [],
			admin,
			primaryOf: () => 'id',
			fieldInfo: (_collection, field) => types[field],
			collectionName: () => 'Articles',
			policyName: (row) => row.policy ?? 'App Access',
			variables,
			testItem: async (_collection, key, rules) => {
				const item = items[key];
				return { exists: !!item, matches: rules.map((rule) => !!item && (!rule || checkRule(rule, item).passes)) };
			},
		};
	}

	test.each([
		['GET /items/articles/1', 200, 'own items are readable'],
		['GET /items/articles/3', 403, 'someone else’s draft matches no read rule'],
		['GET /items/articles/9', 403, 'a missing item answers 403'],
		['GET /items/articles?fields=notes', 403, 'no read policy grants notes'],
		[
			'GET /items/articles?filter[_or][0][title][_eq]=a&filter[_or][1][notes][_eq]=b',
			403,
			'filters in numbered brackets are checked',
		],
		['GET /items/comments', 403, 'a missing collection answers 403'],
		['GET /items/articles?fields=secret', 403, 'a field that doesn’t exist is refused'],
		['GET /items/articles?filter[secret][_null]=true', 403, 'so is filtering by one'],
		['PATCH /items/articles/1\n{ "notes": "new" }', 200, 'Own Writing grants notes on own items'],
		['PATCH /items/articles/2\n{ "notes": "new" }', 403, 'only Staff matches item 2, and it doesn’t grant notes'],
		['PATCH /items/articles/2\n{ "status": "x" }', 403, 'no policy grants status for update'],
		['POST /items/articles\n{ "status": "draft" }', 200, 'validation passes'],
		['POST /items/signups\n{ "email": "a@b.c" }', 204, 'what can’t be read back answers 204'],
		['PATCH /items/logs/1\n{ "message": "x" }', 204, 'so does an update that can’t be read back'],
		['GET /items/articles?fields=year(published_at)', 200, 'functions need their field'],
		['GET /items/articles?fields=year(title)', 400, 'year() doesn’t apply to strings'],
		['GET /items/articles?filter[year(published_at)][_eq]=2024', 200, 'functions work in filters'],
		['GET /items/articles?sort=-year(published_at)', 200, 'and in sorting'],
		['GET /items/articles?filter[title][_gt]=a', 400, 'strings have no _gt'],
		['GET /items/articles?filter[token][_eq]=x', 400, 'concealed fields only allow _null and the like'],
		['GET /items/articles?filter[token][_nnull]=true', 200, 'which they do allow'],
		['POST /items/articles\n{ "status": "published" }', 400, 'validation fails'],
		['DELETE /items/articles/1', 204, 'deleting answers 204'],
		['DELETE /items/articles/2', 403, 'someone else’s item can’t be deleted'],
	])('%s → %i: %s', async (text, status) => {
		expect((await explain(request(text), context())).status).toBe(status);
	});

	test('warns about fields that come back null on the item', async () => {
		const { steps } = await explain(request('GET /items/articles/2'), context());
		expect(steps.at(-1)).toMatchObject({ status: 'warn', title: expect.stringContaining(': author') });
	});

	test('for a role, rules and presets that read the user are reported, not thrown', async () => {
		const read = await explain(request('GET /items/articles/1'), context(role));
		expect(read.steps.at(-1)).toMatchObject({ status: 'warn', title: 'Item 1 depends on the user' });

		const create = await explain(request('POST /items/articles\n{ "status": "draft" }'), context(role));
		expect(create.status).toBe(200);
		expect(create.steps.map(({ title }) => title)).toContain('The preset for author depends on the user');
	});

	test('a create whose item may not be readable says it may answer 204', async () => {
		const { status, steps } = await explain(request('POST /items/articles\n{ "status": "draft" }'), context());
		expect(status).toBe(200);
		expect(steps.at(-1)).toMatchObject({ status: 'warn', title: 'Directus may answer 204 instead' });
	});

	test('admins skip every check', async () => {
		expect((await explain(request('PATCH /items/articles/2\n{ "status": "x" }'), context(user, true))).status).toBe(
			200,
		);
	});
});
