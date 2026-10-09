import type { useApi } from '@directus/extensions-sdk';
import type { Filter, PermissionRow } from './access.js';
import {
	type AccessRow,
	type PolicyRow,
	type Resolution,
	type RoleRow,
	type Subject,
	type UserRow,
	activePolicyIds,
} from './policies.js';
import { type VariableContext, requiredFields } from './variables.js';

type AxiosInstance = ReturnType<typeof useApi>;

export interface Directory {
	roles: RoleRow[];
	policies: PolicyRow[];
	/** Access rows for roles and the public. Users' own rows are loaded with the user. */
	access: AccessRow[];
	/** False when the license ignores permissions with custom rules (Directus 12 Core). */
	customRules: boolean;
	licenseName: string | null;
}

export interface UserSummary extends Omit<UserRow, 'role'> {
	role: { id: string; name: string } | null;
	avatar: string | null;
}

const USER_FIELDS = ['id', 'first_name', 'last_name', 'email', 'status', 'avatar', 'role.id', 'role.name'];

export async function loadDirectory(api: AxiosInstance): Promise<Directory> {
	const [roles, policies, access, license] = await Promise.all([
		readAll<RoleRow>(api, '/roles', { fields: ['id', 'name', 'icon', 'parent'], sort: ['name'] }),
		readAll<PolicyRow>(api, '/policies', {
			fields: ['id', 'name', 'icon', 'description', 'admin_access', 'app_access', 'enforce_tfa', 'ip_access'],
		}),
		// Unsorted, so rows keep the order Directus reads them in when resolving policies.
		readAll<AccessRow>(api, '/access', { fields: ['id', 'role', 'user', 'policy'], filter: { user: { _null: true } } }),
		loadLicense(api),
	]);

	return { roles, policies, access, ...license };
}

/** Directus 11 has no license, and any other failure shouldn't hide the inspector. */
async function loadLicense(api: AxiosInstance): Promise<Pick<Directory, 'customRules' | 'licenseName'>> {
	try {
		const { data } = await api.get('/license');
		const entitlement = data?.data?.entitlements?.custom_permission_rules_enabled;
		const enabled = typeof entitlement === 'object' && entitlement !== null ? entitlement.default : entitlement;
		return { customRules: enabled !== false, licenseName: data?.data?.name ?? null };
	} catch {
		return { customRules: true, licenseName: null };
	}
}

export async function loadUser(api: AxiosInstance, id: string): Promise<UserSummary> {
	const { data } = await api.get(`/users/${encodeURIComponent(id)}`, { params: { fields: USER_FIELDS.join(',') } });
	return data.data;
}

/**
 * The access rows that apply to a subject, read with the same filter as Directus' fetchPolicies. Directus doesn't sort
 * them, so reading them the same way keeps the database order it relies on between rows of equal priority.
 */
export async function loadSubjectAccess(
	api: AxiosInstance,
	{ roles, user }: { roles: string[]; user: string | null },
): Promise<AccessRow[]> {
	const roleFilter =
		roles.length === 0 ? { _and: [{ role: { _null: true } }, { user: { _null: true } }] } : { role: { _in: roles } };

	return readAll<AccessRow>(api, '/access', {
		fields: ['id', 'role', 'user', 'policy'],
		filter: user ? { _or: [{ user: { _eq: user } }, roleFilter] } : roleFilter,
	});
}

export async function searchUsers(api: AxiosInstance, search: string, limit = 25): Promise<UserSummary[]> {
	const { data } = await api.get('/users', {
		params: {
			fields: USER_FIELDS.join(','),
			search: search || undefined,
			sort: 'first_name,last_name,email',
			limit,
		},
	});

	return data.data;
}

const PERMISSION_FIELDS = ['id', 'policy', 'collection', 'action', 'permissions', 'validation', 'presets', 'fields'];

/**
 * The permissions of the given policies, or of every policy, and the minimal permissions Directus adds for app access.
 * `permissionsFor` puts them in a resolution's order.
 */
export async function loadPermissions(
	api: AxiosInstance,
	policies: string[] | 'all',
	app: boolean,
): Promise<PermissionRow[]> {
	const [rows, minimal] = await Promise.all([
		policies.length === 0
			? []
			: readAll<PermissionRow>(api, '/permissions', {
					fields: PERMISSION_FIELDS,
					filter: { policy: policies === 'all' ? { _nnull: true } : { _in: policies } },
				}),
		// The API adds its built-in app permissions, which belong to no policy, to every read by an app user, so asking
		// for permissions without a policy returns exactly the running version's list.
		app
			? readAll<PermissionRow>(api, '/permissions', { fields: PERMISSION_FIELDS, filter: { policy: { _null: true } } })
			: [],
	]);

	return [...rows, ...minimal.map((row) => ({ ...row, policy: null, fields: row.fields ?? null }))];
}

