import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import { run } from '../index';

jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('fs', () => ({
  ...jest.requireActual<typeof fs>('fs'),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockGetExecOutput = exec.getExecOutput as jest.MockedFunction<typeof exec.getExecOutput>;
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

function setupInputs(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    path: 'test-npm',
    strict_version: 'true',
    npm_access: 'public',
    debug_mode: 'false',
    regex_stable_tag: '^([a-zA-Z0-9_-]+/)?v?(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$',
    regex_unstable_tag:
      '^([a-zA-Z0-9_-]+/)?v?(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)-(rc|alpha)\\.(0|[1-9][0-9]*)$',
    ...overrides,
  };
  mockGetInput.mockImplementation((name) => defaults[name] ?? '');
}

function setupPackageJson(version: string, hasBuild = false) {
  const pkg = {
    version,
    ...(hasBuild ? { scripts: { build: 'tsc' } } : {}),
  };
  mockReadFileSync.mockReturnValue(JSON.stringify(pkg));
}

const originalProcessVersion = process.version;

beforeEach(() => {
  jest.clearAllMocks();
  mockExec.mockResolvedValue(0);
  Object.defineProperty(process, 'version', { value: 'v22.14.0', writable: true });
  mockGetExecOutput.mockResolvedValue({ stdout: '11.5.1', stderr: '' });
  process.env['GITHUB_REF_NAME'] = 'v1.0.0';
});

afterEach(() => {
  delete process.env['GITHUB_REF_NAME'];
  Object.defineProperty(process, 'version', { value: originalProcessVersion });
});

describe('tag validation', () => {
  it('fails when no tag is set', async () => {
    setupInputs();
    setupPackageJson('1.0.0');
    delete process.env['GITHUB_REF_NAME'];
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('No tag found'));
  });

  it('fails when tag does not match stable or unstable regex', async () => {
    setupInputs();
    setupPackageJson('1.0.0-beta');
    process.env['GITHUB_REF_NAME'] = 'v1.0.0-beta';
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('does not match'));
  });
});

describe('version check', () => {
  it('fails when tag version does not match package.json with strict_version=true', async () => {
    setupInputs({ strict_version: 'true' });
    setupPackageJson('1.0.1');
    process.env['GITHUB_REF_NAME'] = 'v1.0.0';
    await run();
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('does not match'));
  });

  it('skips version check when strict_version=false', async () => {
    setupInputs({ strict_version: 'false' });
    setupPackageJson('9.9.9');
    process.env['GITHUB_REF_NAME'] = 'v1.0.0';
    await run();
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it('strips monorepo prefix before comparing versions', async () => {
    setupInputs();
    setupPackageJson('1.0.0');
    process.env['GITHUB_REF_NAME'] = 'my-service/v1.0.0';
    await run();
    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});

describe('Environment version checks', () => {
  it('fails when node version is too low', async () => {
    setupInputs();
    setupPackageJson('1.0.0');
    Object.defineProperty(process, 'version', { value: 'v22.13.0', writable: true });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      'Trusted publishing requires Node version 22.14.0 or higher. Current version is v22.13.0.',
    );
  });

  it('fails when npm version is too low', async () => {
    setupInputs();
    setupPackageJson('1.0.0');
    mockGetExecOutput.mockResolvedValue({ stdout: '11.5.0', stderr: '' });

    await run();

    expect(mockSetFailed).toHaveBeenCalledWith(
      'Trusted publishing requires npm CLI version 11.5.1 or later. Current version is 11.5.0.',
    );
  });

  it('succeeds when node and npm versions are sufficient', async () => {
    setupInputs();
    setupPackageJson('1.0.0');

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it('succeeds when node and npm versions are higher', async () => {
    setupInputs();
    setupPackageJson('1.0.0');
    Object.defineProperty(process, 'version', { value: 'v23.0.0', writable: true });
    mockGetExecOutput.mockResolvedValue({ stdout: '12.0.0', stderr: '' });

    await run();

    expect(mockSetFailed).not.toHaveBeenCalled();
  });
});

describe('build script', () => {
  it('skips build when no build script is provided', async () => {
    setupInputs({ build_script: '' });
    setupPackageJson('1.0.0');
    await run();
    const buildCalls = mockExec.mock.calls.filter(
      ([cmd, args]) => cmd === 'pnpm' && args?.[0] === 'run',
    );
    expect(buildCalls).toHaveLength(0);
  });

  it('runs build script when it is provided', async () => {
    setupInputs({ build_script: 'build' });
    setupPackageJson('1.0.0');
    await run();
    expect(mockExec).toHaveBeenCalledWith('pnpm', ['run', 'build'], expect.any(Object));
  });
});

describe('publishing', () => {
  it('publishes stable release for a stable tag', async () => {
    setupInputs({ npm_provenance: 'false' });
    setupPackageJson('1.0.0');
    process.env['GITHUB_REF_NAME'] = 'v1.0.0';
    await run();
    expect(mockExec).toHaveBeenLastCalledWith(
      'pnpm',
      ['publish', '--access', 'public', '--provenance', '--no-git-checks'],
      expect.any(Object),
    );
  });

  it('publishes beta release with --tag beta for unstable tag', async () => {
    setupInputs({ npm_provenance: 'false' });
    setupPackageJson('1.0.0-rc.1');
    process.env['GITHUB_REF_NAME'] = 'v1.0.0-rc.1';
    await run();
    expect(mockExec).toHaveBeenLastCalledWith(
      'pnpm',
      ['publish', '--access', 'public', '--provenance', '--no-git-checks', '--tag', 'beta'],
      expect.any(Object),
    );
  });
});
