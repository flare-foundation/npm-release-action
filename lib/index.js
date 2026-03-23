"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const semver = __importStar(require("semver"));
async function checkVersion() {
    const MIN_NPM_VERSION = '11.5.1';
    const MIN_NODE_VERSION = '22.14.0';
    const nodeVersion = process.version;
    if (!semver.gte(nodeVersion, MIN_NODE_VERSION)) {
        core.setFailed(`Trusted publishing requires Node version ${MIN_NODE_VERSION} or higher. Current version is ${nodeVersion}.`);
        return false;
    }
    const { stdout: npmVersionOutput } = await exec.getExecOutput('npm', ['--version']);
    const npmVersion = npmVersionOutput.trim();
    if (!semver.gte(npmVersion, MIN_NPM_VERSION)) {
        core.setFailed(`Trusted publishing requires npm CLI version ${MIN_NPM_VERSION} or later. Current version is ${npmVersion}.`);
        return false;
    }
    core.info(`Node.js version: ${nodeVersion}`);
    core.info(`npm version: ${npmVersion}`);
    return true;
}
async function run() {
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
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const packageVersion = packageJson.version;
    if (strictVersion) {
        const normalizedTag = tagVersion.replace(/^v/, '');
        if (normalizedTag !== packageVersion) {
            core.setFailed(`Tag version (${tagVersion}) does not match package.json version (v${packageVersion}).`);
            return;
        }
        core.info(`Tag version matches package.json: ${packageVersion}`);
    }
    else {
        core.info('Skipping version check (strict_version=false)');
    }
    await exec.exec('pnpm', ['install', '--frozen-lockfile'], {
        cwd: absProjectDir,
    });
    if (buildScript) {
        await exec.exec('pnpm', ['run', buildScript], { cwd: absProjectDir });
    }
    else {
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
    }
    else if (unstableRegex.test(commitTag)) {
        core.info('Publishing BETA release (rc/alpha)...');
        await exec.exec('pnpm', [...publishArgs, '--tag', 'beta'], {
            cwd: absProjectDir,
        });
    }
    else {
        core.setFailed(`Tag '${commitTag}' does not match stable or unstable pattern.\n` +
            `Stable example: v1.0.0 or service/v1.0.0\n` +
            `Beta example: v1.0.0-rc.1 or v1.0.0-alpha.1`);
        return;
    }
    if (debugMode) {
        core.info('=== Debug Info ===');
        core.info(`path: ${projectDir}`);
        core.info(`commit_tag: ${commitTag}`);
    }
}
run().catch((err) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
//# sourceMappingURL=index.js.map