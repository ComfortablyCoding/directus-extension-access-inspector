import { expect, test } from 'vitest';
import {
	type PermissionRow,
	adminCollectionAccess,
	analyzeAction,
	analyzeCollection,
	diffAccess,
	fieldCoverage,
} from './access.js';

const fields = ['id', 'title', 'status', 'author', 'notes'];

const permission = (overrides: Partial<PermissionRow>): PermissionRow => ({
	policy: 'p1',
	collection: 'articles',
	action: 'read',
	permissions: null,
	validation: null,
	presets: null,
	fields: ['*'],
	...overrides,
});

test('no permissions means no access', () => {
	const read = analyzeAction('read', fields, []);

	expect(read.level).toBe('none');
	expect(read.items).toEqual([]);
	expect(read.fields['title']).toEqual({ permissions: [], items: 'none' });
});

test('an unrestricted permission on every field is full access', () => {
	expect(analyzeAction('read', fields, [permission({})]).level).toBe('full');
	expect(analyzeAction('read', fields, [permission({ permissions: {} })]).level).toBe('full');
});

test('item rules are combined, and fields depend on the permissions that grant them', () => {
	const published = permission({
		policy: 'public',
		permissions: { status: { _eq: 'published' } },
		fields: ['id', 'title'],
	});
	const own = permission({ policy: 'author', permissions: { author: { _eq: '$CURRENT_USER' } }, fields: ['*'] });
	const read = analyzeAction('read', fields, [published, own]);

	expect(read.level).toBe('partial');
	expect(read.items).toEqual([{ status: { _eq: 'published' } }, { author: { _eq: '$CURRENT_USER' } }]);
	expect(read.fields['title']).toEqual({ permissions: [published, own], items: 'some' });
	expect(read.fields['notes']).toEqual({ permissions: [own], items: 'some' });
});

test('an unrestricted permission makes its fields available on every item', () => {
	const all = permission({ fields: ['id', 'title'] });
	const own = permission({ policy: 'p2', permissions: { author: { _eq: '$CURRENT_USER' } } });
	const read = analyzeAction('read', fields, [all, own]);

	expect(read.items).toBe('all');
	expect(read.fields['title']!.items).toBe('all');
	expect(read.fields['notes']!.items).toBe('some');
	expect(read.level).toBe('partial');
});

test('limited fields are partial access', () => {
	expect(analyzeAction('read', fields, [permission({ fields: ['id'] })]).level).toBe('partial');
	expect(analyzeAction('read', fields, [permission({ fields: null })]).fields['id']!.items).toBe('none');
});

test('create ignores item rules', () => {
	const create = analyzeAction('create', fields, [
		permission({ action: 'create', permissions: { status: { _eq: 'x' } } }),
	]);

	expect(create.items).toBe('all');
	expect(create.level).toBe('full');
});

test('delete and share have no fields', () => {
	const remove = analyzeAction('delete', fields, [
		permission({ action: 'delete', permissions: { status: { _eq: 'draft' } } }),
	]);

	expect(remove.fields).toEqual({});
	expect(remove.level).toBe('partial');
	expect(analyzeAction('share', fields, [permission({ action: 'share' })]).level).toBe('full');
});

test('validation from every permission applies, and later presets override earlier ones', () => {
	const first = permission({
		policy: 'p1',
		action: 'update',
		validation: { title: { _nnull: true } },
		presets: { status: 'draft', author: '$CURRENT_USER' },
	});
	const second = permission({ policy: 'p2', action: 'update', validation: {}, presets: { status: 'review' } });
	const third = permission({
		policy: 'p3',
		action: 'update',
		validation: { status: { _neq: 'published' } },
		presets: { status: 'final' },
	});
	const update = analyzeAction('update', fields, [first, second, third]);

	expect(update.validation).toEqual([
		{ rule: { title: { _nnull: true } }, permission: first },
		{ rule: { status: { _neq: 'published' } }, permission: third },
	]);
	expect(update.presets).toEqual([
		{ field: 'author', value: '$CURRENT_USER', permission: first, overrides: [] },
		{ field: 'status', value: 'final', permission: third, overrides: [first, second] },
	]);
});

test('only permissions for the action count', () => {
	const access = analyzeCollection(fields, [permission({ action: 'read' }), permission({ action: 'delete' })]);

	expect(access.read.level).toBe('full');
	expect(access.delete.level).toBe('full');
	expect(access.create.level).toBe('none');
	expect(access.update.level).toBe('none');
});

test('admins get everything', () => {
	const access = adminCollectionAccess(fields);

	expect(Object.values(access).map(({ level }) => level)).toEqual(['full', 'full', 'full', 'full', 'full']);
	expect(access.update.fields['notes']!.items).toBe('all');
});

test('a read without any fields returns only primary keys', () => {
	const keys = permission({ fields: [], permissions: { status: { _eq: 'published' } } });
	const read = analyzeAction('read', fields, [keys], 'id');

	expect(read.keysOnly).toBe(true);
	expect(read.fields['id']).toEqual({ permissions: [keys], items: 'some' });
	expect(read.fields['title']!.items).toBe('none');
	expect(analyzeAction('read', fields, [permission({ fields: ['title'] })], 'id').fields['id']!.items).toBe('none');
	expect(analyzeAction('read', fields, [permission({ fields: ['title'] })], 'id').keysOnly).toBe(false);
});

test('a field granted by only some of the permissions is null on items only the others allow', () => {
	const published = permission({
		policy: 'basics',
		permissions: { status: { _eq: 'published' } },
		fields: ['id', 'title'],
	});
	const own = permission({ policy: 'own', permissions: { author: { _eq: '$CURRENT_USER' } }, fields: ['*'] });
	const read = analyzeAction('read', fields, [published, own]);

	// Both grant the title, so every readable item has it; only one grants notes.
	expect(fieldCoverage(read, 'title')).toBe('full');
	expect(fieldCoverage(read, 'notes')).toBe('partial');
	expect(fieldCoverage(analyzeAction('read', fields, [published]), 'notes')).toBe('none');
	// A permission without an item rule covers every item.
	expect(fieldCoverage(analyzeAction('read', fields, [published, permission({ fields: ['notes'] })]), 'notes')).toBe(
		'full',
	);
});

test('diffs report the other level of every action that differs', () => {
	const full = analyzeCollection(fields, [permission({}), permission({ action: 'update' })]);
	const readOnly = analyzeCollection(fields, [permission({})]);

	expect(diffAccess({ articles: full }, { articles: readOnly })).toEqual({ articles: { update: 'none' } });
	expect(diffAccess({ articles: full }, { articles: full })).toEqual({});
	expect(diffAccess({ articles: readOnly }, {})).toEqual({ articles: { read: 'none' } });
});
