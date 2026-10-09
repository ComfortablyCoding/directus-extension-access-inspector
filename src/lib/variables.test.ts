import { expect, test } from 'vitest';
import { UnknownVariableError, requiredFields, resolveVariables } from './variables.js';

const context = {
	user: { id: 'u1', section: 2, team: { lead: 'u9' }, tags: [{ id: 1 }, { id: 2 }] },
	userUnknown: false,
	role: { id: 'r1', name: 'Editor' },
	roles: ['r0', 'r1'],
	policies: ['p1'],
};

test('finds the user and role fields rules read', () => {
	expect(
		requiredFields([{ a: { _eq: '$CURRENT_USER.section' } }, { _or: [{ b: { _in: '$CURRENT_ROLE.name' } }] }, null]),
	).toEqual({ user: ['section'], role: ['name'] });
});

test('resolves variables for the subject', () => {
	expect(
		resolveVariables(
			{
				_and: [
					{ author: { _eq: '$CURRENT_USER' } },
					{ category: { _eq: '$CURRENT_USER.section' } },
					{ lead: { _eq: '$CURRENT_USER.team.lead' } },
					{ tag: { _in: '$CURRENT_USER.tags.id' } },
					{ role: { _in: '$CURRENT_ROLES' } },
					{ owner: { _eq: '$CURRENT_ROLE' } },
					{ label: { _eq: '$CURRENT_ROLE.name' } },
					{ policy: { _in: '$CURRENT_POLICIES' } },
					{ date: { _lte: '$NOW' } },
				],
			},
			context,
		),
	).toEqual({
		_and: [
			{ author: { _eq: 'u1' } },
			{ category: { _eq: 2 } },
			{ lead: { _eq: 'u9' } },
			{ tag: { _in: [1, 2] } },
			{ role: { _in: ['r0', 'r1'] } },
			{ owner: { _eq: 'r1' } },
			{ label: { _eq: 'Editor' } },
			{ policy: { _in: ['p1'] } },
			{ date: { _lte: '$NOW' } },
		],
	});
});

test('the public has no user', () => {
	expect(resolveVariables({ a: { _eq: '$CURRENT_USER' } }, { ...context, user: null })).toEqual({ a: { _eq: null } });
});

test('a role can’t resolve user variables', () => {
	expect(() =>
		resolveVariables({ a: { _eq: '$CURRENT_USER.section' } }, { ...context, user: null, userUnknown: true }),
	).toThrow(UnknownVariableError);
});
