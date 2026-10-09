// Explains how Directus would answer a request for the inspected subject, step by step, in the order the API checks:
// the collection, the action, the fields (following relations), the item, the payload's fields on that item, and
// validation. Status codes follow Directus: 403 for anything not allowed (or not existing), 400 for a query or payload
// Directus rejects, such as a filter operator the field's type doesn't have or failed validation.
import { type Action, type CollectionAccess, type Filter, type PermissionRow, hasRule } from './access.js';
import { filterOperatorsForType, functionsForType, outputTypeForFunction } from './field-types.js';
import { type PathOutcome, type RelationRow, checkPath, permittedFields } from './relations.js';
import type { FieldInfo } from './schema.js';
import { checkRule } from './validate.js';
import { type VariableContext, UnknownVariableError, resolveRules, resolveVariables } from './variables.js';

export interface ParsedRequest {
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
	collection: string;
	key: string | null;
	fields: string[] | null;
	filter: Filter | null;
	sort: string[];
	body: Record<string, unknown> | null;
}

const METHOD_ACTIONS: Record<ParsedRequest['method'], Action> = {
	GET: 'read',
	POST: 'create',
	PATCH: 'update',
	DELETE: 'delete',
};

/**
 * Reads a request as written in docs or copied from the browser: `PATCH /items/articles/3` with an optional JSON body on
 * the following lines. System collections use their own endpoints, such as `/users/<id>`.
 */
export function parseRequest(text: string, collections: string[]): ParsedRequest | { error: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: 'Enter a request, such as GET /items/articles?fields=title.' };

	const newline = trimmed.indexOf('\n');
	const line = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
	const rest = newline === -1 ? '' : trimmed.slice(newline + 1).trim();

	const match = line.match(/^(?:(GET|POST|PATCH|DELETE)\s+)?(\S+)$/i);
	if (!match) return { error: 'Start with a method and a path, such as PATCH /items/articles/3.' };

	const method = (match[1]?.toUpperCase() ?? 'GET') as ParsedRequest['method'];
	let url: URL;

	try {
		url = new URL(match[2]!, 'http://directus.local');
	} catch {
		return { error: 'The path isn’t a valid URL.' };
	}

	let segments: string[];

	try {
		segments = url.pathname
			.split('/')
			.filter(Boolean)
			.map((segment) => decodeURIComponent(segment));
	} catch {
		return { error: 'The path isn’t a valid URL.' };
	}
	if (segments[0] === 'admin' || segments[0] === 'api') segments.shift();

	let collection: string;
	let key: string | null;

	if (segments[0] === 'items') {
		if (!segments[1]) return { error: 'Add the collection, such as /items/articles.' };
		collection = segments[1];
		key = segments[2] ?? null;
	} else if (segments[0] && collections.includes(`directus_${segments[0]}`)) {
		collection = `directus_${segments[0]}`;
		key = segments[1] ?? null;
	} else {
		return { error: 'Use an items endpoint, such as /items/articles, or a system one, such as /users.' };
	}

	if (key === 'me') return { error: 'Use the user’s id instead of /me.' };

	let body: Record<string, unknown> | null = null;

	if (rest) {
		try {
			body = JSON.parse(rest);
		} catch {
			return { error: 'The body isn’t valid JSON.' };
		}
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return { error: 'Use a single object as the body; batches aren’t supported.' };
		}
	}

	const query = parseQuery(url.searchParams);
	if ('error' in query) return query;

	return { method, collection, key, body, ...query };
}

