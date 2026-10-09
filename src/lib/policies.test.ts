import { expect, test } from 'vitest';
import {
	type AccessRow,
	type PolicyRow,
	type RoleRow,
	flattenRoleTree,
	resolvePolicies,
	roleTree,
	rolesTree,
} from './policies.js';

const policy = (id: string, overrides: Partial<PolicyRow> = {}): PolicyRow => ({
	id,
	name: id,
	icon: null,
	description: null,
	admin_access: false,
	app_access: false,
	enforce_tfa: false,
	ip_access: null,
	...overrides,
});

const roles: RoleRow[] = [
	{ id: 'staff', name: 'Staff', icon: null, parent: null },
	{ id: 'editor', name: 'Editor', icon: null, parent: 'staff' },
	{ id: 'other', name: 'Other', icon: null, parent: null },
];

const policies = [
	policy('public'),
	policy('staff-app', { app_access: true }),
	policy('editor-content'),
	policy('other-admin', { admin_access: true }),
	policy('user-extra', { enforce_tfa: true }),
	policy('office', { ip_access: ['10.0.0.0/8'] }),
];

const access: AccessRow[] = [
	{ id: 'a1', role: null, user: 'u1', policy: 'user-extra' },
	{ id: 'a2', role: 'editor', user: null, policy: 'editor-content' },
	{ id: 'a3', role: null, user: null, policy: 'public' },
	{ id: 'a4', role: 'staff', user: null, policy: 'staff-app' },
	{ id: 'a5', role: 'other', user: null, policy: 'other-admin' },
	{ id: 'a6', role: 'editor', user: null, policy: 'office' },
];

const user = (role: string | null) => ({
	id: 'u1',
	first_name: null,
	last_name: null,
	email: null,
	status: 'active',
	role,
});

const ids = (resolution: ReturnType<typeof resolvePolicies>) =>
	resolution.policies.map((entry) => (entry.active ? entry.policy.id : `(${entry.policy.id})`));

test('orders parent role, child role, then user policies', () => {
	const resolution = resolvePolicies({
		subject: { type: 'user', id: 'u1' },
		user: user('editor'),
		roles,
		policies,
		access,
	});

	expect(resolution.roles).toEqual(['staff', 'editor']);
	expect(ids(resolution)).toEqual(['staff-app', 'editor-content', 'office', 'user-extra']);
	expect(resolution.policies.map(({ sources }) => sources)).toEqual([
		[{ type: 'role', role: 'staff', inherited: true }],
		[{ type: 'role', role: 'editor', inherited: false }],
		[{ type: 'role', role: 'editor', inherited: false }],
		[{ type: 'user' }],
	]);
	expect(resolution).toMatchObject({ admin: false, app: true, enforceTfa: true });
});

test('a role excludes user policies', () => {
	const resolution = resolvePolicies({ subject: { type: 'role', id: 'editor' }, roles, policies, access });

	expect(ids(resolution)).toEqual(['staff-app', 'editor-content', 'office']);
	expect(resolution.enforceTfa).toBe(false);
});

test('users without a role get the public policies plus their own, without app access from public', () => {
	const withApp = policies.map((p) => (p.id === 'public' ? { ...p, app_access: true } : p));
	const resolution = resolvePolicies({
		subject: { type: 'user', id: 'u1' },
		user: user(null),
		roles,
		policies: withApp,
		access,
	});

	expect(ids(resolution)).toEqual(['user-extra', 'public']);
	expect(resolution.policies[1]!.sources).toEqual([{ type: 'public' }]);
	expect(resolution.app).toBe(false);
});

test('the public is never admin', () => {
	const asAdmin = policies.map((p) => (p.id === 'public' ? { ...p, admin_access: true } : p));
	const resolution = resolvePolicies({ subject: { type: 'public' }, roles, policies: asAdmin, access });

	expect(ids(resolution)).toEqual(['public']);
	expect(resolution).toMatchObject({ admin: false, app: false });
});

test('admin access implies app access', () => {
	const resolution = resolvePolicies({ subject: { type: 'role', id: 'other' }, roles, policies, access });

	expect(resolution).toMatchObject({ admin: true, app: true });
});

test('IP restricted policies apply without a simulated IP, and only inside their networks with one', () => {
	const subject = { type: 'role', id: 'editor' } as const;

	expect(ids(resolvePolicies({ subject, roles, policies, access, ip: '10.1.2.3' }))).toContain('office');
	expect(ids(resolvePolicies({ subject, roles, policies, access, ip: '192.168.0.1' }))).toContain('(office)');
	expect(ids(resolvePolicies({ subject, roles, policies, access, ip: null }))).toContain('office');
});

test('an excluded admin policy grants nothing', () => {
	const restricted = policies.map((p) => (p.id === 'other-admin' ? { ...p, ip_access: ['10.0.0.0/8'] } : p));
	const resolution = resolvePolicies({
		subject: { type: 'role', id: 'other' },
		roles,
		policies: restricted,
		access,
		ip: '1.1.1.1',
	});

	expect(resolution.admin).toBe(false);
});

test('a policy attached several times is listed once, at its first position, with every source', () => {
	const duplicated = [...access, { id: 'a7', role: null, user: 'u1', policy: 'staff-app' }];
	const resolution = resolvePolicies({
		subject: { type: 'user', id: 'u1' },
		user: user('editor'),
		roles,
		policies,
		access: duplicated,
	});

	expect(ids(resolution)).toEqual(['staff-app', 'editor-content', 'office', 'user-extra']);
	expect(resolution.policies[0]!.sources).toEqual([{ type: 'role', role: 'staff', inherited: true }, { type: 'user' }]);
});

test('a role without policies grants nothing, rather than falling back to public', () => {
	const resolution = resolvePolicies({
		subject: { type: 'role', id: 'empty' },
		roles: [...roles, { id: 'empty', name: 'Empty', icon: null, parent: null }],
		policies,
		access,
	});

	expect(resolution.policies).toEqual([]);
	expect(resolution.roles).toEqual(['empty']);
});

test('rolesTree stops at a cycle', () => {
	const cyclic: RoleRow[] = [
		{ id: 'a', name: 'A', icon: null, parent: 'b' },
		{ id: 'b', name: 'B', icon: null, parent: 'a' },
	];

	expect(rolesTree('a', cyclic)).toEqual({ tree: ['b', 'a'], cycle: true });
	expect(rolesTree(null, cyclic)).toEqual({ tree: [], cycle: false });
});

test('roleTree nests roles under their parents, and keeps roles whose parents loop', () => {
	const looping: RoleRow[] = [
		...roles,
		{ id: 'a', name: 'A', icon: null, parent: 'b' },
		{ id: 'b', name: 'B', icon: null, parent: 'a' },
		{ id: 'orphan', name: 'Orphan', icon: null, parent: 'deleted' },
	];

	expect(flattenRoleTree(roleTree(looping)).map(({ role, depth }) => `${role.id}:${depth}`)).toEqual([
		'staff:0',
		'editor:1',
		'other:0',
		'orphan:0',
		'a:0',
		'b:1',
	]);
});
