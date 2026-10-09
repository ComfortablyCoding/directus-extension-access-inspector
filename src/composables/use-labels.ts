import { useI18n } from 'vue-i18n';
import type { Action, Level } from '../lib/access.js';
import type { PolicyRow, RoleRow } from '../lib/policies.js';

export const ACTION_LABELS: Record<Action, string> = {
	create: 'Create',
	read: 'Read',
	update: 'Update',
	delete: 'Delete',
	share: 'Share',
};

export const LEVEL_LABELS: Record<Level, string> = {
	full: 'Full access',
	partial: 'Custom access',
	none: 'No access',
};

/** The sections of an action's drawer, as in the permission drawer in Settings > Access Policies. */
export type Section = 'items' | 'fields' | 'validation' | 'presets';

export const SECTION_LABELS: Record<Section, string> = {
	items: 'Item Permissions',
	fields: 'Field Permissions',
	validation: 'Field Validation',
	presets: 'Field Presets',
};

interface UserLike {
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
	status?: string | null;
}

/** A user's name as the Users module shows it, falling back to their email. */
export function userName(user: UserLike): string {
	return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unnamed user';
}

export function userIcon(user: UserLike): string {
	return !user.status || user.status === 'active' ? 'account_circle' : 'no_accounts';
}

export function roleIcon(role: Pick<RoleRow, 'icon'> | null | undefined): string {
	return role?.icon || 'supervised_user_circle';
}

/** The minimal permissions Directus adds for app access have no policy. */
export const APP_ACCESS = {
	name: 'App Access',
	icon: 'dashboard',
	description: 'Built-in minimum for using the Data Studio',
};

export function useLabels() {
	const { t, te } = useI18n();

	// Policy and role names can be translation keys, such as the public policy's `$t:public_label`.
	function translate(value: string | null | undefined): string {
		if (!value) return '';
		if (!value.startsWith('$t:')) return value;
		const key = value.slice(3);
		return te(key) ? t(key) : key;
	}

	function policyName(policy: PolicyRow | null | undefined): string {
		return policy ? translate(policy.name) || 'Untitled policy' : APP_ACCESS.name;
	}

	function roleName(role: RoleRow | null | undefined): string {
		return role ? translate(role.name) || 'Untitled role' : 'Unknown role';
	}

	return { policyName, roleName };
}