function parseQuery(params: URLSearchParams): Pick<ParsedRequest, 'fields' | 'filter' | 'sort'> | { error: string } {
	const fields: string[] = [];
	const sort: string[] = [];
	let filter: Filter | null = null;

	for (const [name, value] of params) {
		if (name === 'fields' || name === 'fields[]') fields.push(...value.split(',').map((field) => field.trim()));
		else if (name === 'sort' || name === 'sort[]') sort.push(...value.split(',').map((field) => field.trim()));
		else if (name === 'filter') {
			try {
				filter = JSON.parse(value);
			} catch {
				return { error: 'The filter isn’t valid JSON.' };
			}
		} else if (name.startsWith('filter[')) {
			// filter[author][first_name][_eq]=Ada
			const path = [...name.slice('filter'.length).matchAll(/\[([^\]]*)\]/g)].map((part) => part[1]!);
			filter ??= {};
			let node = filter as Record<string, unknown>;
			for (const [index, part] of path.entries()) {
				if (index === path.length - 1) node[part] = value;
				else node = (node[part] ??= {}) as Record<string, unknown>;
			}
		}
	}

	return {
		fields: fields.filter(Boolean).length > 0 ? fields.filter(Boolean) : null,
		filter: filter && (toArrays(filter) as Filter),
		sort: sort.filter(Boolean),
	};
}

/** Brackets give `filter[_or][0][title][_eq]` as an object keyed 0, 1…; Directus reads those as lists. */
function toArrays(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(toArrays);

	const entries = Object.entries(value).map(([key, entry]) => [key, toArrays(entry)] as const);
	const keys = entries.map(([key]) => key);
	if (keys.length > 0 && keys.every((key, index) => key === String(index))) return entries.map(([, entry]) => entry);
	return Object.fromEntries(entries);
}

/** Each condition in a filter: the field path, such as ['author', 'first_name'], and its operator. */
export function filterConditions(filter: unknown, path: string[] = []): { path: string[]; operator: string | null }[] {
	if (!filter || typeof filter !== 'object' || Array.isArray(filter))
		return path.length > 0 ? [{ path, operator: null }] : [];

	return Object.entries(filter).flatMap(([key, value]) => {
		if (key === '_and' || key === '_or')
			return (Array.isArray(value) ? value : []).flatMap((child) => filterConditions(child, path));
		if (key === '_some' || key === '_none') return filterConditions(value, path);
		if (key.startsWith('_')) return path.length > 0 ? [{ path, operator: key }] : [];
		return filterConditions(value, [...path, key]);
	});
}

/** The field paths a filter uses, such as ['author', 'first_name']. */
export function filterPaths(filter: unknown): string[][] {
	return filterConditions(filter).map(({ path }) => path);
}

export interface Step {
	status: 'pass' | 'fail' | 'warn';
	title: string;
	detail?: string;
}

export interface Explanation {
	status: 200 | 204 | 400 | 403;
	steps: Step[];
}

export interface ExplainContext {
	access: Record<string, CollectionAccess>;
	relations: RelationRow[];
	admin: boolean;
	primaryOf: (collection: string) => string | undefined;
	/** A field's type and special flags, which decide the functions and filter operators Directus accepts. */
	fieldInfo: (collection: string, field: string) => Pick<FieldInfo, 'type' | 'special'> | undefined;
	collectionName: (collection: string) => string;
	policyName: (permission: PermissionRow) => string;
	variables: VariableContext;
	/** Whether the item exists and, for each rule, whether it matches; read without permission checks. */
	testItem: (
		collection: string,
		key: string,
		rules: (Filter | null)[],
	) => Promise<{ exists: boolean; matches: boolean[] }>;
}

