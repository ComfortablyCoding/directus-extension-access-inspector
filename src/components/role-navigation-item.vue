<script setup lang="ts">
import { roleIcon, useLabels } from '../composables/use-labels.js';
import type { RoleNode, Subject } from '../lib/policies.js';

// One role in the navigation; roles with children collapse like in the Users module.
defineProps<{
	node: RoleNode;
	activeRole: string | null;
	linkTo: (subject: Subject) => Record<string, unknown>;
}>();

const { roleName } = useLabels();
</script>

<template>
	<v-list-group
		v-if="node.children.length > 0"
		:to="linkTo({ type: 'role', id: node.role.id })"
		:active="activeRole === node.role.id"
		:value="node.role.id"
		scope="access-inspector-roles"
		clickable
	>
		<template #activator>
			<v-list-item-icon><v-icon :name="roleIcon(node.role)" /></v-list-item-icon>
			<v-list-item-content><v-text-overflow :text="roleName(node.role)" /></v-list-item-content>
		</template>

		<role-navigation-item
			v-for="child in node.children"
			:key="child.role.id"
			:node="child"
			:active-role="activeRole"
			:link-to="linkTo"
		/>
	</v-list-group>

	<v-list-item v-else :to="linkTo({ type: 'role', id: node.role.id })" :active="activeRole === node.role.id">
		<v-list-item-icon><v-icon :name="roleIcon(node.role)" /></v-list-item-icon>
		<v-list-item-content><v-text-overflow :text="roleName(node.role)" /></v-list-item-content>
	</v-list-item>
</template>
