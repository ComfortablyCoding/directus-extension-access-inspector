<script setup lang="ts">
import { computed } from 'vue';
import { useLabels } from '../composables/use-labels.js';
import type { Directory, UserSummary } from '../lib/load.js';
import type { Resolution, Subject } from '../lib/policies.js';
import { type Simulation, isSimulating } from '../lib/simulate.js';

// What-if controls: other policies or another role, without changing anything in Directus.
const props = defineProps<{
	subject: Subject;
	user: UserSummary | null;
	/** Today's access, which the choices are relative to. */
	actual: Resolution;
	directory: Directory;
	simulation: Simulation;
}>();

const emit = defineEmits<{ update: [simulation: Simulation] }>();

const { policyName, roleName } = useLabels();

const KEEP = '__keep';
const NONE = 'none';

const applying = computed(() => new Set(props.actual.policies.map(({ policy }) => policy.id)));

const addable = computed(() =>
	props.directory.policies
		.filter(({ id }) => !applying.value.has(id))
		.map((policy) => ({ text: policyName(policy), value: policy.id }))
		.toSorted((a, b) => a.text.localeCompare(b.text)),
);

const removable = computed(() =>
	props.actual.policies.map(({ policy }) => ({ text: policyName(policy), value: policy.id })),
);

const roleItems = computed(() => {
	const current = props.user?.role
		? roleName(props.directory.roles.find(({ id }) => id === props.user!.role!.id))
		: null;
	return [
		{ text: current ? `Current role (${current})` : 'Current role (none)', value: KEEP },
		...props.directory.roles
			.filter(({ id }) => id !== props.user?.role?.id)
			.map((role) => ({ text: roleName(role), value: role.id })),
		...(props.user?.role ? [{ text: 'No role', value: NONE }] : []),
	];
});

const role = computed(() => {
	const value = props.simulation.role;
	return value === undefined ? KEEP : (value ?? NONE);
});

function update(change: Partial<Simulation>) {
	emit('update', { ...props.simulation, ...change });
}

function setRole(value: string) {
	const next: Simulation = { add: props.simulation.add, exclude: props.simulation.exclude };
	if (value !== KEEP) next.role = value === NONE ? null : value;
	emit('update', next);
}
</script>

<template>
	<div class="simulate-changes">
		<p class="hint">Marks the actions where access would change. Nothing is saved.</p>

		<div v-if="subject.type === 'user'" class="field">
			<div class="label">Role</div>
			<v-select :model-value="role" :items="roleItems" @update:model-value="setRole" />
		</div>

		<div class="field">
			<div class="label">Add Policies</div>
			<v-select
				:model-value="simulation.add"
				:items="addable"
				multiple
				placeholder="None"
				@update:model-value="update({ add: $event ?? [] })"
			/>
		</div>

		<div class="field">
			<div class="label">Exclude Policies</div>
			<v-select
				:model-value="simulation.exclude"
				:items="removable"
				multiple
				placeholder="None"
				@update:model-value="update({ exclude: $event ?? [] })"
			/>
		</div>

		<v-button
			v-if="isSimulating(simulation)"
			secondary
			full-width
			small
			@click="emit('update', { add: [], exclude: [] })"
		>
			Reset
		</v-button>
	</div>
</template>

<style scoped>
.simulate-changes {
	display: grid;
	gap: 16px;
}

.field {
	display: grid;
	gap: 6px;
}

.label {
	color: var(--theme--foreground-accent);
	font-size: 13px;
	font-weight: 600;
}

.hint {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	line-height: 1.5;
}
</style>
