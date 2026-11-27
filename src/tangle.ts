// The core: source files and a config in; target files, a lock and problems out.
// Nothing here touches the disk.
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { type Line, render } from './expand.ts'
import { type Problem, parseSource, type Source } from './source.ts'

export const CONFIG_FILE = 'canon.yaml'
export const LOCK_FILE = 'canon.lock.json'

export interface Config {
	/** Folders whose `.md` files are sources. */
	sources: string[]
	/** Glob patterns that pick the sources to build into targets. */
	targets: string[]
	/** The output folder. */
	out: string
}

/** One source that went into a target, and the target lines its text fills (1-based, inclusive). */
export interface LockSource {
	id: string
	path: string
	hash: string
	lines: [number, number][]
}

export interface LockTarget {
	path: string
	hash: string
	sources: LockSource[]
}

export interface Result {
	/** Target text by path under the output folder. */
	targets: Map<string, string>
	lock: LockTarget[]
	problems: Problem[]
}

export type State = 'current' | 'stale' | 'edited' | 'missing'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')

export function readConfig(text: string, problems: Problem[]): Config | undefined {
	const fail = (message: string) => {
		problems.push({ file: CONFIG_FILE, line: 1, message })
		return undefined
	}
	let data: unknown
	try {
		data = parseYaml(text)
	} catch {
		return fail('this is not valid YAML')
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return fail('write the config as `key: value` lines')
	}
	const { canon, sources, targets, out, ...unknown } = data as Record<string, unknown>
	const isList = (value: unknown): value is string[] =>
		Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')

	if (Object.keys(unknown).length > 0) {
		return fail(`unknown key "${Object.keys(unknown)[0]}"; the keys are canon, sources, targets and out`)
	}
	if (canon !== 1) return fail('set `canon: 1`, the version of this format')
	if (!isList(sources)) return fail('set `sources` to a list of folders')
	if (!isList(targets)) return fail('set `targets` to a list of patterns, such as "agents/*.md"')
	if (typeof out !== 'string') return fail('set `out` to the output folder')

	const config = { sources: sources.map((s) => posix.normalize(s)), targets, out: posix.normalize(out) }
	const overlaps = (folder: string) =>
		folder === config.out || folder.startsWith(`${config.out}/`) || config.out.startsWith(`${folder}/`)
	const outside = (folder: string) =>
		folder.startsWith('..') || posix.isAbsolute(folder) || /[\\:]/.test(folder)
	if (config.sources.some(outside))
		return fail('write every `sources` folder as a path inside the project, with "/" between folders')
	if (config.out === '.' || outside(config.out) || config.sources.some(overlaps)) {
		return fail('`out` must be a folder of its own, outside every `sources` folder')
	}
	return config
}

/** Builds every target in memory. `files` maps a path from the project root to that file's text. */
export function tangle(config: Config, files: Map<string, string>): Result {
	const problems: Problem[] = []
	const sources = new Map<string, Source>()
	for (const path of [...files.keys()].sort()) {
		const source = parseSource(path, files.get(path)!, problems)
		const clash = sources.get(source.id)
		if (clash) {
			problems.push({
				file: path,
				line: 1,
				message: `${clash.path} already has the id "${source.id}"; change one`,
			})
		} else {
			sources.set(source.id, source)
		}
	}

	for (const pattern of config.targets) {
		if (![...files.keys()].some((path) => posix.matchesGlob(path, pattern))) {
			problems.push({
				file: CONFIG_FILE,
				line: 1,
				message: `the target pattern "${pattern}" matches no source file`,
			})
		}
	}

	const targets = new Map<string, string>()
	const lock: LockTarget[] = []
	for (const source of sources.values()) {
		// Every source is rendered, so a mistake in a file no target uses is still reported.
		const used = new Set<string>()
		const body = render(source, { sources, problems, used })
		if (!config.targets.some((pattern) => posix.matchesGlob(source.path, pattern))) continue

		const lines: Line[] = [...source.targetHeader.map((text) => ({ text, source: source.id })), ...body]
		const text = lines.map((line) => line.text).join('')
		targets.set(source.path, text)
		lock.push({
			path: source.path,
			hash: hash(text),
			sources: [...used].sort().map((id) => {
				const from = sources.get(id)!
				return { id, path: from.path, hash: hash(from.text), lines: ranges(lines, id) }
			}),
		})
	}
	return { targets, lock, problems: unique(problems) }
}

/** The runs of consecutive lines that came from one source. */
function ranges(lines: Line[], id: string): [number, number][] {
	const out: [number, number][] = []
	lines.forEach((line, i) => {
		if (line.source !== id) return
		const open = out[out.length - 1]
		if (open && open[1] === i) open[1] = i + 1
		else out.push([i + 1, i + 1])
	})
	return out
}

function unique(problems: Problem[]): Problem[] {
	const seen = new Map(problems.map((p) => [`${p.file}:${p.line}: ${p.message}`, p]))
	return [...seen.keys()].sort().map((key) => seen.get(key)!)
}

/** The lock's text. Its layout is fixed, so the same sources always give the same bytes. */
export function lockText(lock: LockTarget[]): string {
	const targets = lock.map((target) =>
		[
			'    {',
			`      "path": ${JSON.stringify(target.path)},`,
			`      "hash": ${JSON.stringify(target.hash)},`,
			'      "sources": [',
			target.sources.map((source) => `        ${JSON.stringify(source)}`).join(',\n'),
			'      ]',
			'    }',
		].join('\n'),
	)
	return [
		'{',
		'  "canon": 1,',
		'  "hash": "sha256",',
		'  "targets": [',
		targets.join(',\n'),
		'  ]',
		'}',
		'',
	].join('\n')
}

/**
 * Compares a fresh build with what is in the output folder.
 * `written` maps a target path to the file's text there, when the file exists.
 */
export function status(
	result: Result,
	written: Map<string, string>,
	oldLock: string | undefined,
): Map<string, State> {
	const old = new Map<string, LockTarget>()
	if (oldLock)
		for (const target of (JSON.parse(oldLock) as { targets: LockTarget[] }).targets)
			old.set(target.path, target)

	const states = new Map<string, State>()
	for (const target of result.lock) {
		const text = written.get(target.path)
		const before = old.get(target.path)
		if (text === undefined) states.set(target.path, 'missing')
		else if (before && hash(text) !== before.hash) states.set(target.path, 'edited')
		else if (JSON.stringify(before) !== JSON.stringify(target)) states.set(target.path, 'stale')
		else states.set(target.path, 'current')
	}
	return states
}
