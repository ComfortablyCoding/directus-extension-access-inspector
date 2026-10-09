// What-if simulations: the access a subject would have with other policies attached, some excluded, or (for a user)
// another role. They change the attachments the inspector resolves, not anything in Directus.
import { type AccessRow, type Subject, rolesTree, type RoleRow } from './policies.js';

export interface Simulation {
	/** Policies to attach to the subject: to the user, the role or the public. */
	add: string[];
	/** Policies to exclude, wherever they're attached. */
	exclude: string[];
	/** For a user, another role to put them in, or null for none. Undefined keeps their role. */
	role?: string | null;
}

export const NO_SIMULATION: Simulation = { add: [], exclude: [] };

export function isSimulating(simulation: Simulation): boolean {
	return simulation.add.length > 0 || simulation.exclude.length > 0 || simulation.role !== undefined;
}

/**
 * The access rows a subject would have under a simulation.
 *
 * @param rows The subject's real access rows, as Directus reads them.
 * @param roleAccess Every access row without a user (roles and the public), for moving a user to another role.
 */
export function simulateAccess({
	subject,
	rows,
	roleAccess,
	roles,
	simulation,
}: {
	subject: Subject;
	rows: AccessRow[];
	roleAccess: AccessRow[];
	roles: RoleRow[];
	simulation: Simulation;
}): AccessRow[] {
	let result = rows;

	if (subject.type === 'user' && simulation.role !== undefined) {
		const { tree } = rolesTree(simulation.role, roles);
		const own = rows.filter(({ user }) => user === subject.id);
		// Like Directus: a role's tree, or the public's policies for users without a role.
		const inherited = roleAccess.filter(
			({ role, user }) => user === null && (tree.length === 0 ? role === null : role !== null && tree.includes(role)),
		);
		result = [...inherited, ...own];
	}

	result = result.filter(({ policy }) => !simulation.exclude.includes(policy));

	const target =
		subject.type === 'user'
			? { role: null, user: subject.id }
			: subject.type === 'role'
				? { role: subject.id, user: null }
				: { role: null, user: null };

	return [
		...result,
		...simulation.add.map((policy) => ({ id: `simulated:${policy}`, ...target, policy, simulated: true })),
	];
}

const list = (value: unknown) =>
	typeof value === 'string' && value ? value.split(',').filter(Boolean) : ([] as string[]);

export function parseSimulation(query: Record<string, unknown>): Simulation {
	const role = query['as-role'];

	return {
		add: list(query['add']),
		exclude: list(query['exclude']),
		...(typeof role === 'string' && role ? { role: role === 'none' ? null : role } : {}),
	};
}

export function formatSimulation(simulation: Simulation): Record<string, string | null> {
	return {
		add: simulation.add.join(',') || null,
		exclude: simulation.exclude.join(',') || null,
		'as-role': simulation.role === undefined ? null : (simulation.role ?? 'none'),
	};
}
