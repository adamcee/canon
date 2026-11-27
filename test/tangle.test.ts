import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { type Config, lockText, status, tangle } from '../src/tangle.ts'

const config: Config = { sources: ['src'], targets: ['src/entry*.md'], out: 'dist' }
const build = (files: Record<string, string>) => tangle(config, new Map(Object.entries(files)))

test('a file with no marker comes out byte for byte the same', () => {
	const text = '---\nname: a\n---\n# Title\r\n\n```\n![[not-a-marker]]\n```\n\nText with `![[code]]`.'
	const result = build({ 'src/entry.md': text })
	expect(result.problems).toEqual([])
	expect(result.targets.get('src/entry.md')).toBe(text)
})

test('a marker is replaced by the file it names, and the lock says which lines came from where', () => {
	const result = build({
		'src/entry.md': '---\nname: a\n---\n\n![[rules]]\n\n# Role\n',
		'src/shared.md': '---\nid: rules\n---\n\n# Rules\n\nBe kind.\n\n',
	})
	expect(result.problems).toEqual([])
	expect(result.targets.get('src/entry.md')).toBe('---\nname: a\n---\n\n# Rules\n\nBe kind.\n\n# Role\n')
	expect(result.lock[0].sources.map((s) => [s.id, s.lines])).toEqual([
		['rules', [[5, 7]]],
		[
			'src/entry',
			[
				[1, 4],
				[8, 9],
			],
		],
	])
	expect(lockText(result.lock)).toBe(
		lockText(
			build({
				'src/entry.md': '---\nname: a\n---\n\n![[rules]]\n\n# Role\n',
				'src/shared.md': '---\nid: rules\n---\n\n# Rules\n\nBe kind.\n\n',
			}).lock,
		),
	)
})

test('includes nest, follow the indentation of their marker, and can name one block', () => {
	const result = build({
		'src/entry.md': '---\nid: entry\n---\n- Step one\n\n  ![[outer]]\n',
		'src/outer.md': '---\nid: outer\n---\nOuter text.\n\n![[inner#^tone]]\n',
		'src/inner.md':
			'---\nid: inner\n---\nNot included.\n\n- Be brief.\n- Be plain.\n\n^tone\n\nAlso not included.\n',
	})
	expect(result.problems).toEqual([])
	expect(result.targets.get('src/entry.md')).toBe(
		'- Step one\n\n  Outer text.\n\n  - Be brief.\n  - Be plain.\n',
	)
})

test('anchor lines never reach a target', () => {
	const result = build({ 'src/entry.md': 'A paragraph.\n^para\n\n| a |\n|---|\n\n^table\n\nEnd.\n' })
	expect(result.targets.get('src/entry.md')).toBe('A paragraph.\n\n| a |\n|---|\n\nEnd.\n')
})

test('mistakes are reported with the file, the line and a fix', () => {
	const { problems } = build({
		'src/entry.md': '---\nname: a\n---\n![[rulez]]\n\n![[src/loop]]\n\n![[rules#^nope]]\n',
		'src/rules.md': '---\nid: rules\n---\nText.\n',
		'src/copy.md': '---\nid: rules\n---\nText.\n',
		'src/loop.md': '![[src/loop]]\n',
	})
	expect(problems.map((p) => `${p.file}:${p.line}: ${p.message}`)).toEqual([
		'src/entry.md:4: no file has the id "rulez"; did you mean "rules"?',
		'src/entry.md:8: "rules" has no anchor ^nope; check the spelling',
		'src/loop.md:1: this include makes a cycle: src/loop → src/loop; remove one of these includes',
		'src/rules.md:1: src/copy.md already has the id "rules"; change one',
	])
})

test('status tells current, stale, edited and missing apart', () => {
	const before = build({
		'src/entry.md': '![[src/rules]]\n',
		'src/entry2.md': 'Two.\n',
		'src/entry3.md': 'Three.\n',
		'src/rules.md': 'Old.\n',
	})
	const after = build({
		'src/entry.md': '![[src/rules]]\n',
		'src/entry2.md': 'Two.\n',
		'src/entry3.md': 'Three.\n',
		'src/entry4.md': 'Four.\n',
		'src/rules.md': 'New.\n',
	})
	const written = new Map([...before.targets, ['src/entry3.md', 'Edited by hand.\n']])
	expect(Object.fromEntries(status(after, written, lockText(before.lock)))).toEqual({
		'src/entry.md': 'stale',
		'src/entry2.md': 'current',
		'src/entry3.md': 'edited',
		'src/entry4.md': 'missing',
	})
})

test('the example builds files identical to the originals, and its committed output is current', () => {
	const example = join(import.meta.dirname, '../examples/egm-reviewers')
	execFileSync('node', [join(import.meta.dirname, '../src/cli.ts'), 'status', example])
	for (const name of readdirSync(join(example, 'original'))) {
		expect(readFileSync(join(example, 'dist/agents', name), 'utf8')).toBe(
			readFileSync(join(example, 'original', name), 'utf8'),
		)
	}
})
