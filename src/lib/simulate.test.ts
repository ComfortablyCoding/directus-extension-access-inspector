import { expect, test } from 'vitest';
import { type AccessRow, type PolicyRow, type RoleRow, resolvePolicies } from './policies.js';
import { formatSimulation, isSimulating, parseSimulation, simulateAccess } from './simulate.js';

const roles: RoleRow[] = [
	{ id: 'staff', name: 'Staff', icon: null, parent: null },
	{ id: 'writer', name: 'Writer', icon: null, parent: 'staff' },
	{ id: 'lead', name: 'Lead', icon: null, parent: 'writer' },
	{ id: 'other', name: 'Other', icon: null, parent: null },
];

const roleAccess: AccessRow[] = [
	{ id: 'a1', role: 'staff', user: null, policy: 'basics' },
	{ id: 'a2', role: 'writer', user: null, policy: 'writing' },
	{ id: 'a3', role: 'lead', user: null, policy: 'leading' },
	{ id: 'a4', role: 'other', user: null, policy: 'other' },
	{ id: 'a5', role: null, user: null, policy: 'public' },
];

// A writer with a policy of their own.
const rows: AccessRow[] = [roleAccess[0]!, roleAccess[1]!, { id: 'a6', role: null, user: 'grace', policy: 'mine' }];

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

const policies = ['basics', 'writing', 'leading', 'other', 'public', 'mine', 'extra'].map(policy);
const grace = { id: 'grace', first_name: null, last_name: null, email: null, status: 'active', role: 'writer' };
const subject = { type: 'user', id: 'grace' } as const;

function resolve(simulation: Parameters<typeof simulateAccess>[0]['simulation']) {
	const access = simulateAccess({ subject, rows, roleAccess, roles, simulation });
	const user = simulation.role === undefined ? grace : { ...grace, role: simulation.role };
	return resolvePolicies({ subject, user, roles, policies, access }).policies.map(({ policy: p, sources }) =>
		sources.some((source) => source.simulated) ? `+${p.id}` : p.id,
	);
}

test('without changes, the real policies', () => {
	expect(resolve({ add: [], exclude: [] })).toEqual(['basics', 'writing', 'mine']);
});

test('adding attaches to the user, after the rest', () => {
	expect(resolve({ add: ['extra'], exclude: [] })).toEqual(['basics', 'writing', 'mine', '+extra']);
});

test('excluding removes a policy wherever it is attached', () => {
	expect(resolve({ add: [], exclude: ['writing', 'mine'] })).toEqual(['basics']);
});

test('another role brings its tree, and keeps the user’s own policies', () => {
	expect(resolve({ add: [], exclude: [], role: 'lead' })).toEqual(['basics', 'writing', 'leading', 'mine']);
	expect(resolve({ add: [], exclude: [], role: 'other' })).toEqual(['other', 'mine']);
});

test('no role brings the public’s policies', () => {
	expect(resolve({ add: [], exclude: [], role: null })).toEqual(['public', 'mine']);
});

const added = (target: Parameters<typeof simulateAccess>[0]['subject']) =>
	simulateAccess({ subject: target, rows: [], roleAccess, roles, simulation: { add: ['extra'], exclude: [] } })[0];

test('roles and the public get added policies attached to them', () => {
	expect(added({ type: 'role', id: 'writer' })).toMatchObject({ role: 'writer', user: null, simulated: true });
	expect(added({ type: 'public' })).toMatchObject({ role: null, user: null, simulated: true });
});

test('simulations round-trip through the URL', () => {
	const simulation = { add: ['a', 'b'], exclude: ['c'], role: null };
	expect(parseSimulation(formatSimulation(simulation))).toEqual(simulation);
	expect(parseSimulation({})).toEqual({ add: [], exclude: [] });
	expect(isSimulating(parseSimulation({}))).toBe(false);
	expect(isSimulating({ add: [], exclude: [], role: 'x' })).toBe(true);
});
