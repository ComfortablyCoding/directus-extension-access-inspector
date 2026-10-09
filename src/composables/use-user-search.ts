import { useApi } from '@directus/extensions-sdk';
import { onBeforeUnmount, ref, watch } from 'vue';
import { type UserSummary, searchUsers } from '../lib/load.js';

/** Users matching a search by name or email, searched as you type; the latest search wins. */
export function useUserSearch(limit: number) {
	const api = useApi();
	const search = ref('');
	const users = ref<UserSummary[]>([]);
	const loading = ref(false);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let request = 0;

	async function load() {
		clearTimeout(timer);
		const current = ++request;
		loading.value = true;

		try {
			const found = await searchUsers(api, search.value.trim(), limit);
			if (current === request) users.value = found;
		} catch {
			if (current === request) users.value = [];
		} finally {
			if (current === request) loading.value = false;
		}
	}

	// Synchronous, so a load right after setting the search replaces the delayed one.
	watch(
		search,
		() => {
			clearTimeout(timer);
			timer = setTimeout(load, 200);
		},
		{ flush: 'sync' },
	);

	onBeforeUnmount(() => clearTimeout(timer));

	return { search, users, loading, load };
}
