# ADR: Caller-owned engine

## Status

Accepted

## Context and forces

`convert()` previously created an OCR engine and closed it in `finally`. Returning an unsettled strategy promise made `finally` run first, so recognition failed with `Engine is closed`. Auto-create/auto-close also hid startup cost and prevented reuse across files.

## Decision

The caller creates and closes the engine. `createEngine()` loads natives and starts OCR. `convert()` requires `options.engine` and never closes it. The CLI is a caller: it creates one engine for the process and closes it after the convert.

## Considered alternatives

- Keep auto-create/auto-close and only add `return await`. Rejected: still hides lifecycle and repeats engine startup on every call.
- Optional engine with an internal fallback. Rejected: two ownership models, same close-too-early risk.

## Trade-offs and consequences

- Missing engine is an illegal call and throws.
- Callers can reuse one engine for many files.
- Tests inject a fake engine the same way.
