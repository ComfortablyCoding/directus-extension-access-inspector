// Explains how Directus combines a subject's permissions for one collection. Mirrors the API's permissions modules:
// - an action is allowed when at least one permission exists for it (validateCollectionAccess)
// - item rules are combined with OR; a permission without one covers every item (getCases)
// - a field is read or updated on an item when a permission granting that field covers the item (injectCases)
// - create and update payloads may only use the union of the permitted fields (processPayload)
// - every permission's validation must pass, combined with AND, and presets merge in policy order (processPayload)

import { type Resolution, activePolicyIds } from './policies.js';

export const ACTIONS = ['create', 'read', 'update', 'delete', 'share'] as const;
export type Action = (typeof ACTIONS)[number];

/** Actions whose permissions list fields. */
const FIELD_ACTIONS = ['create', 'read', 'update'] as const;

/** Actions whose permissions restrict which items they apply to. Create has no item rule. */
const ITEM_ACTIONS: readonly Action[] = ['read', 'update', 'delete', 'share'];

export type Filter = Record<string, unknown>;

export interface PermissionRow {
	id?: number | string | null;
	/** The granting policy, or null for the minimal permissions Directus adds for app access. */
	policy: string | null;
	collection: string;
	action: Action;
	permissions: Filter | null;
	validation: Filter | null;
	presets: Record<string, unknown> | null;
	fields: string[] | null;
}

export type Level = 'none' | 'partial' | 'full';

export interface FieldAccess {
	/** The permissions that list this field, in policy order. */
	permissions: PermissionRow[];
	/** 'all' when a granting permission has no item rule; 'some' when the field depends on the item. */
	items: 'all' | 'some' | 'none';
}

export interface PresetSource {
	field: string;
	value: unknown;
	permission: PermissionRow;
	/** Earlier permissions whose value for this field is replaced. */
	overrides: PermissionRow[];
}

export interface ActionAccess {
	action: Action;
	level: Level;
	permissions: PermissionRow[];
	/** 'all' items, or the rules of which an item must match at least one. Empty when there is no access. */
	items: 'all' | Filter[];
	fields: Record<string, FieldAccess>;
	/** Rules a create or update payload must pass, all of them. */
	validation: { rule: Filter; permission: PermissionRow }[];
	presets: PresetSource[];
	/** Reading is allowed but no permission grants a field: Directus then returns bare primary keys (and counts). */
	keysOnly: boolean;
}

export function hasRule(filter: Filter | null | undefined): filter is Filter {
	return filter !== null && filter !== undefined && Object.keys(filter).length > 0;
}

function grantsField(permission: PermissionRow, field: string): boolean {
	return !!permission.fields && (permission.fields.includes('*') || permission.fields.includes(field));
}

/**
 * @param fields The collection's fields, in display order.
 * @param permissions The subject's permissions for the collection, in policy order.
 * @param primary The primary key field, which reads without any granted fields still return.
 */
export function analyzeAction(
	action: Action,
	fields: string[],
	permissions: PermissionRow[],
	primary?: string,
): ActionAccess {
	const own = permissions.filter((permission) => permission.action === action);
	const itemRules = ITEM_ACTIONS.includes(action);
	const unrestricted = (permission: PermissionRow) => !itemRules || !hasRule(permission.permissions);

	const items: ActionAccess['items'] = own.some(unrestricted)
		? 'all'
		: own.map((permission) => permission.permissions).filter(hasRule);

	const fieldAccess: Record<string, FieldAccess> = {};

	if ((FIELD_ACTIONS as readonly Action[]).includes(action)) {
		for (const field of fields) {
			const granting = own.filter((permission) => grantsField(permission, field));
			fieldAccess[field] = {
				permissions: granting,
				items: granting.length === 0 ? 'none' : granting.some(unrestricted) ? 'all' : 'some',
			};
		}
	}

	const keysOnly = action === 'read' && own.length > 0 && own.every((permission) => !permission.fields?.length);

	if (keysOnly && primary && fieldAccess[primary]) {
		fieldAccess[primary] = { permissions: own, items: items === 'all' ? 'all' : 'some' };
	}

	const validation =
		action === 'create' || action === 'update'
			? own.flatMap((permission) =>
					hasRule(permission.validation) ? [{ rule: permission.validation, permission }] : [],
				)
			: [];

	const presets: PresetSource[] = [];

	if (action === 'create' || action === 'update') {
		for (const permission of own) {
			for (const [field, value] of Object.entries(permission.presets ?? {})) {
				const index = presets.findIndex((preset) => preset.field === field);
				const previous = index === -1 ? null : presets.splice(index, 1)[0]!;
				const overrides = previous ? [...previous.overrides, previous.permission] : [];
				presets.push({ field, value, permission, overrides });
			}
		}
	}

	return {
		action,
		level: levelOf(own, items, fieldAccess),
		permissions: own,
		items,
		fields: fieldAccess,
		validation,
		presets,
		keysOnly,
	};
}

