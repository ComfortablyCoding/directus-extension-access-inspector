<script setup lang="ts">
import { useStores } from '@directus/extensions-sdk';
import { computed, provide, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CollectionTable from './components/collection-table.vue';
import ExplainDrawer from './components/explain-drawer.vue';
import PolicyList from './components/policy-list.vue';
import SimulateChanges from './components/simulate-changes.vue';
import SubjectField from './components/subject-field.vue';
import SubjectNavigation from './components/subject-navigation.vue';
import WhoCanDrawer from './components/who-can-drawer.vue';
import { inspectorContext } from './composables/use-context.js';
import { formatSubject, parseSubject, useInspector } from './composables/use-inspector.js';
import { roleIcon, useLabels, userIcon, userName } from './composables/use-labels.js';
import {
	type Action,
	type CollectionAccess,
	type Level,
	type PermissionRow,
	adminCollectionAccess,
	analyzeCollection,
	diffAccess,
} from './lib/access.js';
import { isValidIp } from './lib/ip.js';
import { accessNotices } from './lib/notices.js';
import type { RelationRow } from './lib/relations.js';
import type { PolicySource, Resolution, Subject } from './lib/policies.js';
import { NO_SIMULATION, type Simulation, formatSimulation, parseSimulation } from './lib/simulate.js';
import type { CollectionInfo, FieldInfo } from './lib/schema.js';

const route = useRoute();
const router = useRouter();
const { useCollectionsStore, useFieldsStore, useRelationsStore, useServerStore } = useStores();
const collectionsStore = useCollectionsStore();
const fieldsStore = useFieldsStore();
const relationsStore = useRelationsStore();
const serverStore = useServerStore?.();
const { roleName, policyName } = useLabels();

const subject = computed(() => parseSubject(route.query['subject']));
const ip = computed(() => {
	const value = route.query['ip'];
	return typeof value === 'string' && isValidIp(value) ? value.trim() : null;
});

const simulation = computed(() => parseSimulation(route.query));

const { directory, user, resolution, permissions, actual, actualPermissions, simulating, loading, error } =
	useInspector(subject, ip, simulation);

// Comparing with someone else resolves them the same way, with their real access.
const compareSubject = computed(() => {
	const other = parseSubject(route.query['compare']);
	return other && subject.value && formatSubject(other) === formatSubject(subject.value) ? null : other;
});
const compared = useInspector(compareSubject, ip, ref(NO_SIMULATION), { directory });

const explaining = ref(false);

/** The collection whose 'who can access' drawer is open. */
const whoCan = ref<CollectionInfo | null>(null);

const policies = computed(() => new Map((directory.value?.policies ?? []).map((policy) => [policy.id, policy])));

const collections = computed<CollectionInfo[]>(() =>
	(collectionsStore.collections as any[])
		// Folders have no table, so no permissions.
		.filter((info) => info.schema)
		.map((info) => ({
			collection: info.collection as string,
			// System collections without their "Directus" prefix, as the app's menus show them.
			name: ((info.name as string) || info.collection).replace(/^Directus (?=\S)/, ''),
			icon: (info.icon as string) || info.meta?.icon || 'database',
			system: (info.collection as string).startsWith('directus_'),
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name)),
);

function collectionName(name: string) {
	return collections.value.find((info) => info.collection === name)?.name ?? name;
}

function fieldsOf(name: string): FieldInfo[] {
	return (
		(fieldsStore.getFieldsForCollection(name) as any[])
			// Dividers, notices and groups hold no data.
			.filter((field) => !field.meta?.special?.includes('no-data'))
			.toSorted((a, b) => (a.meta?.sort ?? Infinity) - (b.meta?.sort ?? Infinity))
			.map((field) => ({
				field: field.field,
				name: field.name || field.field,
				type: field.type,
				special: field.meta?.special ?? null,
			}))
	);
}

function primaryOf(name: string): string | undefined {
	return (fieldsStore.getFieldsForCollection(name) as any[]).find((field) => field.schema?.is_primary_key)?.field;
}

function analyze(target: Resolution | null, rows: PermissionRow[]): Record<string, CollectionAccess> {
	if (!target) return {};
	const admin = target.admin;

	return Object.fromEntries(
		collections.value.map((info) => {
			const fields = fieldsOf(info.collection).map(({ field }) => field);
			if (admin) return [info.collection, adminCollectionAccess(fields)];
			const own = rows.filter((permission) => permission.collection === info.collection);
			return [info.collection, analyzeCollection(fields, own, primaryOf(info.collection))];
		}),
	);
}

const access = computed(() => analyze(resolution.value, permissions.value));

/** The levels to mark: the compared subject's, or today's for a what-if simulation. */
const changes = computed<Record<string, Partial<Record<Action, Level>>>>(() => {
	if (compareSubject.value) {
		if (compared.loading.value || !compared.resolution.value) return {};
		return diffAccess(access.value, analyze(compared.resolution.value, compared.permissions.value));
	}
	if (simulating.value) return diffAccess(access.value, analyze(actual.value, actualPermissions.value));
	return {};
});

const compareName = computed(() => {
	const other = compareSubject.value;
	if (!other) return null;
	if (other.type === 'public') return 'Public';
	if (other.type === 'role') return roleName(directory.value?.roles.find(({ id }) => id === other.id));
	return compared.user.value ? userName(compared.user.value) : 'User';
});

const compareIcon = computed(() => {
	const other = compareSubject.value;
	if (!other || other.type === 'public') return 'public';
	if (other.type === 'user') return userIcon({});
	return roleIcon(directory.value?.roles.find(({ id }) => id === other.id));
});

const changesLabel = computed(() => (compareSubject.value ? (compareName.value ?? 'Compared') : 'Today'));

function setCompare(next: Subject | null) {
	router.replace({ path: route.path, query: query({ compare: next ? formatSubject(next) : null }) });
}

const subjectName = computed(() => {
	const value = subject.value;
	if (!value) return null;
	if (value.type === 'public') return 'Public';
	if (value.type === 'role') return roleName(directory.value?.roles.find(({ id }) => id === value.id));
	return user.value ? userName(user.value) : 'User';
});

const title = computed(() => subjectName.value ?? 'Access Inspector');

const notices = computed(() => {
	const value = resolution.value;
	if (!value || !directory.value || !subject.value) return [];

	return accessNotices({
		subject: subject.value,
		resolution: value,
		userStatus: user.value?.status ?? null,
		customRules: directory.value.customRules,
		licenseName: directory.value.licenseName,
		ip: ip.value,
		version: serverStore?.info?.version,
		policyName,
	});
});

function query(overrides: Record<string, string | null>) {
	const next: Record<string, string> = {};
	const merged = {
		subject: subject.value && formatSubject(subject.value),
		compare: compareSubject.value && formatSubject(compareSubject.value),
		ip: ip.value,
		...formatSimulation(simulation.value),
		...overrides,
	};
	for (const [key, value] of Object.entries(merged)) if (value) next[key] = value;
	return next;
}

// A what-if belongs to who it was made for, so switching starts from their real access.
function linkToSubject(next: Subject) {
	return {
		path: route.path,
		query: query({ subject: formatSubject(next), compare: null, ...formatSimulation({ add: [], exclude: [] }) }),
	};
}

function setSimulation(next: Simulation) {
	router.replace({ path: route.path, query: query(formatSimulation(next)) });
}

const leftOutPolicies = computed(() => {
	if (!simulating.value || !actual.value || !resolution.value) return [];
	const remaining = new Set(resolution.value.policies.map(({ policy }) => policy.id));
	return actual.value.policies.filter(({ policy }) => !remaining.has(policy.id)).map(({ policy }) => policy);
});

const simulationSummary = computed(() => {
	if (!simulating.value || !directory.value) return null;
	const { add, exclude, role } = simulation.value;
	const name = (id: string) => policyName(directory.value!.policies.find((policy) => policy.id === id));
	const parts: string[] = [];

	if (role !== undefined) {
		const next = role ? roleName(directory.value.roles.find(({ id }) => id === role)) : 'No role';
		const current = user.value?.role
			? roleName(directory.value.roles.find(({ id }) => id === user.value!.role!.id))
			: 'no role';
		parts.push(`${next} instead of ${current}`);
	}
	if (add.length > 0) parts.push(`Adding ${add.map(name).join(', ')}`);
	if (exclude.length > 0) parts.push(`Excluding ${exclude.map(name).join(', ')}`);

	return `What if: ${parts.join('; ')}. Nothing is saved.`;
});

provide(inspectorContext, {
	sources: computed(
		() =>
			new Map<string, PolicySource[]>(
				(resolution.value?.policies ?? []).map(({ policy, sources }) => [policy.id, sources]),
			),
	),
	roles: computed(() => directory.value?.roles ?? []),
	userId: computed(() => (subject.value?.type === 'user' ? subject.value.id : null)),
	subject,
	resolution,
	access,
	relations: computed(() => relationsStore.relations as RelationRow[]),
	collectionName,
});

// The simulated IP lives in the URL, so a simulation can be shared.
const ipDraft = ref(ip.value ?? '');
/** Whether any policy is limited to certain networks, so an IP address can change anything. */
const ipRestricted = computed(() => !!directory.value?.policies.some((policy) => policy.ip_access?.length));
const ipInvalid = computed(() => ipDraft.value.trim() !== '' && !isValidIp(ipDraft.value));

watch(ip, (value) => {
	if ((value ?? '') !== ipDraft.value.trim()) ipDraft.value = value ?? '';
});

function applyIp() {
	if (ipInvalid.value || (ipDraft.value.trim() || null) === ip.value) return;
	router.replace({ path: route.path, query: query({ ip: ipDraft.value.trim() || null }) });
}
</script>

<template>
	<private-view class="access-inspector" :title="title" icon="policy">
		<!-- Directus 11 has no icon prop on private-view. -->
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded icon secondary disabled>
				<v-icon name="policy" />
			</v-button>
		</template>

		<template #navigation>
			<subject-navigation v-if="directory" :roles="directory.roles" :subject="subject" :link-to="linkToSubject" />
		</template>

		<template #title:append>
			<v-chip
				v-if="compareSubject && compareName"
				v-tooltip.bottom="`Actions with different access from ${compareName} are marked`"
				class="compare-chip"
				small
				close
				@close="setCompare(null)"
			>
				Compared with {{ compareName }}
			</v-chip>
			<v-chip
				v-if="simulationSummary"
				v-tooltip.bottom="simulationSummary"
				class="simulation-chip"
				small
				close
				@close="setSimulation({ add: [], exclude: [] })"
			>
				Simulation
			</v-chip>
		</template>

		<template #actions>
			<v-button v-if="subject && resolution" small secondary @click="explaining = true">Check API Request</v-button>
		</template>

		<div class="content">
			<v-notice v-if="error" type="danger"
				>Couldn’t load access settings: {{ (error as Error).message ?? error }}</v-notice
			>

			<template v-else>
				<v-info v-if="!subject" icon="policy" title="Inspect Access" center class="empty-state">
					Choose the public, a role or a user in the navigation to see what they can do in each collection, and which
					policy allows it.
				</v-info>
			</template>

			<div v-if="subject && loading && !error" class="loading">
				<v-progress-circular indeterminate />
			</div>

			<template v-if="subject && resolution && directory && !loading && !error">
				<div v-if="notices.length > 0" class="notices">
					<v-notice v-for="notice in notices" :key="notice.text" :type="notice.type" :icon="notice.icon">
						{{ notice.text }}
					</v-notice>
				</div>

				<collection-table
					:collections="collections"
					:access="access"
					:changes="changes"
					:changes-label="changesLabel"
					:fields-of="fieldsOf"
					:primary-of="primaryOf"
					:policies="policies"
					:admin="resolution.admin"
					@who-can="whoCan = $event"
				/>
			</template>
		</div>

		<explain-drawer
			v-if="subject && resolution"
			:open="explaining"
			:subject-name="subjectName ?? ''"
			:permissions="permissions"
			:policies="policies"
			:admin="resolution.admin"
			:primary-of="primaryOf"
			:fields-of="fieldsOf"
			:example="collections.find(({ system }) => !system)?.collection ?? null"
			@close="explaining = false"
		/>

		<who-can-drawer
			v-if="directory"
			:collection="whoCan"
			:fields="whoCan ? fieldsOf(whoCan.collection) : []"
			:primary="whoCan ? (primaryOf(whoCan.collection) ?? null) : null"
			:directory="directory"
			:ip="ip"
			@close="whoCan = null"
			@inspect="router.push(linkToSubject($event))"
		/>

		<template #sidebar>
			<template v-if="subject && resolution && directory">
				<sidebar-detail
					id="access-inspector-policies"
					icon="policy"
					title="Policies"
					:badge="resolution.policies.length"
				>
					<div class="sidebar-policies">
						<policy-list :subject="subject" :resolution="resolution" :ip="ip" :left-out="leftOutPolicies" />

						<div v-if="ipRestricted || ip" class="sidebar-field">
							<div class="sidebar-label">IP Address</div>
							<v-input
								v-model="ipDraft"
								placeholder="Any network"
								:class="{ invalid: ipInvalid }"
								@keydown.enter="applyIp"
								@blur="applyIp"
							/>
							<div class="sidebar-note">
								{{
									ipInvalid
										? 'Enter an IPv4 or IPv6 address.'
										: 'Policies restricted to other networks are excluded. Leave empty to include them all.'
								}}
							</div>
						</div>
					</div>
				</sidebar-detail>

				<sidebar-detail
					id="access-inspector-compare"
					icon="compare_arrows"
					title="Compare"
					:badge="compareSubject ? 1 : false"
				>
					<div class="sidebar-field">
						<div class="sidebar-note">Marks the actions where their access differs.</div>
						<subject-field
							:roles="directory.roles"
							:subject="compareSubject"
							:name="compareName"
							:icon="compareIcon"
							placeholder="Choose who to compare with"
							clearable
							@pick="setCompare"
							@clear="setCompare(null)"
						/>
						<div v-if="compared.error.value" class="sidebar-note invalid-note">
							Couldn’t load who to compare with: {{ (compared.error.value as Error).message ?? compared.error.value }}
						</div>
					</div>
				</sidebar-detail>

				<sidebar-detail
					v-if="actual"
					id="access-inspector-simulate"
					icon="science"
					title="Simulate"
					:badge="simulating ? 1 : false"
				>
					<simulate-changes
						:subject="subject"
						:user="user"
						:actual="actual"
						:directory="directory"
						:simulation="simulation"
						@update="setSimulation"
					/>
				</sidebar-detail>
			</template>
		</template>
	</private-view>
</template>

<style scoped>
.content {
	display: grid;
	gap: 24px;
	padding: var(--content-padding);
	padding-block: 32px var(--content-padding-bottom, 32px);
}

.loading {
	display: flex;
	justify-content: center;
	padding-block: 120px;
}

/* More specific than v-chip's own defaults. */
.compare-chip.v-chip {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-background-color-hover: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
	--v-chip-color-hover: var(--theme--primary);
	--v-chip-close-color: var(--theme--primary);
	--v-chip-close-color-hover: var(--theme--primary-accent, var(--theme--primary));
	margin-inline-start: 8px;
}

.sidebar-field {
	display: grid;
	gap: 6px;
}

.simulation-chip.v-chip {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-background-color-hover: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
	--v-chip-color-hover: var(--theme--warning);
	--v-chip-close-color: var(--theme--warning);
	--v-chip-close-color-hover: var(--theme--warning-accent, var(--theme--warning));
	margin-inline-start: 8px;
}

.notices {
	display: grid;
	gap: 8px;
}

.sidebar-policies {
	display: grid;
	gap: 24px;
}

.sidebar-label {
	color: var(--theme--foreground-accent);
	font-size: 13px;
	font-weight: 600;
}

.empty-state {
	padding-block: 80px;
}

.sidebar-note.invalid-note {
	color: var(--theme--danger);
}

.sidebar-note {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	line-height: 1.5;
}

.invalid :deep(.input) {
	--theme--form--field--input--border-color: var(--theme--danger);
}
</style>
