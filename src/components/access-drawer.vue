<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useInspectorContext } from '../composables/use-context.js';
import { type Match, useItemTest } from '../composables/use-item-test.js';
import { ACTION_LABELS, SECTION_LABELS, type Section, useLabels } from '../composables/use-labels.js';
import { type ActionAccess, type Coverage, type PermissionRow, fieldCoverage, hasRule } from '../lib/access.js';
import { formatFilterValue, toFilterTree } from '../lib/filter.js';
import { permittedFields, relatedCollection } from '../lib/relations.js';
import type { PolicyRow } from '../lib/policies.js';
import type { FieldInfo } from '../lib/schema.js';
import FilterTree from './filter-tree.vue';
import PolicyBadge from './policy-badge.vue';

// Laid out like the custom permission drawer in Settings > Access Policies, read-only and combined across policies.
const props = defineProps<{
	access: ActionAccess | null;
	fields: FieldInfo[];
	collection: string;
	/** The primary key field, for testing a specific item. */
	primary: string | null;
	collectionName: string;
	/** Where to open, such as the fields when following a relation. */
	startSection?: Section;
	/** Shown after following a relation, to go back. */
	backLabel?: string | null;
	collectionIcon: string;
	policies: Map<string, PolicyRow>;
	admin: boolean;
}>();

const emit = defineEmits<{ close: []; openRelated: [collection: string, from: Section]; back: [] }>();

const section = ref<Section>('items');
const { policyName } = useLabels();
const action = computed(() => props.access?.action ?? 'read');

const sections = computed<Section[]>(() => {
	switch (action.value) {
		case 'create':
			return ['fields', 'validation', 'presets'];
		case 'read':
			return ['items', 'fields'];
		case 'update':
			return ['items', 'fields', 'validation', 'presets'];
		default:
			return ['items'];
	}
});

// The dot marks sections with rules in them, like the permission drawer's.
function configured(name: Section) {
	const access = props.access;
	if (!access || props.admin) return false;
	if (name === 'items') return access.items !== 'all' && access.level !== 'none';
	if (name === 'fields') return props.fields.some(({ field }) => coverage(field) !== 'full');
	if (name === 'validation') return access.validation.length > 0;
	return access.presets.length > 0;
}

// Each action opens on its first section; recomputing the same action's access, as for a new IP address, keeps it.
watch(
	() => props.access && `${props.collection}|${props.access.action}`,
	(opened) => {
		if (!opened) return;
		const start = props.startSection;
		section.value = start && sections.value.includes(start) ? start : sections.value[0]!;
	},
	{ immediate: true },
);

const verb = computed(() => ACTION_LABELS[action.value].toLowerCase());

function policyOf(permission: PermissionRow) {
	return permission.policy ? (props.policies.get(permission.policy) ?? null) : null;
}

const fieldRows = computed(() =>
	props.fields.map((info) => {
		const access = props.access?.fields[info.field];
		const granting = props.admin ? [] : (access?.permissions ?? []);
		return {
			...info,
			items: props.admin ? 'all' : (access?.items ?? 'none'),
			policies: [...new Set(granting.map(policyOf))],
			coverage: coverage(info.field),
			relation: relationHint(info.field),
			onItem: fieldOnItem(info.field),
		};
	}),
);

function coverage(field: string): Coverage {
	if (!props.access) return 'none';
	return props.admin ? 'full' : fieldCoverage(props.access, field);
}

const hasPartial = computed(() => fieldRows.value.some((row) => row.coverage === 'partial'));

function policyNames(permissions: PermissionRow[]) {
	return [...new Set(permissions.map((permission) => policyName(policyOf(permission))))].join(', ');
}

function partialReason(field: string) {
	const access = props.access!;
	const granting = access.fields[field]?.permissions ?? [];
	const others = access.permissions.filter((permission) => !granting.includes(permission));
	const outcome = action.value === 'read' ? 'it comes back as null' : 'it can’t be changed';
	return `Only granted by ${policyNames(granting)}. On items allowed only through ${policyNames(others)}, ${outcome}.`;
}

// The page header already names who is inspected, so the drawer only says what the rules mean.
const PAST: Record<string, string> = {
	create: 'created',
	read: 'read',
	update: 'updated',
	delete: 'deleted',
	share: 'shared',
};

