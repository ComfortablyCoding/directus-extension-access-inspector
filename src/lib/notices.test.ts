import { expect, test } from 'vitest';
import { accessNotices } from './notices.js';
import type { PolicyRow, Resolution } from './policies.js';

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

const resolution = (entries: { policy: PolicyRow; active?: boolean }[], admin = false): Resolution => ({
	roles: [],
	policies: entries.map(({ policy: row, active = true }) => ({ policy: row, sources: [], active })),
	admin,
	app: false,
	enforceTfa: false,
	roleCycle: false,
});

const base = {
	subject: { type: 'role', id: 'editor' } as const,
	userStatus: null,
	customRules: true,
	licenseName: null,
	ip: null,
	version: '12.5.0',
	policyName: (row: PolicyRow) => row.name,
};

const texts = (input: Partial<Parameters<typeof accessNotices>[0]> & { resolution: Resolution }) =>
	accessNotices({ ...base, ...input }).map(({ text }) => text);

test('says nothing when nothing overrides the table', () => {
	expect(texts({ resolution: resolution([{ policy: policy('content') }]) })).toEqual([]);
});

test('names the admin policy, or the one an IP address blocks', () => {
	const admin = policy('Break Glass', { admin_access: true, ip_access: ['10.0.0.0/8'] });
	expect(texts({ resolution: resolution([{ policy: admin }], true) })[0]).toContain('Admin access from Break Glass');
	expect(texts({ resolution: resolution([{ policy: admin, active: false }]), ip: '1.2.3.4' })[0]).toBe(
		'Break Glass would give admin access, but not from 1.2.3.4.',
	);
});

test('warns about inactive users, roles without policies, the license and Directus 11 IP caching', () => {
	const app = policy('Office', { app_access: true, ip_access: ['10.0.0.0/8'] });
	expect(
		texts({ resolution: resolution([]), userStatus: 'suspended', customRules: false, licenseName: 'Core' }),
	).toEqual([
		expect.stringContaining('Core license'),
		expect.stringContaining('This user is suspended'),
		expect.stringContaining('No policies apply'),
	]);
	expect(texts({ resolution: resolution([{ policy: app }]), version: '11.17.4' })[0]).toContain('Directus 11 caches');
});
