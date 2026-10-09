<script setup lang="ts">
import { computed } from 'vue';
import { APP_ACCESS } from '../composables/use-labels.js';
import type { PolicyRow, Resolution, Subject } from '../lib/policies.js';
import PolicyBadge from './policy-badge.vue';

const props = defineProps<{
	subject: Subject;
	resolution: Resolution;
	ip: string | null;
	/** Policies that apply today but a what-if simulation excludes. */
	leftOut?: PolicyRow[];
}>();

const rows = computed(() =>
	props.resolution.policies.map((entry) => {
		const { policy } = entry;
		// A policy only the simulation adds says so where it's attached: "via Simulation".
		const flags: { label: string; tooltip?: string; warning?: boolean }[] = [];
		if (policy.admin_access) flags.push({ label: 'Admin', tooltip: 'Admin access' });
		else if (policy.app_access) flags.push({ label: 'App', tooltip: 'Data Studio access' });
		if (policy.enforce_tfa) flags.push({ label: '2FA', tooltip: 'Requires two-factor authentication' });
		if (policy.ip_access?.length) {
			flags.push({
				label: entry.active ? 'IP' : 'Off',
				tooltip: `Only from ${policy.ip_access.join(', ')}${
					entry.active ? (props.ip ? '' : '. Set an IP address below to check one.') : `, not ${props.ip}`
				}`,
				warning: !entry.active,
			});
		}

		return { entry, flags };
	}),
);

// Only what the list doesn't already show: the flags carry admin, app, 2FA and IP limits.
const notes = computed(() => {
	const { resolution, subject } = props;
	if (subject.type === 'public' || resolution.app || resolution.admin) return [];
	return ['No policy gives app access, so only the API can be used, not the Data Studio.'];
});
</script>

<template>
	<div class="policy-list">
		<ol v-if="rows.length > 0 || resolution.app">
			<li v-for="{ entry, flags } in rows" :key="entry.policy.id" :class="{ inactive: !entry.active }">
				<policy-badge :policy="entry.policy" via />
				<span class="flags">
					<span
						v-for="flag in flags"
						:key="flag.label"
						v-tooltip.left="flag.tooltip"
						class="flag"
						:class="{ warning: flag.warning }"
					>
						{{ flag.label }}
					</span>
				</span>
			</li>
			<li v-for="policy in leftOut ?? []" :key="`left-out-${policy.id}`" class="inactive">
				<policy-badge :policy="policy" />
				<span class="flags">
					<span v-tooltip.left="'Excluded in the what-if simulation'" class="flag simulated">Excluded</span>
				</span>
			</li>
			<li v-if="resolution.app && !resolution.admin" class="built-in">
				<policy-badge :policy="null" />
				<span class="hint">{{ APP_ACCESS.description }}</span>
			</li>
		</ol>
		<p v-else class="hint">No policies apply.</p>

		<p v-for="note in notes" :key="note" class="hint note">{{ note }}</p>
	</div>
</template>

<style scoped>
.policy-list {
	display: grid;
	gap: 12px;
}

ol {
	display: grid;
	gap: 12px;
	margin: 0;
	padding: 0;
	list-style: none;
	counter-reset: policy;
}

li {
	position: relative;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
	padding-inline-start: 22px;
	counter-increment: policy;
}

li::before {
	position: absolute;
	inset-inline-start: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	line-height: 20px;
	content: counter(policy);
}

.built-in {
	flex-direction: column;
	gap: 2px;
}

.inactive :deep(.policy-badge) {
	color: var(--theme--foreground-subdued);
	text-decoration: line-through;
}

li > :deep(.policy-badge-wrapper) {
	flex: 1;
	min-inline-size: 0;
}

.flags {
	display: flex;
	flex-shrink: 0;
	gap: 4px;
}

.flag {
	padding: 1px 6px;
	border-radius: var(--theme--border-radius);
	background-color: var(--theme--background-normal);
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
}

.flag.simulated {
	background-color: var(--theme--warning-background);
	color: var(--theme--warning);
}

.flag.warning {
	background-color: var(--theme--warning-background);
	color: var(--theme--warning);
}

.hint {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	line-height: 1.5;
}

.note {
	padding-block-start: 12px;
	border-block-start: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.note + .note {
	padding-block-start: 0;
	border: none;
}
</style>
