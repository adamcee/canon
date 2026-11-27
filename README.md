# canon

**Manage your markdown rules for your agents.**

Coding agents run on Markdown: skills, agent definitions, rules, prompts. As those files grow, the same
paragraphs get pasted into many of them, and the copies drift apart. `canon` lets you write each piece
once and build the files your agents load.

It is an early prototype. The formats may change.

## What it does

You keep **source** files. A source can include another file, or one named block of another file:

```markdown
---
name: reviewer
---

![[ground-rules]]

# Role

You review pull requests.
```

`canon tangle` writes **target** files into an output folder. To tangle is to replace every include with
the text it names. A target is plain Markdown that needs no other file, so an agent can load it as it is.

Beside the targets, `canon` writes a **lock**. The lock lists the sources each target was built from,
a content hash of each, and which lines of the target came from which source. It answers two questions:

- **Is this file current?** `canon status` reports a target that is out of date or was edited by hand.
- **Where did this text come from?** Find the line in the lock and read the source's id.

A file with no includes comes out byte for byte the same, so you can point `canon` at a folder you
already have. `canon` copies text; it never reformats your Markdown.

## Try it

`canon` needs Node 24 or later. It runs from a clone:

```sh
git clone https://github.com/adamcee/canon.git
cd canon
npm install
npm run canon -- tangle examples/egm-reviewers
npm run canon -- status examples/egm-reviewers
```

[`examples/egm-reviewers`](examples/egm-reviewers) holds three agent files that share one section.
To use the `canon` command anywhere, run `npm link` in the clone.

## A project

A project is a folder with a `canon.yaml`:

```yaml
canon: 1
sources: [agents, shared]
targets: ["agents/*.md"]
out: dist
```

| Key | Meaning |
|---|---|
| `canon` | The version of this format. |
| `sources` | Folders whose `.md` files can be included. |
| `targets` | Patterns that pick the sources to build. A target keeps its path under `out`. |
| `out` | The output folder. `canon` writes nowhere else. |

## Includes

| You write | The target gets |
|---|---|
| `![[id]]` | The body of the file with that id |
| `![[id#^name]]` | The block called `name` in that file |

- **A marker stands alone** on its line, with a blank line on each side. A marker inside a sentence or a
  code block is ordinary text.
- **A file's id** is its `id:` header key, or else its path without `.md`. An id survives a rename; a path
  does not.
- **Includes nest,** and an indented marker indents the text it brings in, so an include works inside a
  list item.
- **The form is Obsidian's embed,** so sources preview with their includes shown in Obsidian.

To name a block, put an anchor on the line after it:

```markdown
- Be brief.
- Be plain.

^tone
```

The `id` header line and anchor lines never reach a target.

## Commands

| Command | Does |
|---|---|
| `canon check [folder]` | Reports every mistake with its file, line and fix. Writes nothing. |
| `canon tangle [folder]` | Checks, then writes the targets and the lock. |
| `canon status [folder]` | Reports each target as `current`, `stale`, `edited` or `missing`. |

Each exits with 1 when something is wrong, so `canon status` works as a CI check. Mistakes read like this:

```
agents/reviewer.md:5: no file has the id "ground-rule"; did you mean "ground-rules"?
```

## The lock

`canon.lock.json` sits in the output folder. For each target it lists every source and the target lines
that source filled:

```json
{"id":"ground-rules","path":"shared/ground-rules.md","hash":"…","lines":[[5,11]]}
```

The same sources always give the same lock, byte for byte.

## Where it is going

Each of these waits for a real file that needs it:

- **Checked headers:** a schema per kind of file, so a misspelled key fails.
- **Named values:** define a fact once and use its name in prose everywhere.
- **Variants:** text kept or dropped per tool, from one source.
- **Pinned includes:** include a file as it was at one hash.
- **Source ids inside targets,** so an agent can cite where its instructions came from.

## Development

```sh
npm run check    # lint, types and tests
npm run format   # apply lint and format fixes
```

The code is four files in [`src`](src): `source.ts` reads one file, `expand.ts` replaces includes,
`tangle.ts` builds targets and the lock, and `cli.ts` is the only part that touches the disk.
