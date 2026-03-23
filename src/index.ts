import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as semver from 'semver';

async function checkVersion(): Promise<boolean> {
  const MIN_NPM_VERSION = '11.5.1';
  const MIN_NODE_VERSION = '22.14.0';

  const nodeVersion = process.version;
  if (!semver.gte(nodeVersion, MIN_NODE_VERSION)) {
    core.setFailed(
      `Trusted publishing requires Node version ${MIN_NODE_VERSION} or higher. Current version is ${nodeVersion}.`,
    );
    return false;
  }

  const { stdout: npmVersionOutput } = await exec.getExecOutput('npm', ['--version']);
  const npmVersion = npmVersionOutput.trim();
  if (!semver.gte(npmVersion, MIN_NPM_VERSION)) {
    core.setFailed(
      `Trusted publishing requires npm CLI version ${MIN_NPM_VERSION} or later. Current version is ${npmVersion}.`,
    );
    return false;
  }

  core.info(`Node.js version: ${nodeVersion}`);
  core.info(`npm version: ${npmVersion}`);
  return true;
}

export async function run(): Promise<void> {
  if (!(await checkVersion())) {
    return;
  }

  const projectDir = core.getInput('path') || '.';
  const buildScript = core.getInput('build_script') || '';
  const strictVersion = core.getInput('strict_version') === 'true';
  const debugMode = core.getInput('debug_mode') === 'true';
  const dryRun = core.getInput('dry_run') === 'true';
  const regexStable = core.getInput('regex_stable_tag');
  const regexUnstable = core.getInput('regex_unstable_tag');

  const commitTag = process.env['GITHUB_REF_NAME'] ?? '';
  if (!commitTag) {
    core.setFailed('No tag found. This action must run on a tag push event.');
    return;
  }
  const tagVersion = commitTag.replace(/^[a-zA-Z0-9_-]+\//, '');

  const absProjectDir = path.resolve(projectDir);
  const packageJsonPath = path.join(absProjectDir, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version: string;
  };
  const packageVersion = packageJson.version;

  if (strictVersion) {
    const normalizedTag = tagVersion.replace(/^v/, '');
    if (normalizedTag !== packageVersion) {
      core.setFailed(
        `Tag version (${tagVersion}) does not match package.json version (v${packageVersion}).`,
      );
      return;
    }
    core.info(`Tag version matches package.json: ${packageVersion}`);
  } else {
    core.info('Skipping version check (strict_version=false)');
  }

  await exec.exec('pnpm', ['install', '--frozen-lockfile'], {
    cwd: absProjectDir,
  });

  if (buildScript) {
    await exec.exec('pnpm', ['run', buildScript], { cwd: absProjectDir });
  } else {
    core.info('No build script provided, skipping build.');
  }

  const publishArgs = ['publish', '--access', 'public', '--provenance', '--no-git-checks'];

  if (dryRun) {
    publishArgs.push('--dry-run');
  }

  const stableRegex = new RegExp(regexStable);
  const unstableRegex = new RegExp(regexUnstable);

  core.exportVariable('NODE_AUTH_TOKEN', '');

  if (stableRegex.test(commitTag)) {
    core.info('Publishing STABLE release...');
    await exec.exec('pnpm', publishArgs, {
      cwd: absProjectDir,
    });
  } else if (unstableRegex.test(commitTag)) {
    core.info('Publishing BETA release (rc/alpha)...');
    await exec.exec('pnpm', [...publishArgs, '--tag', 'beta'], {
      cwd: absProjectDir,
    });
  } else {
    core.setFailed(
      `Tag '${commitTag}' does not match stable or unstable pattern.\n` +
        `Stable example: v1.0.0 or service/v1.0.0\n` +
        `Beta example: v1.0.0-rc.1 or v1.0.0-alpha.1`,
    );
    return;
  }

  if (debugMode) {
    core.info('=== Debug Info ===');
    core.info(`path: ${projectDir}`);
    core.info(`commit_tag: ${commitTag}`);
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
