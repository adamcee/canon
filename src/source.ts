// Reads one Markdown file: its header, its id, and where its include
// markers and anchors sit. It only finds positions; it never rewrites text.
import type { Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parse as parseYaml } from 'yaml'

export interface Problem {
	file: string
	line: number
	message: string
}

/** A stretch of body lines (0-based, inclusive) and the column its text starts at. */
export interface Block {
	first: number
	last: number
	column: number
}

export interface Marker {
	id: string
	anchor?: string
}

export interface Source {
	path: string
	id: string
	text: string
	/** Header lines as written, `---` lines included. Empty when the file has no header. */
	header: string[]
	/** Header lines a target gets: the header without its `id` line. */
	targetHeader: string[]
	/** Body lines, each with its line ending. */
	lines: string[]
	/** Include markers, by body line. */
	markers: Map<number, Marker>
	/** Named blocks, by anchor name. */
	anchors: Map<string, Block>
	/** Body lines left out of every target: the anchor lines. */
	removed: Set<number>
}

const ID = /^[\w./-]+$/
const MARKER = /^!\[\[([\w./-]+)(?:#\^([A-Za-z0-9-]+))?\]\]$/
const ANCHOR = /^\^([A-Za-z0-9-]+)$/

/** Splits text into lines and keeps each line's ending, so joining them gives the text back. */
export const splitLines = (text: string): string[] => (text === '' ? [] : text.split(/(?<=\n)/))

export function parseSource(path: string, text: string, problems: Problem[]): Source {
	const all = splitLines(text)
	const header = splitHeader(all)
	const source: Source = {
		path,
		id: path.replace(/\.md$/, ''),
		text,
		header,
		targetHeader: header,
		lines: all.slice(header.length),
		markers: new Map(),
		anchors: new Map(),
		removed: new Set(),
	}
	readId(source, problems)
	readBody(source, problems)
	return source
}

function splitHeader(lines: string[]): string[] {
	if (lines[0]?.trimEnd() !== '---') return []
	const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
	return close > 0 ? lines.slice(0, close + 1) : []
}

const tryYaml = (text: string): unknown => {
	try {
		return parseYaml(text)
	} catch {
		return undefined
	}
}

function readId(source: Source, problems: Problem[]): void {
	const { header, path } = source
	if (header.length === 0) return
	const data = tryYaml(header.slice(1, -1).join('')) ?? {}
	if (typeof data !== 'object' || Array.isArray(data)) {
		problems.push({
			file: path,
			line: 1,
			message: 'the header is not a list of `key: value` lines; fix its YAML',
		})
		return
	}
	if (!('id' in data)) return

	// The id must sit on one line of its own, so that line can be cut by text.
	const at = header.findIndex((line) => line.startsWith('id:'))
	const onOneLine = at > 0 && (tryYaml(header[at]) as { id?: unknown } | undefined)?.id === data.id
	if (typeof data.id !== 'string' || !ID.test(data.id) || !onOneLine) {
		problems.push({
			file: path,
			line: Math.max(at, 0) + 1,
			message: 'write the id on one line as `id: name`, using letters, digits, ".", "-", "_" and "/"',
		})
		return
	}
	source.id = data.id
	const rest = header.filter((_, i) => i !== at)
	source.targetHeader = rest.slice(1, -1).some((line) => line.trim() !== '') ? rest : []
}

function readBody(source: Source, problems: Problem[]): void {
	const { lines, markers, anchors, removed } = source
	const problem = (bodyLine: number, message: string) =>
		problems.push({ file: source.path, line: source.header.length + bodyLine + 1, message })

	const visit = (node: Nodes, siblings: Nodes[], index: number, inQuote: boolean): void => {
		if (node.type === 'paragraph' && node.position) {
			const first = node.position.start.line - 1
			const last = node.position.end.line - 1
			const oneLine = first === last
			const lastText = lines[last].slice(oneLine ? node.position.start.column - 1 : 0).trim()
			const anchor = ANCHOR.exec(lastText)
			const marker = oneLine ? MARKER.exec(lastText) : null

			if (anchor) {
				// As a paragraph's last line it names that paragraph; alone, it names the block before it.
				const before = siblings[index - 1]?.position
				const block: Block | undefined = !oneLine
					? { first, last: last - 1, column: node.position.start.column }
					: before && { first: before.start.line - 1, last: before.end.line - 1, column: before.start.column }
				if (!block)
					problem(last, `the anchor ^${anchor[1]} names nothing; put it on the line after the block it names`)
				else if (anchors.has(anchor[1]))
					problem(last, `the anchor ^${anchor[1]} is used twice in this file; rename one`)
				else anchors.set(anchor[1], block)
				removed.add(last)
				if (oneLine && last > 0 && lines[last - 1].trim() === '') removed.add(last - 1)
			} else if (marker && inQuote) {
				problem(first, 'an include marker cannot sit inside a block quote; move it out of the quote')
			} else if (marker) {
				markers.set(first, { id: marker[1], anchor: marker[2] })
			}
		}
		if ('children' in node) {
			const quoted = inQuote || node.type === 'blockquote'
			for (const [i, child] of node.children.entries()) visit(child, node.children, i, quoted)
		}
	}
	visit(fromMarkdown(lines.join('')), [], 0, false)
}
