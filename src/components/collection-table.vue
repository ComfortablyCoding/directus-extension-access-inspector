<script setup lang="ts">
import { computed, ref } from 'vue';
import { ACTION_LABELS, LEVEL_LABELS, type Section } from '../composables/use-labels.js';
import { ACTIONS, type Action, type CollectionAccess, type Level } from '../lib/access.js';
import type { PolicyRow } from '../lib/policies.js';
import type { CollectionInfo, FieldInfo } from '../lib/schema.js';
import AccessChip from './access-chip.vue';
import AccessDrawer from './access-drawer.vue';

// Like the permissions table in Settings > Access Policies: a row per collection, and a chip per action that opens
// the details in a drawer.
const emit = defineEmits<{ whoCan: [collection: CollectionInfo] }>();

const props = defineProps<{
	collections: CollectionInfo[];
	access: Record<string, CollectionAccess>;
	/** Today's level of each action a what-if would change, by collection. */
	changes?: Record<string, Partial<Record<Action, Level>>>;
	/** Whose levels the changes are: "Today" for a simulation, or the compared subject. */
	changesLabel?: string;
	fieldsOf: (collection: string) => FieldInfo[];
	primaryOf: (collection: string) => string | undefined;
	policies: Map<string, PolicyRow>;
	admin: boolean;
}>();

const showSystem = ref(false);
interface Selection {
	collection: CollectionInfo;
	action: Action;
	section?: Section;
	/** Where a relation was followed from, to go back to. */
	from?: Selection;
}

const selected = ref<Selection | null>(null);

const headers = [
	{ text: 'Collection', value: 'name', sortable: false, width: 260 },
	{ text: 'Access', value: 'access', sortable: false, width: 360 },
];

const groups = computed(() => [
	{ key: 'user', items: props.collections.filter(({ system }) => !system) },
	{ key: 'system', items: props.collections.filter(({ system }) => system) },
]);

const drawerAccess = computed(() =>
	selected.value ? (props.access[selected.value.collection.collection]?.[selected.value.action] ?? null) : null,
);

// Says in words what each chip means, and what it is today when a what-if would change it.
function chipTooltip(collection: string, action: Action) {
	const access = props.access[collection]?.[action];
	const label = ACTION_LABELS[action];
	let text = `${label}: not allowed`;

	if (props.admin) text = `${label}: admin access`;
	else if (access && access.level !== 'none') {
		if (access.items !== 'all') text = `${label}: items matching a rule`;
		else if (access.level === 'partial')
			text = `${label}: ${action === 'create' ? 'some fields' : 'all items, some fields'}`;
		else text = `${label}: ${action === 'create' ? 'any field' : 'all items and fields'}`;
	}

	const before = props.changes?.[collection]?.[action];
	return before ? `${text}. ${props.changesLabel ?? 'Today'}: ${LEVEL_LABELS[before].toLowerCase()}` : text;
}

// From a relational field, to what can be read in the related collection.
function openRelated(collection: string, from: Selection['section']) {
	const info = props.collections.find((entry) => entry.collection === collection);
	const origin = selected.value ? { ...selected.value, section: from } : undefined;
	if (info) selected.value = { collection: info, action: 'read', section: 'fields', from: origin };
}

function isSelected(collection: string, action: Action) {
	return selected.value?.collection.collection === collection && selected.value.action === action;
}
</script>

<template>
	<div class="collection-table">
		<template v-for="group in groups" :key="group.key">
			<button
				v-if="group.key === 'system' && group.items.length > 0"
				type="button"
				class="system-toggle"
				@click="showSystem = !showSystem"
			>
				<v-divider inline-title>
					<v-icon :name="showSystem ? 'expand_less' : 'expand_more'" small />
					{{ showSystem ? 'Hide System Collections' : 'Show System Collections' }}
				</v-divider>
			</button>

			<div v-if="group.key === 'user' || showSystem" class="scroll">
				<v-table :headers="headers" :items="group.items" item-key="collection" :row-height="50" :clickable="false">
					<template #[`item.name`]="{ item }">
						<button
							v-tooltip="`Who can access ${item.name}`"
							type="button"
							class="collection"
							@click="emit('whoCan', item)"
						>
							<v-icon :name="item.icon" small />
							<span class="name">{{ item.name }}</span>
						</button>
					</template>
					<template #[`item.access`]="{ item }">
						<span class="chips">
							<button
								v-for="action in ACTIONS"
								:key="action"
								type="button"
								class="chip-button"
								v-tooltip="chipTooltip(item.collection, action)"
								:aria-label="`${ACTION_LABELS[action]} ${item.name}`"
								@click="selected = { collection: item, action }"
							>
								<access-chip
									:level="access[item.collection]?.[action].level ?? 'none'"
									:label="ACTION_LABELS[action]"
									:active="isSelected(item.collection, action)"
									:changed="!!changes?.[item.collection]?.[action]"
								/>
							</button>
						</span>
					</template>
				</v-table>
			</div>
		</template>

		<access-drawer
			:access="drawerAccess"
			:fields="selected ? fieldsOf(selected.collection.collection) : []"
			:collection="selected?.collection.collection ?? ''"
			:primary="selected ? (primaryOf(selected.collection.collection) ?? null) : null"
			:collection-name="selected?.collection.name ?? ''"
			:collection-icon="selected?.collection.icon ?? 'database'"
			:policies="policies"
			:admin="admin"
			@close="selected = null"
			@open-related="openRelated"
			:start-section="selected?.section"
			:back-label="selected?.from ? `Back to ${selected.from.collection.name}` : null"
			@back="selected = selected?.from ?? null"
		/>
	</div>
</template>

<style scoped>
/* Narrow screens scroll the table sideways instead of cutting off chips. */
.scroll {
	overflow-x: auto;
}

.scroll :deep(.v-table) {
	min-inline-size: 620px;
}

.collection {
	display: flex;
	cursor: pointer;
	align-items: center;
	gap: 10px;
	min-inline-size: 0;
	--v-icon-color: var(--theme--foreground-subdued);
}

.collection:hover .name {
	color: var(--theme--primary);
	text-decoration: underline;
	text-underline-offset: 3px;
}

.name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chips {
	display: flex;
	gap: 4px;
}

.chip-button {
	display: inline-flex;
	border-radius: var(--theme--border-radius);
	outline: none;
	cursor: pointer;
}

.chip-button:hover :deep(.access-chip),
.chip-button:focus-visible :deep(.access-chip) {
	box-shadow:
		0 0 0 2px var(--theme--background),
		0 0 0 4px var(--theme--primary-subdued, var(--theme--primary));
}

.system-toggle {
	display: block;
	inline-size: 100%;
	margin-block: 24px 8px;
	cursor: pointer;
	--v-divider-label-color: var(--theme--foreground-subdued);
}

.system-toggle:hover {
	--v-divider-label-color: var(--theme--primary);
}
</style>
