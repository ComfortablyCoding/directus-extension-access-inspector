<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type FilterNode, VALUELESS_OPERATORS, formatFilterValue } from '../lib/filter.js';

// Read-only, but drawn like the filter interface in Settings > Access Policies so rules look the same everywhere.
const props = defineProps<{ node: FilterNode }>();

const { t, te } = useI18n();

const FALLBACK_OPERATORS: Record<string, string> = {
	_eq: 'Equals',
	_neq: 'Doesn’t equal',
	_in: 'Is one of',
	_nin: 'Is not one of',
	_null: 'Is null',
	_nnull: 'Isn’t null',
	_submitted: 'Submitted',
};

function translate(key: string, fallback: string) {
	return te(key) ? t(key) : fallback;
}

function operatorLabel(operator: string, operand: unknown) {
	// Directus reads `_null: false` as "isn't null", and likewise for the other valueless operators.
	if (VALUELESS_OPERATORS.has(operator) && (operand === false || operand === 'false')) {
		const opposite = { _null: '_nnull', _nnull: '_null', _empty: '_nempty', _nempty: '_empty' }[operator];
		if (opposite) operator = opposite;
	}
	const key = operator.slice(1);
	return translate(`operators.${key}`, FALLBACK_OPERATORS[operator] ?? key.replace(/_/g, ' '));
}

const groupLabel = computed(() => {
	if (props.node.type !== 'group') return null;
	const and = props.node.logic === 'and';
	return {
		key: translate(and ? 'logic_type_and' : 'logic_type_or', and ? 'AND' : 'OR'),
		text: `${translate(and ? 'all' : 'any', and ? 'All' : 'Any')} ${translate('of_the_following', 'of the following')}`,
	};
});

function value(node: Extract<FilterNode, { type: 'condition' }>) {
	if (VALUELESS_OPERATORS.has(node.operator)) return null;
	if ((node.operator === '_between' || node.operator === '_nbetween') && Array.isArray(node.value)) {
		return node.value.map(formatFilterValue).join(' – ');
	}
	return formatFilterValue(node.value);
}
</script>

<template>
	<div class="filter-node">
		<template v-if="node.type === 'group'">
			<div class="pill">
				<span class="logic" :class="node.logic">{{ groupLabel!.key }}</span>
				<span class="subdued">— {{ groupLabel!.text }}</span>
			</div>
			<div class="children">
				<filter-tree v-for="(child, index) in node.children" :key="index" :node="child" />
			</div>
		</template>

		<template v-else-if="node.type === 'relation'">
			<div class="pill">
				<span class="name">{{ node.path.join(' -> ') }}</span>
				<span class="comparator">{{ node.quantifier === 'some' ? 'Has some' : 'Has none' }}</span>
				<span class="subdued">that match</span>
			</div>
			<div v-if="node.filter" class="children">
				<filter-tree :node="node.filter" />
			</div>
		</template>

		<div v-else class="pill">
			<span class="name">{{ node.path.join(' -> ') }}</span>
			<span class="comparator">{{ operatorLabel(node.operator, node.value) }}</span>
			<span v-if="value(node) !== null" class="value">{{ value(node) }}</span>
		</div>
	</div>
</template>

<style scoped>
/* After the filter interface's nodes: pills with a raw field name, a bold comparator and the value. */
.pill {
	display: flex;
	align-items: center;
	gap: 7px;
	inline-size: fit-content;
	max-inline-size: 100%;
	margin-block-end: 7px;
	padding: 2px 11px 2px 9px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: 90px;
	background-color: var(--theme--form--field--input--background);
	line-height: 22px;
}

.name {
	font-family: var(--theme--fonts--monospace--font-family);
	white-space: nowrap;
}

.comparator {
	font-weight: 700;
	white-space: nowrap;
}

.value {
	overflow: hidden;
	color: var(--theme--primary);
	font-family: var(--theme--fonts--monospace--font-family);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.subdued {
	color: var(--theme--form--field--input--foreground-subdued);
	white-space: nowrap;
}

.logic {
	padding: 2px 5px;
	border-radius: 5px;
	background-color: var(--theme--primary-background);
	color: var(--theme--primary);
	line-height: 18px;
}

.logic.or {
	background-color: var(--secondary-alt, var(--theme--primary-background));
	color: var(--theme--secondary, var(--theme--primary));
}

.children {
	margin-inline-start: 11px;
	padding-inline-start: 13px;
	border-inline-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}
</style>
