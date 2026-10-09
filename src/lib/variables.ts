// Resolves the dynamic variables in permission rules for the inspected subject, the way Directus does for a request,
// so the rules can be tested against items. $NOW and its adjustments are left for the API to resolve.

export interface VariableContext {
	/** The user's id and any fields rules read from it, or null for the public and roles. */
	user: Record<string, unknown> | null;
	/** True when inspecting a role: rules that read the user can't be tested without one. */
	userUnknown: boolean;
	role: Record<string, unknown> | null;
	roles: string[];
	policies: string[];
}

/** Thrown when a rule needs a user while inspecting a role. */
export class UnknownVariableError extends Error {}

/** The user and role fields that rules read, such as `section` from `$CURRENT_USER.section`. */
export function requiredFields(rules: unknown[]): { user: string[]; role: string[] } {
	const user = new Set<string>();
	const role = new Set<string>();

	function walk(value: unknown) {
		if (typeof value === 'string') {
			if (value.startsWith('$CURRENT_USER.')) user.add(value.slice('$CURRENT_USER.'.length));
			if (value.startsWith('$CURRENT_ROLE.')) role.add(value.slice('$CURRENT_ROLE.'.length));
		} else if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === 'object') Object.values(value).forEach(walk);
	}

	rules.forEach(walk);
	return { user: [...user], role: [...role] };
}

/** Resolves each rule; a rule that reads the current user is 'unknown' when there's no user, as for a role. */
export function resolveRules<T>(rules: (T | null)[], context: VariableContext): (T | null | 'unknown')[] {
	return rules.map((rule) => {
		if (!rule) return null;
		try {
			return resolveVariables(rule, context) as T;
		} catch (error) {
			if (error instanceof UnknownVariableError) return 'unknown';
			throw error;
		}
	});
}

export function resolveVariables(value: unknown, context: VariableContext): unknown {
	if (typeof value === 'string') return resolveString(value, context);
	if (Array.isArray(value)) return value.map((entry) => resolveVariables(entry, context));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveVariables(entry, context)]));
	}
	return value;
}

function resolveString(value: string, context: VariableContext): unknown {
	if (value === '$CURRENT_USER' || value.startsWith('$CURRENT_USER.')) {
		if (context.userUnknown) throw new UnknownVariableError(value);
		if (value === '$CURRENT_USER') return context.user?.['id'] ?? null;
		return readPath(context.user, value.slice('$CURRENT_USER.'.length));
	}

	if (value === '$CURRENT_ROLE') return context.role?.['id'] ?? null;
	if (value.startsWith('$CURRENT_ROLE.')) return readPath(context.role, value.slice('$CURRENT_ROLE.'.length));
	if (value === '$CURRENT_ROLES') return context.roles;
	if (value === '$CURRENT_POLICIES') return context.policies;

	return value;
}

// Relational values come back as objects or lists of objects, which rules compare by key.
function readPath(record: Record<string, unknown> | null, path: string): unknown {
	let current: unknown = record;

	for (const segment of path.split('.')) {
		if (Array.isArray(current)) current = current.map((entry) => (entry as Record<string, unknown>)?.[segment]);
		else current = (current as Record<string, unknown> | null)?.[segment] ?? null;
	}

	return current ?? null;
}