/**
 * Every matching row. With QUERY_LIMIT_MAX set, Directus quietly caps `limit: -1` at that maximum, so the rest is read
 * page by page, at the size the first page came back with.
 */
async function readAll<T>(api: AxiosInstance, path: string, query: Record<string, unknown>): Promise<T[]> {
	const params: Record<string, string | number> = { limit: -1, meta: 'filter_count' };

	for (const [key, value] of Object.entries(query)) {
		params[key] = Array.isArray(value)
			? value.join(',')
			: typeof value === 'object'
				? JSON.stringify(value)
				: String(value);
	}

	const { data } = await api.get(path, { params });
	const rows: T[] = data.data;
	const total: number = data.meta?.filter_count ?? rows.length;
	const size = rows.length;

	if (size === 0) return rows;

	for (let page = 2; rows.length < total; page++) {
		const next = await api.get(path, { params: { ...params, meta: undefined, limit: size, page } });
		if (next.data.data.length === 0) break;
		rows.push(...next.data.data);
	}

	return rows;
}

/** The endpoint for a collection's items; system collections have their own, such as /users. */
function itemsPath(collection: string): string {
	return collection.startsWith('directus_') ? `/${collection.slice('directus_'.length)}` : `/items/${collection}`;
}

const withId = (fields: string[]) => ['id', ...fields].join(',');

/** Reads what dynamic variables need for the subject: only the user and role fields the rules use. */
export async function loadVariableContext(
	api: AxiosInstance,
	{ subject, resolution, rules }: { subject: Subject; resolution: Resolution; rules: unknown[] },
): Promise<VariableContext> {
	const needed = requiredFields(rules);
	const policies = activePolicyIds(resolution);

	const user =
		subject.type === 'user'
			? (await api.get(`/users/${encodeURIComponent(subject.id)}`, { params: { fields: withId(needed.user) } })).data
					.data
			: null;

	// The subject's own role ends the tree, and follows a simulated role.
	const roleKey = resolution.roles.at(-1) ?? null;
	const role = roleKey
		? needed.role.length > 0
			? (await api.get(`/roles/${encodeURIComponent(roleKey)}`, { params: { fields: withId(needed.role) } })).data.data
			: { id: roleKey }
		: null;

	return { user, userUnknown: subject.type === 'role', role, roles: resolution.roles, policies };
}

/** Whether an item exists and, for each rule, whether it matches it. Read as the admin, so nothing is hidden. */
export async function testItem(
	api: AxiosInstance,
	{ collection, primary, key, rules }: { collection: string; primary: string; key: string; rules: (Filter | null)[] },
): Promise<{ exists: boolean; matches: boolean[] }> {
	const find = async (rule: Filter | null) => {
		const filter = rule ? { _and: [{ [primary]: { _eq: key } }, rule] } : { [primary]: { _eq: key } };
		const { data } = await api.get(itemsPath(collection), {
			params: { filter: JSON.stringify(filter), fields: primary, limit: 1 },
		});
		// A singleton answers with its default values, not an empty list, when nothing matches.
		return Array.isArray(data.data) ? data.data.length > 0 : data.data?.[primary] != null;
	};

	const exists = await find(null);
	if (!exists) return { exists, matches: rules.map(() => false) };
	return { exists, matches: await Promise.all(rules.map(find)) };
}

export interface PolicyHolder {
	user: Omit<UserSummary, 'role' | 'avatar'> & { role: string | null };
	rows: AccessRow[];
}

/** Users with policies of their own, with those attachments; everyone else has exactly their role's access. */
export async function loadPolicyHolders(api: AxiosInstance): Promise<PolicyHolder[]> {
	const rows = await readAll<Omit<AccessRow, 'user'> & { user: PolicyHolder['user'] }>(api, '/access', {
		fields: [
			'id',
			'role',
			'policy',
			'user.id',
			'user.first_name',
			'user.last_name',
			'user.email',
			'user.status',
			'user.role',
		],
		filter: { user: { _nnull: true } },
	});

	const holders = new Map<string, PolicyHolder>();

	for (const row of rows) {
		if (!row.user) continue;
		const holder = holders.get(row.user.id) ?? { user: row.user, rows: [] };
		holder.rows.push({ ...row, user: row.user.id });
		holders.set(row.user.id, holder);
	}

	return [...holders.values()];
}

/** How many users each role has. */
export async function loadRoleCounts(api: AxiosInstance): Promise<Record<string, number>> {
	const { data } = await api.get('/users', { params: { 'aggregate[count]': 'id', 'groupBy[]': 'role', limit: -1 } });
	return Object.fromEntries(
		(data.data as { role: string | null; count: { id: number | string } }[])
			.filter(({ role }) => role)
			.map(({ role, count }) => [role, Number(count.id)]),
	);
}