export async function explain(request: ParsedRequest, context: ExplainContext): Promise<Explanation> {
	const steps: Step[] = [];
	const fail = (status: 400 | 403, title: string, detail?: string): Explanation => {
		steps.push({ status: 'fail', title, detail });
		return { status, steps };
	};

	const action = METHOD_ACTIONS[request.method];
	const access = context.access[request.collection];
	const name = access ? context.collectionName(request.collection) : request.collection;
	const success = request.method === 'DELETE' ? 204 : 200;

	if (!access) {
		return fail(
			403,
			`“${request.collection}” doesn’t exist`,
			'Directus answers 403 rather than revealing which collections exist.',
		);
	}

	if (context.admin) {
		steps.push({ status: 'pass', title: 'Admin access', detail: 'Directus skips permission checks for admins.' });
		return { status: success, steps };
	}

	const entry = access[action];
	const names = (permissions: PermissionRow[]) => [...new Set(permissions.map(context.policyName))].join(', ');

	if (entry.level === 'none') return fail(403, `No policy allows ${action} on ${name}`);
	steps.push({
		status: 'pass',
		title: `${capitalize(action)} is allowed on ${name}`,
		detail: `By ${names(entry.permissions)}.`,
	});

	// Fields, filters and sorting, following relations. Permissions come first; then what the field's type allows.
	const notReachable = (path: string, outcome: PathOutcome & { result: 'unknown' }): Step => ({
		status: 'warn',
		title: `Can’t check ${path}`,
		detail: `It goes through a many-to-any relation in ${context.collectionName(outcome.collection)}. Name the collection to follow, such as item:articles.title, to check it.`,
	});

	if (request.method === 'GET') {
		for (const path of request.fields ?? ['*']) {
			const outcome = checkPath({
				...pathContext(context, request.collection),
				path: path.split('.'),
				usage: 'fields',
			});
			if (outcome.result === 'forbidden') {
				return fail(
					403,
					`Can’t read ${path}`,
					`${outcome.field ?? 'It'} isn’t a field this subject can read in ${context.collectionName(outcome.collection)}.`,
				);
			}
			if (outcome.result === 'dropped') {
				steps.push({
					status: 'warn',
					title: `${path} is left out`,
					detail: `There’s no read access to it in ${context.collectionName(outcome.collection)}, so Directus leaves it out of the response.`,
				});
			}
			if (outcome.result === 'unknown') steps.push(notReachable(path, outcome));
			if (outcome.result === 'allowed' && outcome.fn) {
				const invalid = invalidFunction(context, outcome);
				if (invalid) return fail(400, `Can’t use ${outcome.fn}() on ${path.replace(/^.*\(|\)$/g, '')}`, invalid);
			}
		}
	}

	const conditions = filterConditions(request.filter).map(({ path, operator }) => ({
		usage: 'filter',
		path,
		operator,
	}));
	const sorting = request.sort.map((field) => ({
		usage: 'sort',
		path: field.replace(/^-/, '').split('.'),
		operator: null,
	}));

	for (const { usage, path, operator } of [...conditions, ...sorting]) {
		const outcome = checkPath({ ...pathContext(context, request.collection), path, usage: 'filter' });
		if (outcome.result === 'forbidden') {
			return fail(
				403,
				`Can’t ${usage} by ${path.join('.')}`,
				`${usage === 'filter' ? 'Filters' : 'Sorting'} need read access to every field on the way, in ${context.collectionName(outcome.collection)}.`,
			);
		}
		if (outcome.result === 'unknown') steps.push(notReachable(path.join('.'), outcome));
		if (outcome.result !== 'allowed') continue;

		if (outcome.fn) {
			const invalid = invalidFunction(context, outcome);
			if (invalid) return fail(400, `Can’t ${usage} by ${path.join('.')}`, invalid);
		}

		if (operator) {
			const invalid = invalidOperator(context, outcome, operator);
			if (invalid) return fail(400, `Can’t filter ${path.join('.')} with ${operator}`, invalid);
		}
	}

	if (request.fields || request.filter || request.sort.length > 0) {
		if (!steps.some(({ status }) => status === 'warn'))
			steps.push({ status: 'pass', title: 'The requested fields, filters and sorting are allowed' });
	}

	// The payload's fields, against everything the action allows.
	const payloadFields = request.body ? Object.keys(request.body) : [];

	if (request.method === 'POST' || request.method === 'PATCH') {
		const allowed = permittedFields(access, action)!;
		const forbidden = allowed.has('*') ? [] : payloadFields.filter((field) => !allowed.has(field));
		if (forbidden.length > 0)
			return fail(
				403,
				`Can’t ${action} ${forbidden.join(', ')}`,
				`No policy allows ${action} on ${forbidden.length === 1 ? 'this field' : 'these fields'}.`,
			);
	}

	// The item.
	if (request.key !== null && action !== 'create') {
		const primary = context.primaryOf(request.collection);
		if (!primary) return fail(403, `${name} has no primary key to look up`);

		const resolved = resolveRules(
			entry.permissions.map(({ permissions }) => (hasRule(permissions) ? permissions : null)),
			context.variables,
		);

		const tested = await context.testItem(
			request.collection,
			request.key,
			resolved.map((rule) => (rule === 'unknown' ? null : rule)),
		);

		if (!tested.exists)
			return fail(
				403,
				`Item ${request.key} doesn’t exist`,
				'Directus answers 403 rather than revealing which items exist.',
			);

		const matching = entry.permissions.filter((_, index) => resolved[index] !== 'unknown' && tested.matches[index]);
		const unknown = entry.permissions.filter((_, index) => resolved[index] === 'unknown');

		if (matching.length === 0) {
			if (unknown.length > 0) {
				steps.push({
					status: 'warn',
					title: `Item ${request.key} depends on the user`,
					detail: `${names(unknown)} compares it with the current user; inspect a user to check it.`,
				});
				return { status: success, steps };
			}
			return fail(403, `Item ${request.key} matches none of the ${action} rules`);
		}

		steps.push({
			status: 'pass',
			title: `Item ${request.key} can be ${past(action)}`,
			detail: `It matches ${names(matching)}.`,
		});

		// Each field needs a permission that grants it to match the item too.
		const covered = (field: string) =>
			(entry.fields[field]?.permissions ?? []).some((permission) => matching.includes(permission));

		if (request.method === 'PATCH') {
			const blocked = payloadFields.filter((field) => !covered(field));
			if (blocked.length > 0) {
				return fail(
					403,
					`Can’t update ${blocked.join(', ')} on item ${request.key}`,
					'Only policies whose rules don’t match this item grant these fields.',
				);
			}
		}

		if (request.method === 'GET') {
			const requested = (request.fields ?? ['*']).filter((field) => !field.includes('.'));
			const top = requested.includes('*') ? Object.keys(entry.fields) : requested;
			const nulls = top.filter(
				(field) => entry.fields[field] && entry.fields[field].items !== 'none' && !covered(field),
			);
			if (nulls.length > 0) {
				steps.push({
					status: 'warn',
					title: `Null on item ${request.key}: ${nulls.join(', ')}`,
					detail: 'Only policies whose rules don’t match this item grant these fields.',
				});
			}
		}
	}

	// Validation from every policy, on the payload with presets applied.
	if (request.method === 'POST' || request.method === 'PATCH') {
		// Presets merge in policy order; one that reads the current user can't be known for a role.
		const presets: Record<string, unknown> = {};
		const unknownPresets = new Set<string>();

		for (const permission of entry.permissions) {
			for (const [field, value] of Object.entries(permission.presets ?? {})) {
				try {
					presets[field] = resolveVariables(value, context.variables);
					unknownPresets.delete(field);
				} catch (error) {
					if (!(error instanceof UnknownVariableError)) throw error;
					delete presets[field];
					unknownPresets.add(field);
				}
			}
		}

		const payload = { ...presets, ...request.body };
		const unsure = [...unknownPresets].filter((field) => !(field in payload));
		if (unsure.length > 0)
			steps.push({
				status: 'warn',
				title: `The preset for ${unsure.join(', ')} depends on the user`,
				detail: 'Validation is checked without it; inspect a user to include it.',
			});

		for (const { rule, permission } of entry.validation) {
			let resolved: Record<string, unknown>;
			try {
				resolved = resolveVariables(rule, context.variables) as Record<string, unknown>;
			} catch {
				steps.push({ status: 'warn', title: `${context.policyName(permission)}’s validation depends on the user` });
				continue;
			}
			const result = checkRule(resolved, payload);
			if (!result.passes)
				return fail(
					400,
					`${context.policyName(permission)}’s validation fails`,
					'Every policy’s validation must pass, with presets applied to the payload.',
				);
			if (result.unknown.length > 0)
				steps.push({
					status: 'warn',
					title: `Couldn’t check part of ${context.policyName(permission)}’s validation`,
					detail: result.unknown.join(', '),
				});
		}

		if (entry.validation.length > 0)
			steps.push({ status: 'pass', title: 'The payload passes every policy’s validation' });

		const answer = await readBack(request, context, access.read, name);
		if (answer.step) steps.push(answer.step);
		return { status: answer.status, steps };
	}

	return { status: success, steps };
}

