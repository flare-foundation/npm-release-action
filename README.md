<p align="left">
  <a href="https://flare.network/" target="blank"><img src="https://content.flare.network/Flare-2.svg" width="410" height="106" alt="Flare Logo" /></a>
</p>

# NPM Release Action

GitHub Action for publishing public packages to the NPM registry using OIDC trusted publishing with provenance support.

## Usage

This action uses [trusted publishing](https://docs.npmjs.com/trusted-publishers) via OIDC. Before using this
action, [set up a trusted publisher](https://docs.npmjs.com/trusted-publishers#configuring-trusted-publishing) for your
package on npmjs.com.

Then, add the following to your workflow file:

```yaml
on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for trusted publishing
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - uses: pnpm/action-setup@v5
        with:
          version: 10
          cache: 'true'
      - uses: flare-foundation/npm-release-action@v1
        with:
          build_script: 'build'
```

## Provenance Generation

NPM provenance lets you verifiably link a published package back to its source repository and the exact build
instructions used to create it. When publishing from GitHub Actions, a signed attestation is generated and uploaded to
the NPM registry, so consumers can confirm the package wasn't tampered with between source and publish.

See the [official npm provenance docs](https://docs.npmjs.com/generating-provenance-statements) for setup instructions.

### Verifying signature

Run this in any project that has your package as a dependency:

```bash
npm audit signatures
```

Or, to verify a specific package:

```bash
mkdir /tmp/verify-test && cd /tmp/verify-test
npm init -y
npm install <your-package>
npm audit signatures
```

Or, advanced verification using [Cosign](https://blog.sigstore.dev/cosign-verify-bundles/#npm-provenance).

## Tag format

Action should run only on tags:

| Tag example      | Publishes as                       |
|------------------|------------------------------------|
| `v1.0.0`         | `latest` (stable)                  |
| `service/v1.0.0` | `latest` (stable, monorepo prefix) |
| `v1.0.0-rc.1`    | `beta`                             |
| `v1.0.0-alpha.1` | `beta`                             |

## Inputs

| Input                | Type    | Default               | Description                                                     |
|----------------------|---------|-----------------------|-----------------------------------------------------------------|
| `path`               | string  | `.`                   | Path to the package root directory containing `package.json`    |
| `strict_version`     | boolean | `true`                | Enforce that the git tag version matches `package.json` version |
| `debug_mode`         | boolean | `false`               | Print debug information on failure                              |
| `dry_run`            | boolean | `false`               | Perform all steps except making any changes in the NPM registry |
| `regex_stable_tag`   | string  | `v1.0.0` pattern      | Regex to match stable release tags                              |
| `regex_unstable_tag` | string  | `v1.0.0-rc.1` pattern | Regex to match beta release tags (rc/alpha)                     |
