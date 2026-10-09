<script setup lang="ts">
import { computed } from 'vue';
import { useInspectorContext } from '../composables/use-context.js';
import { APP_ACCESS, roleIcon, useLabels, userIcon } from '../composables/use-labels.js';
import type { PolicyRow } from '../lib/policies.js';

const props = defineProps<{
	policy: PolicyRow | null;
	/** Also shows where the policy is attached: the role, parent role, user or public. */
	via?: boolean;
}>();

const { policyName, roleName } = useLabels();
const context = useInspectorContext();

const attachments = computed(() => {
	if (!props.via || !props.policy || !context) return [];

	return (context.sources.value.get(props.policy.id) ?? []).map((source) => {
		if (source.simulated) {
			return { label: 'Simulation', icon: 'science', to: null, tooltip: 'Only attached in the what-if simulation' };
		}

		if (source.type === 'role') {
			const role = context.roles.value.find(({ id }) => id === source.role);
			return {
				label: source.inherited ? `${roleName(role)} (parent)` : roleName(role),
				icon: roleIcon(role),
				to: `/settings/roles/${source.role}`,
				tooltip: source.inherited ? 'Inherited from a parent role' : 'Attached to the role',
			};
		}

		if (source.type === 'user') {
			return {
				label: 'User',
				icon: userIcon({}),
				to: `/users/${context.userId.value}`,
				tooltip: 'Assigned to the user',
			};
		}

		return { label: 'Public', icon: 'public', to: '/settings/roles/public', tooltip: 'Attached to the public' };
	});
});
</script>

<template>
	<span class="policy-badge-wrapper" :class="{ stacked: via }">
		<router-link
			v-if="policy"
			v-tooltip="policy.description || undefined"
			class="policy-badge"
			:to="`/settings/policies/${policy.id}`"
			@click.stop
		>
			<v-icon :name="policy.icon || 'badge'" small />
			<span class="name">{{ policyName(policy) }}</span>
		</router-link>
		<span v-else v-tooltip="APP_ACCESS.description" class="policy-badge built-in">
			<v-icon :name="APP_ACCESS.icon" small />
			<span class="name">{{ APP_ACCESS.name }}</span>
		</span>

		<span v-if="attachments.length > 0" class="via">
			via
			<template v-for="(attachment, index) in attachments" :key="attachment.to + attachment.label">
				<router-link
					v-if="attachment.to"
					v-tooltip="attachment.tooltip"
					:to="attachment.to"
					class="via-link"
					@click.stop
				>
					{{ attachment.label }}
				</router-link>
				<span v-else v-tooltip="attachment.tooltip" class="via-simulated">{{ attachment.label }}</span>
				<template v-if="index < attachments.length - 1">, </template>
			</template>
		</span>
	</span>
</template>

<style scoped>
.policy-badge-wrapper {
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 2px 8px;
	min-inline-size: 0;
	max-inline-size: 100%;
}

.policy-badge-wrapper.stacked {
	flex-direction: column;
	align-items: flex-start;
}

.policy-badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	max-inline-size: 100%;
	color: var(--theme--foreground);
	font-weight: 500;
	white-space: nowrap;
	text-decoration: none;
}

.name {
	overflow: hidden;
	text-overflow: ellipsis;
}

.policy-badge .v-icon {
	--v-icon-color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

a.policy-badge:hover,
a.policy-badge:hover .v-icon {
	--v-icon-color: var(--theme--primary);
	color: var(--theme--primary);
}

.built-in {
	color: var(--theme--foreground-subdued);
}

.via {
	padding-inline-start: 22px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	line-height: 1.5;
}

.via-link {
	color: var(--theme--foreground-subdued);
	text-decoration: underline;
	text-decoration-color: var(--theme--border-color);
	text-underline-offset: 2px;
}

.via-simulated {
	color: var(--theme--warning);
}

.via-link:hover {
	color: var(--theme--primary);
	text-decoration-color: currentColor;
}
</style>