/** A 204 answer, without the item. */
const noContent = (detail: string) => ({
	status: 204 as const,
	step: { status: 'pass' as const, title: 'Directus answers 204, without the item', detail },
});

/**
 * Directus answers a create or update with the item, read back with the subject's read permissions. When it can't be
 * read, the answer is 204, without it.
 */
async function readBack(
	request: ParsedRequest,
	context: ExplainContext,
	read: CollectionAccess['read'],
	name: string,
): Promise<{ status: 200 | 204; step?: Step }> {
	const done = request.method === 'POST' ? 'created' : 'updated';
	if (read.level === 'none') return noContent(`There’s no read access to ${name}, so the ${done} item isn’t returned.`);
	if (read.items === 'all') return { status: 200 };

	// An update that leaves the read rules' fields alone keeps the item's match, which can be tested now.
	const rules = read.permissions.map(({ permissions }) => (hasRule(permissions) ? permissions : null));
	const ruleFields = new Set(rules.flatMap((rule) => filterPaths(rule).map(([field]) => field)));
	const changesRules = Object.keys(request.body ?? {}).some((field) => ruleFields.has(field));
	const resolved = resolveRules(rules, context.variables);

	if (request.method === 'PATCH' && request.key !== null && !changesRules && !resolved.includes('unknown')) {
		const tested = await context.testItem(request.collection, request.key, resolved as (Filter | null)[]);
		if (tested.matches.some(Boolean)) return { status: 200 };
		return noContent(`Item ${request.key} matches none of the read rules, so it isn’t returned.`);
	}

	return {
		status: 200,
		step: {
			status: 'warn',
			title: 'Directus may answer 204 instead',
			detail: `It answers 204, without the item, when the ${done} item matches none of the read rules.`,
		},
	};
}

