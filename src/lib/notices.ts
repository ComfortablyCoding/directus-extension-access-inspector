// What blocks or overrides everything in the table, shown above it; the rest is in the sidebar.
import type { PolicyRow, Resolution, Subject } from './policies.js';

export interface Notice {
	type: 'info' | 'warning' | 'danger';
	icon: string;
	text: string;
}

const STATUS_LABELS: Record<string, string> = {
	draft: 'a draft',
	invited: 'invited and hasn’t accepted yet',
	unverified: 'unverified',
	suspended: 'suspended',
	archived: 'archived',
	'inactive-license': 'inactive because the license has no seats left',
};

export function accessNotices({
	subject,
	resolution,
	userStatus,
	customRules,
	licenseName,
	ip,
	version,
	policyName,
}: {
	subject: Subject;
	resolution: Resolution;
	/** The inspected user's status, or null for the public and roles. */
	userStatus: string | null;
	/** Whether the license includes custom permission rules. */
	customRules: boolean;
	licenseName: string | null;
	ip: string | null;
	/** The Directus version, such as 12.5.0. */
	version: string | undefined;
	policyName: (policy: PolicyRow) => string;
}): Notice[] {
	const list: Notice[] = [];
	const names = (entries: { policy: PolicyRow }[]) => entries.map(({ policy }) => policyName(policy)).join(', ');

	if (!customRules) {
		list.push({
			type: 'warning',
			icon: 'workspace_premium',
			text: `Your ${licenseName ?? 'current'} license doesn’t include custom permission rules, so Directus ignores permissions that limit fields or use item rules, validation or presets. They aren’t shown here.`,
		});
	}

	if (userStatus && userStatus !== 'active') {
		list.push({
			type: 'danger',
			icon: 'block',
			text: `This user is ${STATUS_LABELS[userStatus] ?? userStatus}, so they can’t sign in or use the API. This is what they could do once active.`,
		});
	}

	if (resolution.roleCycle) {
		list.push({
			type: 'danger',
			icon: 'error',
			text: 'This role’s parents loop back to it, so its users can’t sign in.',
		});
	}

	const admins = resolution.policies.filter(({ policy, active }) => policy.admin_access && active);
	const blocked = resolution.policies.filter(({ policy, active }) => policy.admin_access && !active);

	if (resolution.admin) {
		list.push({
			type: 'info',
			icon: 'verified_user',
			text: `Admin access from ${names(admins)}. Directus skips permission checks, so everything is allowed.`,
		});
	} else if (blocked.length > 0) {
		list.push({ type: 'warning', icon: 'lan', text: `${names(blocked)} would give admin access, but not from ${ip}.` });
	}

	// Directus 11 caches admin and app access per user without the IP (fixed in 12), so the first network to sign in
	// decides them until the cache expires.
	const ipGlobal = resolution.policies.some(
		({ policy }) => policy.ip_access?.length && (policy.admin_access || policy.app_access),
	);

	if (version?.startsWith('11.') && ipGlobal) {
		list.push({
			type: 'warning',
			icon: 'lan',
			text: 'Directus 11 caches admin and app access per user regardless of IP, so for policies limited to certain networks, whichever network signs in first decides them until the cache expires. Directus 12 fixes this.',
		});
	}

	if (subject.type !== 'public' && resolution.policies.length === 0) {
		list.push({
			type: 'warning',
			icon: 'info',
			text: 'No policies apply, so nothing is allowed. A role never falls back to the public’s access.',
		});
	}

	return list;
}