function levelOf(own: PermissionRow[], items: ActionAccess['items'], fields: Record<string, FieldAccess>): Level {
	if (own.length === 0) return 'none';
	if (items !== 'all') return 'partial';
	return Object.values(fields).every((field) => field.items === 'all') ? 'full' : 'partial';
}

/**
 * Whether a field comes with every item the action is allowed on. It does when a policy grants it on all items, or when
 * every permission allowing the action grants it. Otherwise items allowed only through the other permissions leave it
 * out: reads return it as null, and updates to it are rejected.
 */
export type Coverage = 'full' | 'partial' | 'none';

export function fieldCoverage(access: ActionAccess, field: string): Coverage {
	const fieldAccess = access.fields[field];
	if (!fieldAccess || fieldAccess.items === 'none') return 'none';
	if (fieldAccess.items === 'all') return 'full';
	return access.permissions.every((permission) => fieldAccess.permissions.includes(permission)) ? 'full' : 'partial';
}

export type CollectionAccess = Record<Action, ActionAccess>;

/** The other level of every action whose level differs between two analyses, by collection. */
export function diffAccess(
	current: Record<string, CollectionAccess>,
	other: Record<string, CollectionAccess>,
): Record<string, Partial<Record<Action, Level>>> {
	const result: Record<string, Partial<Record<Action, Level>>> = {};

	for (const [collection, actions] of Object.entries(current)) {
		for (const action of ACTIONS) {
			const level = other[collection]?.[action].level ?? 'none';
			if (level !== actions[action].level) (result[collection] ??= {})[action] = level;
		}
	}

	return result;
}

function byAction(analyze: (action: Action) => ActionAccess): CollectionAccess {
	return {
		create: analyze('create'),
		read: analyze('read'),
		update: analyze('update'),
		delete: analyze('delete'),
		share: analyze('share'),
	};
}

export function analyzeCollection(fields: string[], permissions: PermissionRow[], primary?: string): CollectionAccess {
	return byAction((action) => analyzeAction(action, fields, permissions, primary));
}

const allowEverything = (action: Action): PermissionRow => ({
	policy: null,
	collection: '',
	action,
	permissions: null,
	validation: null,
	presets: null,
	fields: ['*'],
});

/** Everything allowed, as Directus bypasses permissions for admins. */
export function adminCollectionAccess(fields: string[]): CollectionAccess {
	return byAction((action) => ({ ...analyzeAction(action, fields, [allowEverything(action)]), permissions: [] }));
}

/** A resolution's permissions, from those loaded for several, in its policy order. */
export function permissionsFor(all: PermissionRow[], resolution: Resolution | null): PermissionRow[] {
	if (!resolution || resolution.admin) return [];
	const order = activePolicyIds(resolution);

	return all
		.filter(({ policy }) => (policy === null ? resolution.app : order.includes(policy)))
		.map((permission, index) => ({ permission, index }))
		.toSorted((a, b) => rank(a.permission) - rank(b.permission) || a.index - b.index)
		.map(({ permission }) => permission);

	// The built-in app permissions come after every policy's.
	function rank(permission: PermissionRow) {
		return permission.policy === null ? order.length : order.indexOf(permission.policy);
	}
}