const intro = computed(() => {
	const access = props.access;
	if (!access) return '';
	const done = PAST[action.value];

	if (props.admin) return 'Admin access: Directus skips these checks and allows everything.';
	if (access.level === 'none' && (section.value === 'items' || section.value === 'fields')) {
		return `No policy allows this, so nothing can be ${done}.`;
	}

	switch (section.value) {
		case 'items':
			return access.items === 'all'
				? `Every item can be ${done}.`
				: `Items matching any of these rules can be ${done}.`;
		case 'fields':
			if (access.keysOnly) return 'No policy grants any fields, so the API only returns item keys and counts.';
			if (action.value === 'create') return 'Fields that can be set when creating items.';
			if (!hasPartial.value) return `Fields that can be ${done}, on every item that can be ${done}.`;
			return action.value === 'read'
				? 'Fields that can be read. Some come back only on items their policy’s rule matches, and as null on the others.'
				: `Fields that can be ${done}. Some only on items their policy’s rule matches.`;
		case 'validation':
			return access.validation.length === 0
				? 'No policy adds validation.'
				: `Every rule must pass, from every policy, or the ${verb.value} is rejected.`;
		case 'presets':
			return access.presets.length === 0
				? 'No policy sets presets.'
				: 'Default values for fields not included in the payload. When policies set the same field, the later one wins.';
	}
	return '';
});

const context = useInspectorContext();

const {
	key: testKey,
	testing,
	error: testError,
	result,
	run: runTest,
	matchOf,
	fieldOnItem,
} = useItemTest({ access: () => props.access, collection: () => props.collection, primary: () => props.primary });

const canTest = computed(
	() =>
		!!props.primary &&
		!props.admin &&
		action.value !== 'create' &&
		props.access?.level !== 'none' &&
		(section.value === 'items' || section.value === 'fields'),
);

const verdict = computed(() => {
	const tested = result.value;
	const access = props.access;
	if (!tested || !access) return null;
	const done = PAST[action.value];
	const names = (match: Match) => [
		...new Set(
			access.permissions.filter((permission) => matchOf(permission) === match).map((p) => policyName(policyOf(p))),
		),
	];

	if (!tested.exists) return { type: 'warning', icon: 'search_off', text: `There’s no item ${tested.key}.` };
	if (names('yes').length > 0) {
		return {
			type: 'success',
			icon: 'check_circle',
			text: `Item ${tested.key} can be ${done}: it matches ${names('yes').join(', ')}.`,
		};
	}
	if (names('unknown').length > 0) {
		return {
			type: 'warning',
			icon: 'help',
			text: `Item ${tested.key} depends on the user: ${names('unknown').join(', ')} ${names('unknown').length === 1 ? 'compares' : 'compare'} it with the current user. Inspect a user to test it.`,
		};
	}
	return {
		type: 'danger',
		icon: 'block',
		text: `Item ${tested.key} can’t be ${done}: it matches none of these rules.`,
	};
});

const ITEM_ICONS: Record<Match, string> = { yes: 'check_circle', no: 'do_not_disturb_on', unknown: 'help' };

const hasRelations = computed(() => fieldRows.value.some(({ items, relation }) => items !== 'none' && relation));
const hasIndicators = computed(() => hasRelations.value || hasPartial.value || !!result.value?.exists);

function fieldMarker(field: string) {
	const key = result.value!.key;
	const match = fieldOnItem(field);
	if (match === 'unknown') return 'Depends on the user';
	if (match === 'yes') return `On item ${key}`;
	return action.value === 'read' ? `Null on item ${key}` : `Not on item ${key}`;
}

// What reading through a relation gives, measured against Directus: fields of a related collection that can't be read
// at all are left out, and fields outside its permissions are refused, also in filters and sorting.
// A short label for a relational field; selecting it opens what can be read in the related collection.
function relationHint(field: string): { collection: string | null; text: string } | null {
	if (action.value !== 'read' || !context) return null;
	const related = relatedCollection(context.relations.value, props.collection, field);
	if (!related) return null;
	if (related === 'any') return { collection: null, text: 'Relational field to several collections' };

	const name = context.collectionName(related);
	const allowed = props.admin ? new Set(['*']) : permittedFields(context.access.value[related], 'read');
	const readable = !allowed
		? 'not readable'
		: allowed.has('*')
			? 'all fields readable'
			: `${allowed.size === 1 ? '1 field' : `${allowed.size} fields`} readable`;

	return { collection: related, text: `Relational field to ${name}: ${readable}. Select to see what can be read.` };
}

const MATCH_LABELS: Record<Match, { icon: string; text: string }> = {
	yes: { icon: 'check', text: 'Matches' },
	no: { icon: 'close', text: 'Doesn’t match' },
	unknown: { icon: 'help', text: 'Depends on the user' },
};
</script>

