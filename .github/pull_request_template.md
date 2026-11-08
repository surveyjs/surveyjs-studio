## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass
- [ ] Tests added or updated: `pnpm test:unit`, `pnpm test:conformance` and the e2e suite this change touches
- [ ] `contract/openapi.yaml` changed first, and `pnpm lint:contract` passes (if the API changed)
- [ ] Docs updated, and `pnpm check:docs-links` passes
- [ ] An ADR in `docs/adr/` (if this is a decision)
- [ ] No secrets, real hosts or personal data in the change
