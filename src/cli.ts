#!/usr/bin/env node
// The command line: reads the project from disk, runs the core, writes the result.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Problem } from './source.ts'
import {
	CONFIG_FILE,
	type Config,
	LOCK_FILE,
	lockText,
	type Result,
	readConfig,
	status,
	tangle,
} from './tangle.ts'

const USAGE = `usage: canon <command> [project folder]

  check    report every mistake; write nothing
  tangle   check, then write the targets and the lock
  status   say whether each target is current, stale, edited or missing`

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)

/** Whether a path, with every symbolic link followed, is still inside a folder. */
const within = (folder: string, path: string) =>
	!relative(realpathSync(folder), realpathSync(path)).startsWith('..')

function load(root: string): { config?: Config; result?: Result; problems: Problem[] } {
	const problems: Problem[] = []
	const configText = read(join(root, CONFIG_FILE))
	if (configText === undefined) {
		problems.push({ file: CONFIG_FILE, line: 1, message: `no ${CONFIG_FILE} in ${root}; create one` })
		return { problems }
	}
	const config = readConfig(configText, problems)
	if (!config) return { problems }

	const files = new Map<string, string>()
	for (const folder of config.sources) {
		if (!existsSync(join(root, folder))) {
			problems.push({ file: CONFIG_FILE, line: 1, message: `the sources folder "${folder}" does not exist` })
			continue
		}
		for (const name of readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' })) {
			if (!name.endsWith('.md')) continue
			const path = join(folder, name).split(sep).join('/')
			if (within(root, join(root, path))) files.set(path, readFileSync(join(root, path), 'utf8'))
			else
				problems.push({
					file: path,
					line: 1,
					message: 'this links to a file outside the project; copy the file in',
				})
		}
	}
	const result = tangle(config, files)
	return { config, result, problems: [...problems, ...result.problems] }
}

function main(): number {
	const [command, root = '.'] = process.argv.slice(2)
	if (!['check', 'tangle', 'status'].includes(command)) {
		console.log(USAGE)
		return command === undefined || command === '--help' ? 0 : 1
	}

	const { config, result, problems } = load(root)
	for (const p of problems) console.error(`${p.file}:${p.line}: ${p.message}`)
	if (problems.length > 0 || !config || !result) {
		console.error(`canon: ${problems.length} problem(s); nothing written`)
		return 1
	}
	const out = join(root, config.out)
	const lockPath = join(out, LOCK_FILE)
	const oldLock = read(lockPath)

	if (command === 'check') {
		console.log(`canon: ${result.targets.size} target(s), no problems`)
		return 0
	}

	if (command === 'status') {
		const written = new Map<string, string>()
		for (const path of result.targets.keys()) {
			const text = read(join(out, path))
			if (text !== undefined) written.set(path, text)
		}
		const states = status(result, written, oldLock)
		for (const [path, state] of states) console.log(`${state.padEnd(8)} ${path}`)
		return [...states.values()].every((state) => state === 'current') ? 0 : 1
	}

	// tangle: drop targets the last run wrote and this one does not, then write.
	if (oldLock) {
		for (const { path } of (JSON.parse(oldLock) as { targets: { path: string }[] }).targets) {
			// The lock is a file on disk that anyone can edit, so never follow it out of the output folder.
			const inside = !relative(out, join(out, path)).startsWith('..')
			if (inside && path.endsWith('.md') && !result.targets.has(path))
				rmSync(join(out, path), { force: true })
		}
	}
	mkdirSync(out, { recursive: true })
	for (const [path, text] of result.targets) {
		const file = join(out, path)
		mkdirSync(dirname(file), { recursive: true })
		if (!within(out, existsSync(file) ? file : dirname(file))) {
			console.error(`${config.out}/${path}:1: this path links outside the output folder; remove the link`)
			return 1
		}
		writeFileSync(file, text)
	}
	writeFileSync(lockPath, lockText(result.lock))
	console.log(`canon: wrote ${result.targets.size} target(s) and ${LOCK_FILE} to ${config.out}/`)
	return 0
}

process.exitCode = main()