<template>
	<v-drawer
		:model-value="!!access"
		:title="`${collectionName} → ${ACTION_LABELS[action]}`"
		:sidebar-label="SECTION_LABELS[section]"
		:icon="collectionIcon"
		@cancel="emit('close')"
		@update:model-value="!$event && emit('close')"
	>
		<template #sidebar>
			<v-list nav>
				<v-list-item v-for="name in sections" :key="name" clickable :active="section === name" @click="section = name">
					<v-list-item-content>{{ SECTION_LABELS[name] }}</v-list-item-content>
					<span v-if="configured(name)" class="dot" />
				</v-list-item>
			</v-list>
		</template>

		<div v-if="access" class="access-drawer">
			<button v-if="backLabel" type="button" class="back" @click="emit('back')">
				<v-icon name="arrow_back" small />
				{{ backLabel }}
			</button>

			<v-notice>{{ intro }}</v-notice>

			<div v-if="canTest" class="test">
				<div class="label">Test an Item</div>
				<form class="test-form" @submit.prevent="runTest">
					<v-input v-model="testKey" small :placeholder="`The ${primary} of an item`" />
					<v-button small secondary type="submit" :loading="testing" :disabled="!testKey.trim()">Test</v-button>
				</form>
				<v-notice v-if="testError" type="danger">{{ testError }}</v-notice>
				<v-notice v-else-if="verdict" :type="verdict.type" :icon="verdict.icon">{{ verdict.text }}</v-notice>
			</div>

			<template v-if="!admin && section === 'items' && access.level !== 'none'">
				<div v-for="(permission, index) in access.permissions" :key="index" class="block">
					<div class="label">
						<policy-badge :policy="policyOf(permission)" via />
						<span v-if="matchOf(permission)" class="marker" :class="matchOf(permission)">
							<v-icon :name="MATCH_LABELS[matchOf(permission)!].icon" x-small />
							{{ MATCH_LABELS[matchOf(permission)!].text }}
						</span>
					</div>
					<div class="box" :class="matchOf(permission) && `tested-${matchOf(permission)}`">
						<filter-tree v-if="hasRule(permission.permissions)" :node="toFilterTree(permission.permissions)!" />
						<span v-else class="subdued">All items</span>
					</div>
				</div>
			</template>

			<template v-if="section === 'fields' && access.level !== 'none'">
				<div class="label">Fields</div>
				<div class="box list">
					<div v-for="row in fieldRows" :key="row.field" class="field-row" :class="{ denied: row.items === 'none' }">
						<v-icon :name="row.items === 'none' ? 'check_box_outline_blank' : 'check_box'" small class="check" />
						<span class="field-name">{{ row.name }}</span>
						<span v-if="row.items !== 'none'" class="indicators">
							<v-icon
								v-if="row.onItem"
								v-tooltip="fieldMarker(row.field)"
								:name="ITEM_ICONS[row.onItem]"
								x-small
								class="indicator"
								:class="row.onItem"
							/>
							<v-icon
								v-else-if="row.coverage === 'partial'"
								v-tooltip="
									`${action === 'read' ? 'Null on some items' : 'Only on some items'}. ${partialReason(row.field)}`
								"
								name="contrast"
								x-small
								class="indicator partial"
							/>
							<button
								v-if="row.relation?.collection"
								v-tooltip="row.relation.text"
								type="button"
								class="related"
								:aria-label="row.relation.text"
								@click="emit('openRelated', row.relation.collection, section)"
							>
								<v-icon name="link" x-small class="indicator" />
							</button>
							<!-- A relation to several collections has no one place to go. -->
							<v-icon v-else-if="row.relation" v-tooltip="row.relation.text" name="link" x-small class="indicator" />
						</span>
						<span class="granted">{{ row.policies.map(policyName).join(', ') }}</span>
					</div>
				</div>
				<div v-if="hasIndicators" class="legend">
					<span v-if="hasPartial && !result?.exists">
						<v-icon name="contrast" x-small class="indicator partial" />
						{{ action === 'read' ? 'Null on some items' : 'Only on some items' }}
					</span>
					<template v-if="result?.exists">
						<span><v-icon name="check_circle" x-small class="indicator yes" /> On item {{ result.key }}</span>
						<span>
							<v-icon name="do_not_disturb_on" x-small class="indicator" />
							{{ action === 'read' ? 'Null' : 'Not allowed' }} on item {{ result.key }}
						</span>
					</template>
					<span v-if="hasRelations"><v-icon name="link" x-small class="indicator" /> Relational field</span>
				</div>
			</template>

			<template v-if="!admin && section === 'validation'">
				<div v-for="({ rule, permission }, index) in access.validation" :key="index" class="block">
					<div class="label"><policy-badge :policy="policyOf(permission)" via /></div>
					<div class="box"><filter-tree :node="toFilterTree(rule)!" /></div>
				</div>
			</template>

			<template v-if="!admin && section === 'presets' && access.presets.length > 0">
				<div class="label">Presets</div>
				<div class="box list presets">
					<template v-for="preset in access.presets" :key="preset.field">
						<div class="preset-row">
							<span class="mono">{{ preset.field }}</span>
							<span class="value">{{ formatFilterValue(preset.value) }}</span>
							<policy-badge :policy="policyOf(preset.permission)" class="granted" />
						</div>
						<div v-for="(overridden, index) in preset.overrides" :key="index" class="preset-row replaced">
							<span class="mono">{{ preset.field }}</span>
							<span class="value">{{ formatFilterValue(overridden.presets?.[preset.field]) }}</span>
							<span v-tooltip="'Replaced by the later policy above'" class="granted">
								<policy-badge :policy="policyOf(overridden)" />
							</span>
						</div>
					</template>
				</div>
			</template>
		</div>
	</v-drawer>
