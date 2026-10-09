import { useApi } from '@directus/extensions-sdk';
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { type PermissionRow, permissionsFor } from '../lib/access.js';
import {
	type Directory,
	type UserSummary,
	loadDirectory,
	loadPermissions,
	loadSubjectAccess,
	loadUser,
} from '../lib/load.js';
import {
	type AccessRow,
	type Resolution,
	type Subject,
	activePolicyIds,
	resolvePolicies,
	rolesTree,
} from '../lib/policies.js';
import { type Simulation, isSimulating, simulateAccess } from '../lib/simulate.js';

export function parseSubject(value: unknown): Subject | null {
	if (value === 'public') return { type: 'public' };
	if (typeof value !== 'string') return null;

	const [type, id] = value.split(':');
	if ((type === 'role' || type === 'user') && id) return { type, id };
	return null;
}

export function formatSubject(subject: Subject): string {
	return subject.type === 'public' ? 'public' : `${subject.type}:${subject.id}`;
}

/**
 * Who a subject is and what applies to them. A second inspector, such as the one to compare with, shares the first's
 * directory of roles and policies instead of loading it again.
 */
export function useInspector(
	subject: Ref<Subject | null>,
	ip: Ref<string | null>,
	simulation: Ref<Simulation>,
	shared?: { directory: Ref<Directory | null> },
) {
	const api = useApi();

	const directory = shared?.directory ?? shallowRef<Directory | null>(null);
	const user = shallowRef<UserSummary | null>(null);
	/** The access rows for the loaded subject, in the order Directus reads them. */
	const subjectAccess = shallowRef<{ key: string; rows: AccessRow[] } | null>(null);
	/** Permissions of every policy either the real or the simulated access uses. */
	const loadedPermissions = shallowRef<PermissionRow[]>([]);
	const loading = ref(true);
	const error = ref<unknown>(null);

	const ready = computed(
		() =>
			!!directory.value &&
			!!subject.value &&
			(subject.value.type !== 'user' || user.value?.id === subject.value.id) &&
			subjectAccess.value?.key === formatSubject(subject.value),
	);

	/** The access the subject has today. */
	const actual = computed<Resolution | null>(() => {
		if (!ready.value) return null;

		return resolvePolicies({
			subject: subject.value!,
			user: user.value && { ...user.value, role: user.value.role?.id ?? null },
			roles: directory.value!.roles,
			policies: directory.value!.policies,
			access: subjectAccess.value!.rows,
			ip: ip.value,
		});
	});

	const simulating = computed(() => isSimulating(simulation.value));

	/** The access the inspector shows: today's, or what it would be under the simulation. */
	const resolution = computed<Resolution | null>(() => {
		if (!ready.value || !simulating.value) return actual.value;
		const role = simulation.value.role;

		return resolvePolicies({
			subject: subject.value!,
			user: user.value && { ...user.value, role: role === undefined ? (user.value.role?.id ?? null) : role },
			roles: directory.value!.roles,
			policies: directory.value!.policies,
			access: simulateAccess({
				subject: subject.value!,
				rows: subjectAccess.value!.rows,
				roleAccess: directory.value!.access,
				roles: directory.value!.roles,
				simulation: simulation.value,
			}),
			ip: ip.value,
		});
	});

	const permissions = computed(() => permissionsFor(loadedPermissions.value, resolution.value));
	const actualPermissions = computed(() => permissionsFor(loadedPermissions.value, actual.value));

	const activePolicies = computed(() => [
		...new Set(
			[actual.value, resolution.value].flatMap((entry) => (entry && !entry.admin ? activePolicyIds(entry) : [])),
		),
	]);

	const needsApp = computed(() => !!(actual.value?.app || resolution.value?.app));

	/** Which permissions the current access needs, and which are loaded; until they match, the access isn't shown. */
	const permissionsKey = computed(() => `${activePolicies.value.join()}|${needsApp.value}`);
	const loadedKey = ref<string | null>(null);
	const pending = computed(() => loading.value || (ready.value && loadedKey.value !== permissionsKey.value));

	let request = 0;

	async function loadOwnDirectory() {
		try {
			directory.value = await loadDirectory(api);
		} catch (err) {
			error.value = err;
			loading.value = false;
		}
	}

	async function loadSubject(current: number) {
		const target = subject.value;
		if (!target || !directory.value) return;

		const loadedUser = target.type === 'user' ? await loadUser(api, target.id) : null;
		if (current !== request) return;

		const startRole = target.type === 'role' ? target.id : (loadedUser?.role?.id ?? null);
		const rows = await loadSubjectAccess(api, {
			roles: rolesTree(startRole, directory.value.roles).tree,
			user: loadedUser?.id ?? null,
		});
		if (current !== request) return;

		user.value = loadedUser;
		subjectAccess.value = { key: formatSubject(target), rows };
	}

	// Each subject is loaded once the directory is.
	watch(
		() => [subject.value && formatSubject(subject.value), !!directory.value],
		async () => {
			if (!directory.value) return;
			const current = ++request;
			loading.value = true;
			error.value = null;

			try {
				await loadSubject(current);
			} catch (err) {
				if (current === request) error.value = err;
			} finally {
				if (current === request) loading.value = false;
			}
		},
		{ immediate: true },
	);

	// A new subject, simulation or IP address can bring in other policies, whose permissions are loaded here; the
	// latest request wins.
	let permissionsRequest = 0;

	watch(
		permissionsKey,
		async (key) => {
			const current = ++permissionsRequest;
			const policies = activePolicies.value;
			const app = needsApp.value;

			try {
				const loaded = policies.length === 0 && !app ? [] : await loadPermissions(api, policies, app);
				if (current !== permissionsRequest) return;
				loadedPermissions.value = loaded;
				loadedKey.value = key;
			} catch (err) {
				if (current === permissionsRequest) error.value = err;
			}
		},
		{ immediate: true },
	);

	if (!shared) loadOwnDirectory();

	return {
		directory,
		user,
		resolution,
		permissions,
		actual,
		actualPermissions,
		simulating,
		loading: pending,
		error,
	};
}
