<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { roleIcon, useLabels, userIcon, userName } from '../composables/use-labels.js';
import { useUserSearch } from '../composables/use-user-search.js';
import { type RoleRow, type Subject, roleTree } from '../lib/policies.js';
import RoleNavigationItem from './role-navigation-item.vue';

// Who to inspect: one search over the public, the roles (collapsible, like the Users module) and the users.
const props = defineProps<{
	roles: RoleRow[];
	subject: Subject | null;
	linkTo: (subject: Subject) => Record<string, unknown>;
}>();

const { roleName } = useLabels();

const USER_LIMIT = 50;
const { search, users, loading: loadingUsers, load: loadUsers } = useUserSearch(USER_LIMIT);
loadUsers();

const query = computed(() => search.value.trim().toLowerCase());

const tree = computed(() => roleTree(props.roles));

/** While searching, matching roles show flat, without their tree. */
const matchingRoles = computed(() => props.roles.filter((role) => roleName(role).toLowerCase().includes(query.value)));

const showPublic = computed(() => !query.value || 'public'.includes(query.value));

const activeRole = computed(() => (props.subject?.type === 'role' ? props.subject.id : null));

// Keep the selected role's parents open, so it's visible in the tree.
const open = ref<string[]>([]);

watch(
	() => [activeRole.value, props.roles] as const,
	([role]) => {
		const parents: string[] = [];
		let current = props.roles.find(({ id }) => id === role);
		while (current?.parent && !parents.includes(current.parent)) {
			parents.push(current.parent);
			current = props.roles.find(({ id }) => id === current!.parent);
		}
		open.value = [...new Set([...open.value, ...parents])];
	},
	{ immediate: true },
);

function isActive(type: Subject['type'], id?: string) {
	const subject = props.subject;
	return !!subject && subject.type === type && (subject.type === 'public' || subject.id === id);
}
</script>

<template>
	<div class="subject-navigation">
		<div class="search">
			<v-input v-model="search" small type="search" placeholder="Search roles and users">
				<template #prepend><v-icon name="search" small /></template>
			</v-input>
		</div>

		<v-list v-if="showPublic" nav class="public">
			<v-list-item :to="linkTo({ type: 'public' })" :active="isActive('public')">
				<v-list-item-icon><v-icon name="public" /></v-list-item-icon>
				<v-list-item-content>Public</v-list-item-content>
			</v-list-item>
		</v-list>

		<section class="group roles">
			<v-divider class="title">Roles</v-divider>
			<v-list nav class="scroll">
				<template v-if="!query">
					<v-item-group v-model="open" scope="access-inspector-roles" multiple>
						<role-navigation-item
							v-for="node in tree"
							:key="node.role.id"
							:node="node"
							:active-role="activeRole"
							:link-to="linkTo"
						/>
					</v-item-group>
				</template>
				<template v-else>
					<v-list-item
						v-for="role in matchingRoles"
						:key="role.id"
						:to="linkTo({ type: 'role', id: role.id })"
						:active="isActive('role', role.id)"
					>
						<v-list-item-icon><v-icon :name="roleIcon(role)" /></v-list-item-icon>
						<v-list-item-content><v-text-overflow :text="roleName(role)" /></v-list-item-content>
					</v-list-item>
					<div v-if="matchingRoles.length === 0" class="empty">No roles found</div>
				</template>
			</v-list>
		</section>

		<section class="group users">
			<v-divider class="title">Users</v-divider>
			<v-list nav class="scroll">
				<v-list-item
					v-for="user in users"
					:key="user.id"
					:to="linkTo({ type: 'user', id: user.id })"
					:active="isActive('user', user.id)"
					:class="{ inactive: user.status !== 'active' }"
				>
					<v-list-item-icon>
						<v-icon :name="userIcon(user)" />
					</v-list-item-icon>
					<v-list-item-content>
						<v-text-overflow :text="userName(user)" />
					</v-list-item-content>
				</v-list-item>
				<div v-if="!loadingUsers && users.length === 0" class="empty">No users found</div>
				<div v-else-if="users.length >= USER_LIMIT" class="empty">Search to find more users</div>
			</v-list>
		</section>
	</div>
</template>

<style scoped>
.subject-navigation {
	display: flex;
	flex-direction: column;
	block-size: 100%;
	min-block-size: 0;
}

.search {
	flex: none;
	padding: 12px 12px 0;
	--theme--form--field--input--height: 36px;
}

.public {
	flex: none;
}

.group {
	display: flex;
	flex-direction: column;
	min-block-size: 0;
	padding-inline: 12px;
}

/* Each section scrolls on its own, so neither pushes the other off screen. */
.roles {
	flex: 0 1 auto;
	max-block-size: 45%;
}

.users {
	flex: 1 1 0;
}

.title {
	flex: none;
}

.title {
	margin-block: 12px 8px;
	padding-inline: 4px;
	--v-divider-label-color: var(--theme--foreground-subdued);
}

.scroll {
	min-block-size: 0;
	padding-inline: 0 !important;
	overflow-y: auto;
}

.inactive :deep(.v-text-overflow),
.inactive .v-icon {
	color: var(--theme--foreground-subdued);
	--v-icon-color: var(--theme--foreground-subdued);
}

.empty {
	padding: 8px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}
</style>
