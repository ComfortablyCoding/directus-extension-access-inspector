import { expect, test } from 'vitest';
import { checkRule } from './validate.js';

test.each([
	[{ status: { _in: ['draft', 'review'] } }, { status: 'draft' }, true],
	[{ status: { _in: ['draft', 'review'] } }, { status: 'published' }, false],
	[{ status: { _in: ['draft', 'review'] } }, { title: 'x' }, true],
	[{ title: { _nempty: true } }, { title: '' }, false],
	[{ title: { _submitted: true } }, {}, false],
	[{ review_score: { _between: [1, 10] } }, { review_score: 50 }, false],
	[{ review_score: { _between: [1, 10] } }, { review_score: 5 }, true],
	[{ email: { _regex: '^[^@\\s]+@[^@\\s]+$' } }, { email: 'not-an-email' }, false],
	[{ _or: [{ status: { _neq: 'published' } }, { published_at: { _nnull: true } }] }, { status: 'published' }, true],
	[
		{ _or: [{ status: { _neq: 'published' } }, { published_at: { _nnull: true } }] },
		{ status: 'published', published_at: null },
		false,
	],
	[{ _and: [{ a: { _gt: 1 } }, { b: { _lt: 5 } }] }, { a: 2, b: 9 }, false],
	[{ name: { _icontains: 'ADA' } }, { name: 'ada lovelace' }, true],
])('%j with %j passes: %s', (rule, payload, passes) => {
	expect(checkRule(rule, payload)).toEqual({ passes, unknown: [] });
});

test('dynamic values and unknown operators are uncertain, not failures', () => {
	expect(checkRule({ date: { _lte: '$NOW' } }, { date: '2020-01-01' })).toEqual({
		passes: true,
		unknown: ['date _lte $NOW'],
	});
	expect(checkRule({ area: { _intersects: 'x' } }, { area: {} }).unknown).toEqual(['area _intersects']);
});
