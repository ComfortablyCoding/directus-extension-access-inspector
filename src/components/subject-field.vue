<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { roleIcon, useLabels, userIcon, userName } from '../composables/use-labels.js';
import { useUserSearch } from '../composables/use-user-search.js';
import { type RoleRow, type Subject, flattenRoleTree, roleTree } from '../lib/policies.js';

// Picks who to compare with: a field that lists the public and the roles, and searches users as you type.
const props = defineProps<{
	roles: RoleRow[];
	subject: Subject | null;
	/** What the field shows for the current subject. */
	name: string | null;
	icon: string;
	placeholder: string;
	/** Offers a way to clear the choice, for optional fields. */
	clearable?: boolean;
}>();

const emit = defineEmits<{ pick: [subject: Subject]; clear: [] }>();

const { roleName } = useLabels();

const open = ref(false);
const USER_LIMIT = 10;
const { search, users, loading: loadingUsers, load: loadUsers } = useUserSearch(USER_LIMIT);

// Roles as a tree, parents first, with each role's depth for indenting; flat while searching.
const roleRows = computed(() => {
	const query = search.value.trim().toLowerCase();
	const rows = flattenRoleTree(roleTree(props.roles));
	if (!query) return rows;
	return rows
		.filter(({ role }) => roleName(role).toLowerCase().includes(query))
		.map(({ role }) => ({ role, depth: 0 }));
});

const showPublic = computed(() => {
	const query = search.value.trim().toLowerCase();
	return !query || 'public'.includes(query);
});

watch(open, async (isOpen) => {
	if (!isOpen) return;
	search.value = '';
	loadUsers();
	await nextTick();
	document.querySelector<HTMLInputElement>('.subject-field-menu input')?.focus();
});

function isActive(type: Subject['type'], id?: string) {
	const subject = props.subject;
	return !!subject && subject.type === type && (subject.type === 'public' || subject.id === id);
}

function pick(subject: Subject) {
	open.value = false;
	emit('pick', subject);
}
</script>

<template>
	<v-menu v-model="open" attached :close-on-content-click="false" full-height>
		<template #activator="{ toggle }">
			<div class="subject-field" :class="{ open, empty: !subject }">
				<button type="button" class="trigger" @click="toggle">
					<v-icon :name="subject ? icon : 'search'" class="leading" />
					<span v-if="subject" class="name">{{ name }}</span>
					<span v-else class="placeholder">{{ placeholder }}</span>
					<v-icon v-if="!clearable || !subject" name="expand_more" class="chevron" />
				</button>
				<button
					v-if="clearable && subject"
					v-tooltip="'Clear'"
					type="button"
					class="clear"
					aria-label="Clear"
					@click="emit('clear')"
				>
					<v-icon name="close" />
				</button>
			</div>
		</template>

		<div class="subject-field-menu">
			<div class="search">
				<v-input v-model="search" small type="search" placeholder="Search roles and users">
					<template #prepend><v-icon name="search" small /></template>
				</v-input>
			</div>

			<v-list class="options">
				<v-list-item v-if="showPublic" clickable :active="isActive('public')" @click="pick({ type: 'public' })">
					<v-list-item-icon><v-icon name="public" /></v-list-item-icon>
					<v-list-item-content>Public</v-list-item-content>
				</v-list-item>

				<div class="section">Roles</div>
				<v-list-item
					v-for="{ role, depth } in roleRows"
					:key="role.id"
					clickable
					:active="isActive('role', role.id)"
					:style="{ '--depth': depth }"
					class="role"
					@click="pick({ type: 'role', id: role.id })"
				>
					<v-list-item-icon><v-icon :name="roleIcon(role)" /></v-list-item-icon>
					<v-list-item-content><v-text-overflow :text="roleName(role)" /></v-list-item-content>
				</v-list-item>
				<div v-if="roleRows.length === 0" class="empty">No roles found</div>

				<div class="section">Users</div>
				<v-list-item
					v-for="user in users"
					:key="user.id"
					clickable
					:active="isActive('user', user.id)"
					:class="{ inactive: user.status !== 'active' }"
					@click="pick({ type: 'user', id: user.id })"
				>
					<v-list-item-icon>
						<v-icon :name="userIcon(user)" />
					</v-list-item-icon>
					<v-list-item-content><v-text-overflow :text="userName(user)" /></v-list-item-content>
				</v-list-item>
				<div v-if="!loadingUsers && users.length === 0" class="empty">No users found</div>
				<div v-else-if="users.length >= USER_LIMIT" class="empty">Search to find more users</div>
			</v-list>
		</div>
	</v-menu>
</template>

<style scoped>
/* Looks like a Directus input, like the many-to-one field it behaves like. */
.subject-field {
	display: flex;
	align-items: center;
	inline-size: 100%;
	block-size: var(--theme--form--field--input--height, 52px);
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color);
	border-radius: var(--theme--border-radius);
	background-color: var(--theme--form--field--input--background);
	color: var(--theme--form--field--input--foreground);
	transition: border-color var(--fast, 125ms) var(--transition, ease);
}

.subject-field:hover {
	border-color: var(--theme--form--field--input--border-color-hover);
}

.subject-field.open,
.subject-field:focus-within {
	border-color: var(--theme--form--field--input--border-color-focus, var(--theme--primary));
}

.trigger {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 12px;
	min-inline-size: 0;
	block-size: 100%;
	padding: var(--theme--form--field--input--padding, 0 14px);
	text-align: start;
	cursor: pointer;
}

.trigger:focus-visible,
.clear:focus-visible {
	outline: none;
}

.clear {
	display: flex;
	flex-shrink: 0;
	padding-inline: 8px 14px;
	block-size: 100%;
	align-items: center;
	cursor: pointer;
	--v-icon-color: var(--theme--foreground-subdued);
	--v-icon-color-hover: var(--theme--foreground);
}

.leading {
	--v-icon-color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.name {
	flex: 1;
	min-inline-size: 0;
	overflow: hidden;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.placeholder {
	overflow: hidden;
	color: var(--theme--foreground-subdued);
	text-overflow: ellipsis;
	white-space: nowrap;
}

.placeholder {
	flex: 1;
}

.chevron {
	--v-icon-color: var(--theme--foreground-subdued);
	flex-shrink: 0;
	margin-inline-start: auto;
	transition: transform var(--fast, 125ms) var(--transition, ease);
}

.open .chevron {
	transform: rotate(180deg);
}

.subject-field-menu {
	display: flex;
	flex-direction: column;
	max-block-size: min(520px, 60vh);
}

.search {
	padding: 8px;
	--theme--form--field--input--height: 36px;
	border-block-end: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.options {
	overflow-y: auto;
}

.section {
	padding: 12px 12px 4px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
}

.role {
	padding-inline-start: calc(10px + var(--depth, 0) * 20px) !important;
}

.options :deep(.v-list-item-content) {
	display: flex;
	align-items: baseline;
	gap: 8px;
	min-inline-size: 0;
}

.inactive :deep(.v-text-overflow),
.inactive .v-icon {
	color: var(--theme--foreground-subdued);
	--v-icon-color: var(--theme--foreground-subdued);
}

.empty {
	padding: 8px 12px 12px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}
</style>
