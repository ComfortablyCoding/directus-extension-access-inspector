import { useApi } from '@directus/extensions-sdk';
import { computed, ref, watch } from 'vue';
import { type ActionAccess, type PermissionRow, hasRule } from '../lib/access.js';
import { loadVariableContext, testItem } from '../lib/load.js';
import { resolveRules } from '../lib/variables.js';
import { useInspectorContext } from './use-context.js';

export type Match = 'yes' | 'no' | 'unknown';

/**
 * Tests a specific item, like a policy simulator: which of an action's rules match it, and so whether the action and
 * each field apply to it.
 */
export function useItemTest(target: {
	access: () => ActionAccess | null;
	collection: () => string;
	primary: () => string | null;
}) {
	const api = useApi();
	const context = useInspectorContext();

	const key = ref('');
	const testing = ref(false);
	const error = ref<string | null>(null);
	const result = ref<{ key: string; exists: boolean; matches: Match[] } | null>(null);

	/** What a result applies to: the rules, in order, and who they're resolved for. */
	const scope = computed(() =>
		JSON.stringify([
			target.collection(),
			target.access()?.action,
			target.access()?.permissions.map(({ id, policy }) => [policy, id]),
			context?.subject.value,
			context?.resolution.value?.roles.at(-1),
		]),
	);

	watch(scope, () => {
		result.value = null;
		error.value = null;
		key.value = '';
	});

	async function run() {
		const tested = key.value.trim();
		const access = target.access();
		const primary = target.primary();
		const subject = context?.subject.value;
		const resolution = context?.resolution.value;
		if (!tested || !access || !primary || !subject || !resolution) return;

		testing.value = true;
		error.value = null;
		// A result for other rules or someone else, after switching while it ran, is dropped.
		const started = scope.value;

		try {
			const rules = access.permissions.map(({ permissions }) => (hasRule(permissions) ? permissions : null));
			const variables = await loadVariableContext(api, { subject, resolution, rules: rules.filter(Boolean) });

			// Rules that read the current user can't be tested for a role, which has no user.
			const resolved = resolveRules(rules, variables);

			const found = await testItem(api, {
				collection: target.collection(),
				primary,
				key: tested,
				rules: resolved.map((rule) => (rule === 'unknown' ? null : rule)),
			});

			if (started !== scope.value) return;
			result.value = {
				key: tested,
				exists: found.exists,
				matches: resolved.map((rule, index) => (rule === 'unknown' ? 'unknown' : found.matches[index] ? 'yes' : 'no')),
			};
		} catch (err) {
			if (started !== scope.value) return;
			result.value = null;
			error.value = `Couldn’t test this item: ${(err as Error).message}`;
		} finally {
			testing.value = false;
		}
	}

	function matchOf(permission: PermissionRow): Match | null {
		const access = target.access();
		if (!result.value?.exists || !access) return null;
		return result.value.matches[access.permissions.indexOf(permission)] ?? null;
	}

	function fieldOnItem(field: string): Match | null {
		// When the item itself isn't allowed, the verdict says so; per field markers would only repeat it.
		if (!result.value?.exists || !result.value.matches.some((match) => match !== 'no')) return null;
		const matches = (target.access()?.fields[field]?.permissions ?? []).map(matchOf);
		if (matches.includes('yes')) return 'yes';
		return matches.includes('unknown') ? 'unknown' : 'no';
	}

	return { key, testing, error, result, run, matchOf, fieldOnItem };
}
