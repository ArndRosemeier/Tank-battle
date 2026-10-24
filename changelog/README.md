# Changelog entries

Every user-visible change adds ONE new file here; it appears in the game's
"What's new" screen. Never edit someone else's file to add your change, so
parallel PRs cannot conflict.

- Name: `YYYY-MM-DD-short-slug.md`
- Content: a `# Title` line, then `- item` lines in plain player language.

You never write a version number. The build gives an entry the version of the
main commit that first added its file (see `scripts/buildInfo.ts`): the game
starts at 0.100 and every merge to main adds 0.001.
