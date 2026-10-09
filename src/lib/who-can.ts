// Who can do what in a collection: the public, every role, and each user with policies of their own. Other users have
// exactly their role's access.
import type { AccessRow, PolicyRow, Resolution, RoleRow, Subject } from './policies.js';
import { flattenRoleTree, resolvePolicies, roleTree } from './policies.js';

export interface Audience {
	subject: Subject;
	resolution: Resolution;
	/** For roles, how deep they are in the tree. */
	depth: number;
}

export function audiences({
	roles,
	policies,
	roleAccess,
	holders,
	ip,
}: {
	roles: RoleRow[];
	policies: PolicyRow[];
	/** Every access row without a user: the roles' and the public's. */
	roleAccess: AccessRow[];
	holders: { user: { id: string; role: string | null }; rows: AccessRow[] }[];
	ip: string | null;
}): Audience[] {
	const resolve = (subject: Subject, user: { id: string; role: string | null } | null, access: AccessRow[]) =>
		resolvePolicies({
			subject,
			user: user && { ...user, first_name: null, last_name: null, email: null, status: 'active' },
			roles,
			policies,
			access,
			ip,
		});

	const result: Audience[] = [
		{ subject: { type: 'public' }, resolution: resolve({ type: 'public' }, null, roleAccess), depth: 0 },
		// Roles in tree order, parents first.
		...flattenRoleTree(roleTree(roles)).map(({ role, depth }) => {
			const subject: Subject = { type: 'role', id: role.id };
			return { subject, resolution: resolve(subject, null, roleAccess), depth };
		}),
	];

	for (const { user, rows } of holders) {
		const subject: Subject = { type: 'user', id: user.id };
		result.push({ subject, resolution: resolve(subject, user, [...roleAccess, ...rows]), depth: 0 });
	}

	return result;
}
