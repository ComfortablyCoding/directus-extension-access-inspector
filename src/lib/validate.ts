// Checks a payload against a validation rule the way Directus' validatePayload does: a condition only applies to fields
// the payload contains (apart from _submitted), and groups combine with AND or OR.

export interface RuleCheck {
	passes: boolean;
	/** Operators or values this evaluator can't check, such as $NOW, which make the result uncertain. */
	unknown: string[];
}

type Rule = Record<string, unknown>;

export function checkRule(rule: Rule, payload: Record<string, unknown>): RuleCheck {
	const unknown: string[] = [];
	const passes = evaluate(rule, payload, unknown);
	return { passes, unknown };
}

function evaluate(rule: Rule, payload: Record<string, unknown>, unknown: string[]): boolean {
	return Object.entries(rule).every(([key, condition]) => {
		if (key === '_and') return (condition as Rule[]).every((child) => evaluate(child, payload, unknown));
		if (key === '_or') return (condition as Rule[]).some((child) => evaluate(child, payload, unknown));

		const conditions = condition as Rule;
		const submitted = key in payload;
		const value = payload[key];

		return Object.entries(conditions).every(([operator, expected]) => {
			if (operator === '_submitted') return submitted === (expected === true || expected === 'true');
			if (!submitted) return true;

			// A relational field's nested rules apply to the nested payload.
			if (!operator.startsWith('_')) {
				if (value && typeof value === 'object' && !Array.isArray(value)) {
					return evaluate({ [operator]: expected } as Rule, value as Record<string, unknown>, unknown);
				}
				unknown.push(`${key}.${operator}`);
				return true;
			}

			if (typeof expected === 'string' && expected.startsWith('$')) {
				unknown.push(`${key} ${operator} ${expected}`);
				return true;
			}

			const result = compare(operator, value, expected);
			if (result === undefined) {
				unknown.push(`${key} ${operator}`);
				return true;
			}
			return result;
		});
	});
}

function compare(operator: string, value: unknown, expected: any): boolean | undefined {
	const text = typeof value === 'string' ? value : value === null || value === undefined ? null : String(value);
	const needle = expected === null || expected === undefined ? '' : String(expected);
	const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);

	switch (operator) {
		case '_eq':
			return value === expected;
		case '_neq':
			return value !== expected;
		case '_lt':
			return value !== null && (value as number) < expected;
		case '_lte':
			return value !== null && (value as number) <= expected;
		case '_gt':
			return value !== null && (value as number) > expected;
		case '_gte':
			return value !== null && (value as number) >= expected;
		case '_in':
			return toList(expected).includes(value);
		case '_nin':
			return !toList(expected).includes(value);
		case '_null':
			return (value === null) === isTrue(expected);
		case '_nnull':
			return (value !== null) === isTrue(expected);
		case '_empty':
			return empty === isTrue(expected);
		case '_nempty':
			return !empty === isTrue(expected);
		case '_contains':
			return text !== null && text.includes(needle);
		case '_ncontains':
			return text === null || !text.includes(needle);
		case '_icontains':
			return text !== null && text.toLowerCase().includes(needle.toLowerCase());
		case '_starts_with':
			return text !== null && text.startsWith(needle);
		case '_nstarts_with':
			return text === null || !text.startsWith(needle);
		case '_ends_with':
			return text !== null && text.endsWith(needle);
		case '_nends_with':
			return text === null || !text.endsWith(needle);
		case '_between': {
			const [low, high] = toList(expected) as number[];
			return value !== null && (value as number) >= low! && (value as number) <= high!;
		}
		case '_nbetween': {
			const [low, high] = toList(expected) as number[];
			return value === null || (value as number) < low! || (value as number) > high!;
		}
		case '_regex':
			try {
				return text !== null && new RegExp(needle).test(text);
			} catch {
				return undefined;
			}
		default:
			return undefined;
	}
}

function toList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') return value.split(',');
	return [value];
}

function isTrue(value: unknown) {
	return value === true || value === 'true';
}