/** Why Directus refuses a function, such as year() on a text field, or null when it accepts it. */
function invalidFunction(context: ExplainContext, { collection, field, fn }: PathOutcome & { result: 'allowed' }) {
	const type = context.fieldInfo(collection!, field!)?.type;
	if (!type || !fn) return null;
	const allowed = functionsForType(type);
	return allowed.includes(fn) ? null : `${fn}() doesn’t apply to ${type} fields, so Directus answers 400.`;
}

/** Why Directus refuses a filter operator for the field's type, as for hashed passwords, or null when it accepts it. */
function invalidOperator(
	context: ExplainContext,
	{ collection, field, fn }: PathOutcome & { result: 'allowed' },
	operator: string,
) {
	const info = context.fieldInfo(collection!, field!);
	if (!info) return null;
	const type = (fn ? outputTypeForFunction(fn) : info.type) ?? '';
	const concealed = info.special?.includes('conceal');
	// Concealed fields, such as tokens, only allow the operators hashed ones do.
	const allowed = filterOperatorsForType(concealed ? 'hash' : type);
	if (allowed.includes(operator.replace(/^_/, ''))) return null;

	const kind = type === 'hash' ? 'Hashed' : concealed ? 'Concealed' : `${capitalize(type)}`;
	return allowed.length <= 4
		? `${kind} fields only allow ${allowed.map((name) => `_${name}`).join(', ')}, so Directus answers 400.`
		: `${kind} fields don’t have ${operator}, so Directus answers 400.`;
}

function pathContext(context: ExplainContext, collection: string) {
	return { collection, relations: context.relations, access: context.access, admin: context.admin };
}

function capitalize(text: string) {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function past(action: Action) {
	return { create: 'created', read: 'read', update: 'updated', delete: 'deleted', share: 'shared' }[action];
}
