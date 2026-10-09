<script setup lang="ts">
import type { Level } from '../lib/access.js';

defineProps<{
	level: Level;
	label: string;
	active?: boolean;
	/** Marks an action a what-if simulation would change. */
	changed?: boolean;
}>();
</script>

<template>
	<span class="access-chip" :class="[level, { active, changed }]">{{ label }}</span>
</template>

<style scoped>
/* Matches the permission toggles in Settings > Access Policies. */
.access-chip {
	display: inline-flex;
	align-items: center;
	block-size: 22px;
	padding-inline: 7px;
	border: var(--theme--border-width, 1px) solid transparent;
	border-radius: var(--theme--border-radius);
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
	font-weight: 500;
	line-height: 1;
	white-space: nowrap;
	transition: box-shadow var(--fast, 125ms) var(--transition, ease);
}

.full {
	background-color: var(--theme--primary);
	color: var(--foreground-inverted, #fff);
}

.partial {
	background-color: var(--theme--primary-background);
	color: var(--theme--primary);
}

.none {
	border-color: var(--theme--border-color-subdued);
	color: var(--theme--foreground-subdued);
}

.changed {
	position: relative;
}

.changed::after {
	position: absolute;
	inset-block-start: -3px;
	inset-inline-end: -3px;
	inline-size: 8px;
	block-size: 8px;
	border: 2px solid var(--theme--background);
	border-radius: 50%;
	background-color: var(--theme--warning);
	content: '';
}

.active {
	box-shadow:
		0 0 0 2px var(--theme--background),
		0 0 0 4px var(--theme--primary);
}
</style>
