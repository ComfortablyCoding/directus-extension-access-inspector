import { ipInNetworks } from './ip.js';

export type Subject = { type: 'public' } | { type: 'role'; id: string } | { type: 'user'; id: string };

export interface RoleRow {
	id: string;
	name: string;
	icon: string | null;
	parent: string | null;
}

export interface PolicyRow {
	id: string;
	name: string;
	icon: string | null;
	description: string | null;
	admin_access: boolean;
	app_access: boolean;
	enforce_tfa: boolean;
	ip_access: string[] | null;
}

export interface AccessRow {
	id: string;
	role: string | null;
	user: string | null;
	policy: string;
	/** An attachment that only exists in a what-if simulation. */
	simulated?: boolean;
}

export interface UserRow {
	id: string;
	first_name: string | null;
	last_name: string | null;
	email: string | null;
	status: string;
	role: string | null;
}

/** Why a policy applies: a role in the subject's role tree, the user directly, or the public. */
export type PolicySource = (
	| { type: 'role'; role: string; inherited: boolean }
	| { type: 'user' }
	| { type: 'public' }
) & { simulated?: boolean };

export interface EffectivePolicy {
	policy: PolicyRow;
	/** Every way the policy is attached; a policy can reach a subject through several roles and the user. */
	sources: PolicySource[];
	/** False when the policy is IP restricted and the simulated IP is outside its networks. */
	active: boolean;
}

export interface Resolution {
	/** The roles whose policies apply, from the root parent down to the subject's own role. */
	roles: string[];
	/** Every attached policy in Directus' priority order (first attachment wins), including those excluded by IP. */
	policies: EffectivePolicy[];
	admin: boolean;
	app: boolean;
	enforceTfa: boolean;
	/** A role chain that loops back on itself, which Directus rejects with an error at login. */
	roleCycle: boolean;
}

export interface ResolveInput {
	subject: Subject;
	/** The simulated user, when the subject is a user. */
	user?: UserRow | null;
	roles: RoleRow[];
	policies: PolicyRow[];
	access: AccessRow[];
	/** The client IP to simulate. Without one, IP restricted policies are assumed to match. */
	ip?: string | null;
}

export function resolvePolicies({ subject, user, roles, policies, access, ip }: ResolveInput): Resolution {
	const startRole = subject.type === 'role' ? subject.id : subject.type === 'user' ? (user?.role ?? null) : null;
	const { tree, cycle } = rolesTree(startRole, roles);
	const userId = subject.type === 'user' ? subject.id : null;
	const policiesById = new Map(policies.map((policy) => [policy.id, policy]));

	// Same selection as Directus' fetchPolicies: users without a role are treated as public, plus their own policies.
	const rows = access.filter((row) => {
		if (userId && row.user === userId) return true;
		if (tree.length === 0) return row.role === null && row.user === null;
		return row.role !== null && tree.includes(row.role);
	});

	// Parent roles first, then child roles, then the user's own (and public) policies, keeping the original order
	// otherwise.
	const sorted = rows
		.map((row, index) => ({ row, index }))
		.toSorted((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
		.map(({ row }) => row);

	function rank(row: AccessRow) {
		return row.role === null ? tree.length : tree.indexOf(row.role);
	}

	const effective: EffectivePolicy[] = [];

	for (const row of sorted) {
		const policy = policiesById.get(row.policy);
		if (!policy) continue;

		const attachment: PolicySource =
			row.role !== null
				? { type: 'role', role: row.role, inherited: row.role !== startRole }
				: row.user !== null
					? { type: 'user' }
					: { type: 'public' };
		const source: PolicySource = row.simulated ? { ...attachment, simulated: true } : attachment;

		const existing = effective.find((entry) => entry.policy.id === policy.id);

		if (existing) {
			existing.sources.push(source);
			continue;
		}

		const restricted = Array.isArray(policy.ip_access) && policy.ip_access.length > 0;
		const active = !restricted || !ip || ipInNetworks(ip, policy.ip_access!);

		effective.push({ policy, sources: [source], active });
	}

	// Admin and app access come from the role tree and the user's own policies only, never the public policy, and the
	// public is never an admin or app user (createDefaultAccountability).
	const global = effective.filter(({ active, sources }) => active && sources.some(({ type }) => type !== 'public'));
	const admin = subject.type !== 'public' && global.some(({ policy }) => policy.admin_access);
	const app = admin || (subject.type !== 'public' && global.some(({ policy }) => policy.app_access));
	const enforceTfa = effective.some(({ active, policy }) => active && policy.enforce_tfa);

	return { roles: tree, policies: effective, admin, app, enforceTfa, roleCycle: cycle };
}

/** The role and its ancestors, root first, like Directus' fetchRolesTree. */
export function rolesTree(start: string | null, roles: RoleRow[]): { tree: string[]; cycle: boolean } {
	const byId = new Map(roles.map((role) => [role.id, role]));
	const tree: string[] = [];
	let current = start ? byId.get(start) : undefined;

	while (current) {
		tree.push(current.id);
		if (current.parent && tree.includes(current.parent)) return { tree: tree.toReversed(), cycle: true };
		current = current.parent ? byId.get(current.parent) : undefined;
	}

	return { tree: tree.toReversed(), cycle: false };
}

/** The policies that apply, in priority order, leaving out those excluded by IP. */
export function activePolicyIds(resolution: Resolution): string[] {
	return resolution.policies.filter(({ active }) => active).map(({ policy }) => policy.id);
}

export interface RoleNode {
	role: RoleRow;
	children: RoleNode[];
}

/**
 * Every role as a tree, parents first. Roles whose parents loop back to them, which Directus can't resolve, are listed
 * at the top level so none goes missing.
 */
export function roleTree(roles: RoleRow[]): RoleNode[] {
	const ids = new Set(roles.map(({ id }) => id));
	const children = new Map<string | null, RoleRow[]>();

	for (const role of roles) {
		const parent = role.parent && ids.has(role.parent) ? role.parent : null;
		children.set(parent, [...(children.get(parent) ?? []), role]);
	}

	const visited = new Set<string>();
	const build = (role: RoleRow): RoleNode => {
		visited.add(role.id);
		return { role, children: (children.get(role.id) ?? []).filter(({ id }) => !visited.has(id)).map(build) };
	};

	const roots = (children.get(null) ?? []).map(build);
	for (const role of roles) if (!visited.has(role.id)) roots.push(build(role));
	return roots;
}

/** A role tree as a list in tree order, with each role's depth. */
export function flattenRoleTree(nodes: RoleNode[], depth = 0): { role: RoleRow; depth: number }[] {
	return nodes.flatMap((node) => [{ role: node.role, depth }, ...flattenRoleTree(node.children, depth + 1)]);
}