</template>

<style scoped>
.access-drawer {
	padding: var(--content-padding);
	padding-block: 48px var(--content-padding-bottom, 32px);
}

.back {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-block-end: 16px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	--v-icon-color: currentColor;
}

.back:hover {
	color: var(--theme--primary);
}

.access-drawer > .v-notice {
	margin-block-end: 40px;
}

.block + .block {
	margin-block-start: 32px;
}

.label {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 12px;
	margin-block-end: 8px;
	color: var(--theme--foreground-accent);
	font-weight: 600;
}

.test {
	display: grid;
	gap: 12px;
	margin-block-end: 40px;
}

.test .label {
	margin-block-end: -4px;
}

.test-form {
	display: flex;
	gap: 8px;
}

.test-form .v-input {
	flex: 1;
}

.marker {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 4px;
	padding: 0 6px;
	border-radius: var(--theme--border-radius);
	font-size: 12px;
	font-weight: 600;
	line-height: 20px;
	white-space: nowrap;
	--v-icon-color: currentColor;
}

.marker.yes {
	background-color: var(--theme--success-background);
	color: var(--theme--success);
}

.marker.no {
	background-color: var(--theme--background-normal);
	color: var(--theme--foreground-subdued);
}

.marker.unknown {
	background-color: var(--theme--warning-background);
	color: var(--theme--warning);
}

.box.tested-yes {
	border-color: var(--theme--success);
}

.box.tested-no {
	opacity: 0.6;
}

.box {
	padding: 18px;
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color, var(--theme--border-color));
	border-radius: var(--theme--border-radius);
}

.box :deep(.filter-node:last-child > .pill:last-child) {
	margin-block-end: 0;
}

.list {
	display: grid;
	gap: 2px;
	padding: 12px;
}

.field-row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-block-size: 34px;
	padding-inline: 8px;
	border-radius: var(--theme--border-radius);
}

.check {
	--v-icon-color: var(--theme--primary);
}

.denied .check {
	--v-icon-color: var(--theme--foreground-subdued);
}

.field-name {
	white-space: nowrap;
}

.denied .field-name {
	color: var(--theme--foreground-subdued);
}

.indicators {
	display: inline-flex;
	gap: 4px;
}

.indicator {
	--v-icon-color: var(--theme--foreground-subdued);
}

.related {
	display: inline-flex;
	border-radius: var(--theme--border-radius);
	cursor: pointer;
}

.related:hover .indicator,
.related:focus-visible .indicator {
	--v-icon-color: var(--theme--primary);
}

.indicator.partial,
.indicator.unknown {
	--v-icon-color: var(--theme--warning);
}

.indicator.yes {
	--v-icon-color: var(--theme--success);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 6px 16px;
	margin-block-start: 8px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.legend > span {
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.granted {
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: 4px 12px;
	margin-inline-start: auto;
	font-size: 12px;
}

.granted :deep(.policy-badge) {
	color: var(--theme--foreground-subdued);
}

.mono {
	font-family: var(--theme--fonts--monospace--font-family);
}

.value {
	color: var(--theme--primary);
	font-family: var(--theme--fonts--monospace--font-family);
}

.replaced .mono,
.replaced .value {
	color: var(--theme--foreground-subdued);
	text-decoration: line-through;
}

.subdued {
	color: var(--theme--foreground-subdued);
}

.preset-row {
	display: grid;
	grid-template-columns: minmax(120px, auto) minmax(0, 1fr) auto;
	align-items: center;
	gap: 16px;
	min-block-size: 34px;
	padding-inline: 8px;
	border-radius: var(--theme--border-radius);
}

.label :deep(.policy-badge) {
	font-weight: 600;
}

.dot {
	flex-shrink: 0;
	inline-size: 8px;
	block-size: 8px;
	border-radius: 50%;
	background-color: var(--theme--primary);
}
</style>
