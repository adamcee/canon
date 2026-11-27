# Working in this repository

`canon` builds Markdown target files from source files that include each other. Read `README.md` first.

- **Run `npm run check` before you finish.** It runs Biome, `tsc` and the tests. `npm run format` applies fixes.
- **Never write Markdown back out from a parsed tree.** The parser only finds positions. Targets are made
  by copying source lines, so a file with no includes comes out byte for byte the same.
- **Only `src/cli.ts` touches the disk.** Everything else takes text in and gives text out.
- **Every problem message names the file, the line and the fix.**
- **Keep it small.** A new feature waits for a real file that needs it. Add a test only for behavior a user depends on.
- **After changing output, rebuild the example:** `npm run canon -- tangle examples/egm-reviewers`. A test checks that it is current.
