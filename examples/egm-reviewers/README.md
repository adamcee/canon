# Example: three reviewer agents that share one section

Three agent files from the [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
open with the same "Core Mandates" section. Here that section is written once, in
`shared/core-mandates.md`, and each file in `agents/` includes it with `![[core-mandates]]`.

- `agents/` and `shared/` are the sources.
- `dist/` is what `canon tangle` writes.
- `original/` holds the three files as the project ships them. Each built file is identical to its original.

The agent files are copyright the Elephant-Goldfish Model authors and are used under the Apache License 2.0.
