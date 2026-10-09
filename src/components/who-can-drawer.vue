<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { computed, shallowRef, watch } from 'vue';
import { ACTION_LABELS, LEVEL_LABELS, roleIcon, useLabels, userIcon, userName } from '../composables/use-labels.js';
import {
	ACTIONS,
	type CollectionAccess,
	type PermissionRow,
	adminCollectionAccess,
	analyzeCollection,
	permissionsFor,
} from '../lib/access.js';
import { type Directory, type PolicyHolder, loadPermissions, loadPolicyHolders, loadRoleCounts } from '../lib/load.js';
import type { Subject } from '../lib/policies.js';
import type { CollectionInfo, FieldInfo } from '../lib/schema.js';
import { type Audience, audiences } from '../lib/who-can.js';
import AccessChip from './access-chip.vue';

// Everyone's access to one collection: the public, every role, and the users with policies of their own.
const props = defineProps<{
	collection: CollectionInfo | null;
	fields: FieldInfo[];
	primary: string | null;
	directory: Directory;
	ip: string | null;
}>();

const emit = defineEmits<{ close: []; inspect: [subject: Subject] }>();

const api = useApi();
const { roleName } = useLabels();

const data = shallowRef<{
	holders: PolicyHolder[];
	counts: Record<string, number>;
	permissions: PermissionRow[];
} | null>(null);
const error = shallowRef<string | null>(null);

// Loaded once when first opened; it covers every collection.
watch(
	() => props.collection,
	async (collection) => {
		if (!collection || data.value) return;
		error.value = null;

		try {
			const [holders, counts, permissions] = await Promise.all([
				loadPolicyHolders(api),
				loadRoleCounts(api),
				loadPermissions(api, 'all', true),
			]);
			data.value = { holders, counts, permissions };
		} catch (err) {
			error.value = (err as Error).message;
		}
	},
	{ immediate: true },
);

const rows = computed(() => {
	const collection = props.collection;
	if (!collection || !data.value) return [];
	const fields = props.fields.map(({ field }) => field);

	return audiences({
		roles: props.directory.roles,
		policies: props.directory.policies,
		roleAccess: props.directory.access,
		holders: data.value.holders,
		ip: props.ip,
	}).map((audience) => ({ audience, ...describe(audience), access: analyze(audience, fields, collection.collection) }));
});

function analyze(audience: Audience, fields: string[], collection: string): CollectionAccess {
	if (audience.resolution.admin) return adminCollectionAccess(fields);
	const own = permissionsFor(data.value!.permissions, audience.resolution).filter(
		(permission) => permission.collection === collection,
	);
	return analyzeCollection(fields, own, props.primary ?? undefined);
}

function describe({ subject }: Audience): { name: string; icon: string; detail: string } {
	if (subject.type === 'public') return { name: 'Public', icon: 'public', detail: 'Without signing in' };

	if (subject.type === 'role') {
		const role = props.directory.roles.find(({ id }) => id === subject.id);
		const count = data.value?.counts[subject.id] ?? 0;
		return {
			name: roleName(role),
			icon: roleIcon(role),
			detail: count === 1 ? '1 user' : `${count} users`,
		};
	}

	const user = data.value!.holders.find((holder) => holder.user.id === subject.id)!.user;
	const role = user.role ? roleName(props.directory.roles.find(({ id }) => id === user.role)) : 'No role';
	return {
		name: userName(user),
		icon: userIcon(user),
		detail: `${role}, plus their own policies`,
	};
}

function inspect(subject: Subject) {
	emit('inspect', subject);
	emit('close');
}
</script>

<template>
	<v-drawer
		:model-value="!!collection"
		:title="`${collection?.name ?? ''} → Who Can Access`"
		:icon="collection?.icon ?? 'database'"
		@cancel="emit('close')"
		@update:model-value="!$event && emit('close')"
	>
		<div class="who-can">
			<v-notice>The public, every role, and users with policies of their own. Select one to inspect it.</v-notice>

			<v-notice v-if="error" type="danger">Couldn’t load everyone’s access: {{ error }}</v-notice>

			<div v-else-if="!data" class="loading"><v-progress-circular indeterminate /></div>

			<div v-else class="list">
				<button
					v-for="row in rows"
					:key="row.audience.subject.type + ('id' in row.audience.subject ? row.audience.subject.id : '')"
					type="button"
					class="row"
					:style="{ '--depth': row.audience.depth }"
					@click="inspect(row.audience.subject)"
				>
					<v-icon :name="row.icon" small class="icon" />
					<span class="name">{{ row.name }}</span>
					<span class="detail">{{ row.detail }}</span>
					<span class="chips">
						<access-chip
							v-for="action in ACTIONS"
							:key="action"
							v-tooltip="`${ACTION_LABELS[action]}: ${LEVEL_LABELS[row.access[action].level].toLowerCase()}`"
							:level="row.access[action].level"
							:label="ACTION_LABELS[action]"
						/>
					</span>
				</button>
			</div>
		</div>
	</v-drawer>
</template>

<style scoped>
.who-can {
	display: grid;
	gap: 32px;
	padding: var(--content-padding);
	padding-block: 48px var(--content-padding-bottom, 32px);
}

.loading {
	display: flex;
	justify-content: center;
	padding-block: 48px;
}

.list {
	display: grid;
	gap: 2px;
	padding: 12px;
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color, var(--theme--border-color));
	border-radius: var(--theme--border-radius);
}

.row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-block-size: 40px;
	padding-inline: calc(8px + var(--depth, 0) * 20px) 8px;
	border-radius: var(--theme--border-radius);
	text-align: start;
	cursor: pointer;
}

.row:hover {
	background-color: var(--theme--background-subdued);
}

.icon {
	--v-icon-color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.name {
	white-space: nowrap;
}

.detail {
	overflow: hidden;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chips {
	display: flex;
	flex-shrink: 0;
	gap: 4px;
	margin-inline-start: auto;
}
</style>
