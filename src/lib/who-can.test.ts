import { expect, test } from 'vitest';
import type { AccessRow, PolicyRow, RoleRow } from './policies.js';
import { audiences } from './who-can.js';

const policy = (id: string): PolicyRow => ({
	id,
	name: id,
	icon: null,
	description: null,
	admin_access: false,
	app_access: false,
	enforce_tfa: false,
	ip_access: null,
});

const roles: RoleRow[] = [
	{ id: 'writer', name: 'Writer', icon: null, parent: 'staff' },
	{ id: 'staff', name: 'Staff', icon: null, parent: null },
];

const roleAccess: AccessRow[] = [
	{ id: '1', role: null, user: null, policy: 'public' },
	{ id: '2', role: 'staff', user: null, policy: 'basics' },
	{ id: '3', role: 'writer', user: null, policy: 'writing' },
];

test('lists the public, roles in tree order, then users with policies of their own', () => {
	const list = audiences({
		roles,
		policies: ['public', 'basics', 'writing', 'extra'].map(policy),
		roleAccess,
		holders: [{ user: { id: 'ada', role: 'writer' }, rows: [{ id: '4', role: null, user: 'ada', policy: 'extra' }] }],
		ip: null,
	});

	expect(list.map(({ subject, depth }) => [subject.type === 'public' ? 'public' : subject.id, depth])).toEqual([
		['public', 0],
		['staff', 0],
		['writer', 1],
		['ada', 0],
	]);
	expect(list.map(({ resolution }) => resolution.policies.map((entry) => entry.policy.id))).toEqual([
		['public'],
		['basics'],
		['basics', 'writing'],
		['basics', 'writing', 'extra'],
	]);
});
