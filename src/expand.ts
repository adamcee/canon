// Replaces include markers with the text they name. Text is copied line by
// line from the source files, and every line remembers which file it came from.
import type { Block, Problem, Source } from './source.ts'

export interface Line {
	text: string
	/** The id of the file this line's text came from. */
	source: string
}

export interface Context {
	sources: Map<string, Source>
	problems: Problem[]
	/** Ids of every file whose text was used. */
	used: Set<string>
}

const isBlank = (line: Line) => line.text.trim() === ''

/** Renders a file's body, or one block of it, with every include replaced. */
export function render(source: Source, ctx: Context, stack: string[] = [source.id], block?: Block): Line[] {
	ctx.used.add(source.id)
	const first = block?.first ?? 0
	const last = block?.last ?? source.lines.length - 1
	// A block that sits indented, as inside a list item, loses that indentation.
	const indent = (block?.column ?? 1) - 1
	const leading = new RegExp(`^[ \\t]{0,${indent}}`)

	const out: Line[] = []
	for (let i = first; i <= last; i++) {
		if (source.removed.has(i)) continue
		const raw = source.lines[i]
		const text = i === first ? raw.slice(indent) : raw.replace(leading, '')
		if (source.markers.has(i)) out.push(...include(source, i, text, ctx, stack))
		else out.push({ text, source: source.id })
	}
	return out
}

function include(source: Source, at: number, text: string, ctx: Context, stack: string[]): Line[] {
	const marker = source.markers.get(at)!
	const fail = (message: string): Line[] => {
		ctx.problems.push({ file: source.path, line: source.header.length + at + 1, message })
		return [{ text, source: source.id }]
	}

	const target = ctx.sources.get(marker.id)
	if (!target) return fail(`no file has the id "${marker.id}"${suggest(marker.id, ctx.sources.keys())}`)
	const block = marker.anchor ? target.anchors.get(marker.anchor) : undefined
	if (marker.anchor && !block) {
		return fail(
			`"${marker.id}" has no anchor ^${marker.anchor}${suggest(marker.anchor, target.anchors.keys())}`,
		)
	}
	const key = marker.anchor ? `${marker.id}#^${marker.anchor}` : marker.id
	if (stack.includes(key)) {
		return fail(
			`this include makes a cycle: ${[...stack.slice(stack.indexOf(key)), key].join(' → ')}; remove one of these includes`,
		)
	}

	let body = render(target, ctx, [...stack, key], block)
	while (body.length > 0 && isBlank(body[0])) body = body.slice(1)
	while (body.length > 0 && isBlank(body[body.length - 1])) body = body.slice(0, -1)

	// The first line takes the marker's place; later lines are indented to match it.
	const prefix = text.slice(0, text.indexOf('![['))
	const indent = prefix.replace(/\S/g, ' ')
	const ending = /\r?\n$/.exec(text)?.[0] ?? ''
	return body.map((line, i) => {
		const lead = i === 0 ? prefix : isBlank(line) ? '' : indent
		const rest = i === body.length - 1 ? line.text.replace(/\r?\n$/, '') + ending : line.text
		return { text: lead + rest, source: line.source }
	})
}

function suggest(name: string, known: Iterable<string>): string {
	let best: string | undefined
	let bestDistance = 3
	for (const candidate of known) {
		const d = distance(name, candidate)
		if (d < bestDistance) [best, bestDistance] = [candidate, d]
	}
	return best ? `; did you mean "${best}"?` : '; check the spelling'
}

/** Edit distance between two strings (Levenshtein). */
function distance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, j) => j)
	for (let i = 1; i <= a.length; i++) {
		const next = [i]
		for (let j = 1; j <= b.length; j++) {
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
		}
		row = next
	}
	return row[b.length]
}
