# Hosted migration mapping

Status: final with hosted Step 9 (2026-11-25). The tool is built; its decisions are in
[ADR 0044](../adr/0044-the-hosted-migration-tool.md) and its use in
[Operations › Hosted migration](../operations/hosted-migration.md).

The hosted migration copies the data of `studio.surveyjs.io` from the legacy stores into Studio's SQL schema
([plan-hosted.md](../../plan-hosted.md) Steps 1 and 9, [spec-hosted.md](../../spec-hosted.md) › Data model and
mapping, › Migration tool).

**The entity-by-entity mapping is in the legacy documentation,** kept with the other legacy material in the private
location (plan-hosted.md, rule 6): every legacy entity and property, its target column, the normalisation rules, the
high-water marks of the delta copy, and what is not migrated and why.

What holds on Studio's side, and is public:

- **Every survey, response, theme, history entry, file, saved layout, project and member moves,** with the same ids:
  survey, post, result and response ids, and user ids as references (spec-hosted, H1).
- **Timestamps are kept exactly:** created, updated, submitted and history times.
- **Users are not copied as accounts.** The migration seeds a profile for every user the copied data names; after the
  cutover users come from sign-in ([ADR 0022](../adr/0022-users-from-sign-in.md), [ADR 0043](../adr/0043-hosted-users-on-the-local-directory.md)).
- **Only linked files move,** with the old file names kept in `legacy_files`; files nobody links stay behind.
- **Saved layouts** (including the column layout) go to `survey_layouts` and users' own views to `saved_views`;
  hidden public-results questions follow the old public results' rule on both old settings ([ADR 0044](../adr/0044-the-hosted-migration-tool.md) point 4).
- **History** is the 20 newest entries of each survey; a survey's publish id goes to `surveys.legacy_publish_id`.
- **Not copied:** Studio's own key revocations, API tokens and uploads of no survey (production has none).
- **The target is Studio's schema** ([data-model.md](data-model.md) and the migrations in `server/sql/postgres/`),
  plus the hosted-only tables of hosted Step 8. History snapshots follow
  [ADR 0036](../adr/0036-history-snapshots-above-a-size-limit.md).
- **The rules the app already uses** to read the legacy stores (the Azure legacy provider,
  `server/src/providers/azure-legacy/`) are the rules the migration reuses, so `verify` can compare reads through both
  providers.
