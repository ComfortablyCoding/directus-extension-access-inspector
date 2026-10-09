import { expect, test } from 'vitest';
import { loadPermissions, loadVariableContext, testItem } from './load.js';
import type { Resolution } from './policies.js';

const resolution: Resolution = {
	roles: ['staff', 'writer'],
	policies: [],
	admin: false,
	app: true,
	enforceTfa: false,
	roleCycle: false,
};

// Answers with the path, so each test can see what was read.
const api = {
	get: async (path: string) => ({ data: { data: { id: path.split('/').at(-1) } } }),
} as unknown as Parameters<typeof loadVariableContext>[0];

test('$CURRENT_ROLE is the subject’s own role, even when no rule reads the user’s role', async () => {
	const context = await loadVariableContext(api, {
		subject: { type: 'user', id: 'ada' },
		resolution,
		rules: [{ role: { _eq: '$CURRENT_ROLE' } }],
	});
	expect(context.role).toEqual({ id: 'writer' });
	expect(context.user).toEqual({ id: 'ada' });
});

test('a simulated role is the current role', async () => {
	const context = await loadVariableContext(api, {
		subject: { type: 'user', id: 'ada' },
		resolution: { ...resolution, roles: ['editor'] },
		rules: [{ section: { _eq: '$CURRENT_ROLE.section' } }],
	});
	expect(context.role).toEqual({ id: 'editor' });
});

test('users without a role have no current role', async () => {
	const context = await loadVariableContext(api, {
		subject: { type: 'user', id: 'alan' },
		resolution: { ...resolution, roles: [] },
		rules: [],
	});
	expect(context.role).toBeNull();
});

test('reads past QUERY_LIMIT_MAX page by page', async () => {
	const rows = Array.from({ length: 5 }, (_, index) => ({ id: index, policy: 'p', fields: ['*'] }));
	const max = 2;

	// Like Directus with QUERY_LIMIT_MAX=2: `limit: -1` becomes 2.
	const capped = {
		get: async (_path: string, { params }: { params: Record<string, unknown> }) => {
			const limit = params['limit'] === -1 ? max : Number(params['limit']);
			const start = (Number(params['page'] ?? 1) - 1) * limit;
			return {
				data: {
					data: rows.slice(start, start + limit),
					meta: params['meta'] ? { filter_count: rows.length } : undefined,
				},
			};
		},
	} as unknown as Parameters<typeof loadPermissions>[0];

	expect((await loadPermissions(capped, ['p'], false)).map(({ id }) => id)).toEqual([0, 1, 2, 3, 4]);
});

test('a singleton that doesn’t match answers with defaults, which isn’t a match', async () => {
	// Singletons answer with an object of default values instead of an empty list.
	const singleton = {
		get: async (_path: string, { params }: { params: { filter: string } }) => ({
			data: { data: { id: params.filter.includes('"status"') ? null : 1 } },
		}),
	} as unknown as Parameters<typeof testItem>[0];

	expect(
		await testItem(singleton, {
			collection: 'settings',
			primary: 'id',
			key: '1',
			rules: [{ status: { _eq: 'x' } }, null],
		}),
	).toEqual({ exists: true, matches: [false, true] });
});
