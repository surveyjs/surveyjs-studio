# 1. Record architecture decisions

Date: 2026-10-14

## Status

Accepted

## Context

This project will be forked, ported to other back-end languages and maintained by people who did
not take part in the early decisions. `idea.md` and `spec.md` hold the overall design, but smaller
choices (a library, a limit, a version policy) are made while building. Without a record, the
reason is lost and the choice gets reopened or reversed by accident.

## Decision

We keep short architecture decision records in `docs/adr/`, in the format of Michael Nygard:
title, date, status, context, decision, consequences. One file per decision, numbered
`NNNN-short-title.md`, listed in `docs/adr/README.md`.

We write an ADR when a decision is not already in `idea.md` or `spec.md` and someone could
reasonably ask "why?". Every major upgrade of a core dependency or of Node.js gets one.

An accepted ADR is not rewritten. A later ADR supersedes it and the old one's status changes to
"Superseded by NNNN".

## Consequences

- The reason for a choice can be found in the repository.
- Writing an ADR is a small cost on pull requests that change a core choice.
