# ADR: npm trusted publishing

## Status

Accepted

## Context and forces

here-docs was only installable from GitHub (`github:AkaraChen/here-docs`). Consumers that are themselves published
packages (the `@searxng-js/sex-docs` package of AkaraChen/sex) cannot depend on a Git URL cleanly: every install clones
the repository, runs `prepare` (`tsc`) on the consumer's machine, and package managers warn about install scripts they
do not cover. A registry release removes that, but a long-lived npm token in CI is a credential that can leak and
publish anything.

## Decision

1. Publish `here-docs` to the npm registry, MIT licensed.
2. Publish only from `.github/workflows/release.yml`, through npm trusted publishing: npm trusts GitHub's OIDC token
   for this repository and workflow file, so there is no npm token anywhere, and every version carries a provenance
   statement (source commit, workflow run) in the public transparency log.
3. The workflow runs on every push to `main` and publishes `package.json`'s version only when the registry does not
   have it yet, after `npm ci`, `npm test` and `npm run smoke`. A prerelease (`x.y.z-rc.N`) goes to the `next`
   dist-tag, a release to `latest`; each published version gets a `v<version>` Git tag.
4. A trusted publisher can only be configured for a package that exists, so the first version (`0.1.0-rc.0`) was
   published by hand, then `npm trust github here-docs --file release.yml --repo AkaraChen/here-docs --allow-publish`.

## Considered alternatives

- Keep Git installs only. Rejected for the reasons above; Git installs keep working for unreleased commits.
- An `NPM_TOKEN` secret. Rejected: a long-lived credential, and no provenance.
- Publish on Git tags instead of version bumps on `main`. Rejected: the version in `package.json` on `main` is then the
  single source of truth, and a release is one reviewed change.

## Consequences

- Releasing is: bump `version` in `package.json`, merge to `main`.
- Changing the workflow file name or moving the repository breaks publishing until the trusted publisher on npm is
  updated (`npm trust list here-docs`, `npm trust revoke`, `npm trust github`).
- After the first CI release, the npm package setting "Require two-factor authentication and disallow tokens" can be
  turned on, so that only this workflow can publish.
