// What Directus accepts for each field type, copied from @directus/utils 14.0.0 (MIT), the version Directus 12.5 uses:
// getFilterOperatorsForType, getFunctionsForType and getOutputTypeForFunction. Copied rather than imported, because the
// package would add some 250 kB to the extension.

const STRING_OPERATORS = [
	'contains',
	'ncontains',
	'icontains',
	'starts_with',
	'nstarts_with',
	'istarts_with',
	'nistarts_with',
	'ends_with',
	'nends_with',
	'iends_with',
	'niends_with',
	'eq',
	'neq',
	'empty',
	'nempty',
	'null',
	'nnull',
	'in',
	'nin',
];

const RANGE_OPERATORS = ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'between', 'nbetween', 'null', 'nnull', 'in', 'nin'];

/** The filter operators a field type allows, without their leading underscore. */
export function filterOperatorsForType(type: string): string[] {
	switch (type) {
		case 'binary':
		case 'string':
		case 'text':
		case 'csv':
			return STRING_OPERATORS;
		case 'hash':
			return ['empty', 'nempty', 'null', 'nnull'];
		case 'uuid':
			return ['eq', 'neq', 'null', 'nnull', 'in', 'nin'];
		case 'json':
			return ['null', 'nnull', 'json'];
		case 'boolean':
			return ['eq', 'neq', 'null', 'nnull'];
		case 'bigInteger':
		case 'integer':
		case 'decimal':
		case 'float':
		case 'dateTime':
		case 'date':
		case 'time':
			return RANGE_OPERATORS;
		case 'geometry':
		case 'geometry.Point':
		case 'geometry.LineString':
		case 'geometry.Polygon':
		case 'geometry.MultiPoint':
		case 'geometry.MultiLineString':
		case 'geometry.MultiPolygon':
			return ['eq', 'neq', 'null', 'nnull', 'intersects', 'nintersects', 'intersects_bbox', 'nintersects_bbox'];
		default:
			return ['contains', 'ncontains', ...RANGE_OPERATORS.slice(0, 8), 'empty', 'nempty', 'null', 'nnull', 'in', 'nin'];
	}
}

/** The functions, such as year(), a field type allows. */
export function functionsForType(type: string): string[] {
	switch (type) {
		case 'dateTime':
		case 'timestamp':
			return ['year', 'month', 'week', 'day', 'weekday', 'hour', 'minute', 'second'];
		case 'date':
			return ['year', 'month', 'week', 'day', 'weekday'];
		case 'time':
			return ['hour', 'minute', 'second'];
		case 'json':
			return ['count', 'json'];
		case 'alias':
			return ['count'];
		default:
			return [];
	}
}

/** The type a function returns, which decides the filter operators it allows. */
export function outputTypeForFunction(fn: string): string | undefined {
	return ['year', 'month', 'week', 'day', 'weekday', 'hour', 'minute', 'second', 'count'].includes(fn)
		? 'integer'
		: undefined;
}
