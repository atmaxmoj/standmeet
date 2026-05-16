/**
 * Build API Server — receives build requests from Django, runs builds
 * in a sandbox-runtime sandbox, returns output files.
 *
 * Listens on port 5174.
 *
 * POST /build
 *   Body: { source_files, packages, content_data, asset_manifest, page_id, meta }
 *   Response: { status, output_files: { "index.html": "<base64>", ... }, build_log }
 */

import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

const PORT = parseInt(process.env.BUILD_API_PORT || '5174', 10);
const APP_DIR = '/app';

/**
 * Check if sandbox-runtime (srt) is available and can actually create sandboxes.
 * bwrap needs user namespace support which may not be available in Docker.
 */
let srtAvailable = false;
try {
  // Write a minimal config and test with a real sandboxed command
  const testConfig = JSON.stringify({
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: { denyRead: [], allowWrite: ['/tmp'], denyWrite: [] },
    enableWeakerNestedSandbox: true,
  });
  writeFileSync('/tmp/.srt-test-config.json', testConfig);
  execSync('srt --settings /tmp/.srt-test-config.json echo ok', {
    stdio: 'ignore',
    timeout: 10000,
  });
  srtAvailable = true;
} catch {
  console.log('[build-server] srt sandboxing not available (likely missing namespace support), builds will run unsandboxed');
}

/**
 * Run a command, optionally wrapped with srt sandbox.
 */
function runCommand(cmd, args, options = {}) {
  const { srtSettings, timeout = 120_000, cwd } = options;

  let finalCmd, finalArgs;
  if (srtAvailable && srtSettings) {
    // Write temporary settings file
    const settingsPath = join(cwd || APP_DIR, '.srt-settings.json');
    writeFileSync(settingsPath, JSON.stringify(srtSettings));
    finalCmd = 'srt';
    finalArgs = ['--settings', settingsPath, cmd, ...args];
  } else {
    finalCmd = cmd;
    finalArgs = args;
  }

  return execFileSync(finalCmd, finalArgs, {
    cwd: cwd || APP_DIR,
    timeout,
    stdio: 'pipe',
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Recursively collect all files in a directory.
 */
function collectFiles(dir, base) {
  const result = {};
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      Object.assign(result, collectFiles(full, rel));
    } else {
      result[rel] = readFileSync(full).toString('base64');
    }
  }
  return result;
}

/**
 * Handle a build request.
 */
async function handleBuild(body) {
  const { source_files, packages, content_data, asset_manifest, page_id, meta } = body;
  const logs = [];
  const log = (msg) => { console.log(`[build] ${msg}`); logs.push(msg); };

  // Use a temporary workspace inside the container
  const workspace = `/tmp/build-${page_id}-${Date.now()}`;
  const sourceDir = join(workspace, 'source');
  const dataDir = join(workspace, 'data');
  const distDir = join(workspace, 'dist');

  try {
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });

    // Write source files
    for (const [filename, content] of Object.entries(source_files)) {
      const filepath = join(sourceDir, filename);
      mkdirSync(join(filepath, '..'), { recursive: true });
      writeFileSync(filepath, content);
    }
    log(`Wrote ${Object.keys(source_files).length} source files`);

    // Write data files
    writeFileSync(join(dataDir, 'content.json'), JSON.stringify(content_data));
    writeFileSync(join(dataDir, 'assets.json'), JSON.stringify(asset_manifest));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ page_id }));

    // Write meta
    const metaDict = {
      title: meta?.title || '',
      description: meta?.description || '',
      favicon_url: meta?.favicon_asset_path ? (asset_manifest[meta.favicon_asset_path] || '') : '',
      og_image_url: meta?.og_image_asset_path ? (asset_manifest[meta.og_image_asset_path] || '') : '',
      custom_head: meta?.custom_head || '',
    };
    writeFileSync(join(dataDir, 'meta.json'), JSON.stringify(metaDict));

    // Phase 1: Install packages (with network for npm registry)
    if (packages && packages.length > 0) {
      log(`Installing packages: ${packages.join(' ')}`);
      try {
        const installOutput = runCommand('npm', ['install', '--save', ...packages], {
          cwd: APP_DIR,
          timeout: 120_000,
          srtSettings: srtAvailable ? {
            network: {
              allowedDomains: ['registry.npmjs.org', '*.npmjs.org', '*.yarnpkg.com'],
              deniedDomains: [],
            },
            filesystem: {
              denyRead: [],
              allowWrite: [APP_DIR, '/tmp', workspace],
              denyWrite: [],
            },
            enableWeakerNestedSandbox: true,
          } : undefined,
        });
        log(`npm install output:\n${installOutput}`);
      } catch (err) {
        log(`npm install failed: ${err.message}\n${err.stderr || ''}\n${err.stdout || ''}`);
        return { status: 'failed', output_files: {}, build_log: logs.join('\n') };
      }
    } else {
      log('No additional packages to install');
    }

    // Copy source to /app/source (Vite project root expects it there)
    if (existsSync(join(APP_DIR, 'source'))) {
      rmSync(join(APP_DIR, 'source'), { recursive: true, force: true });
    }
    execSync(`cp -r ${sourceDir} ${join(APP_DIR, 'source')}`);
    log('Copied source files to /app/source');

    // Phase 2: Build (no network)
    log('Running build...');
    try {
      // Set WORKSPACE env for build.mjs
      const env = {
        ...process.env,
        NODE_ENV: 'production',
        WORKSPACE: workspace,
      };

      let buildOutput;
      if (srtAvailable) {
        const settingsPath = join(workspace, '.srt-build-settings.json');
        writeFileSync(settingsPath, JSON.stringify({
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          filesystem: {
            denyRead: [],
            allowWrite: [APP_DIR, '/tmp', workspace],
            denyWrite: [],
          },
          enableWeakerNestedSandbox: true,
        }));
        buildOutput = execFileSync('srt', ['--settings', settingsPath, 'node', 'build.mjs'], {
          cwd: APP_DIR,
          timeout: 60_000,
          stdio: 'pipe',
          encoding: 'utf-8',
          env,
          maxBuffer: 10 * 1024 * 1024,
        });
      } else {
        buildOutput = execFileSync('node', ['build.mjs'], {
          cwd: APP_DIR,
          timeout: 60_000,
          stdio: 'pipe',
          encoding: 'utf-8',
          env,
          maxBuffer: 10 * 1024 * 1024,
        });
      }
      log(`Build output:\n${buildOutput}`);
    } catch (err) {
      log(`Build failed: ${err.message}\n${err.stderr || ''}\n${err.stdout || ''}`);
      return { status: 'failed', output_files: {}, build_log: logs.join('\n') };
    }

    // Collect output files
    const outputFiles = collectFiles(distDir);
    if (Object.keys(outputFiles).length === 0) {
      log('No output files produced');
      return { status: 'failed', output_files: {}, build_log: logs.join('\n') };
    }

    log(`Build complete: ${Object.keys(outputFiles).length} output files`);
    return { status: 'success', output_files: outputFiles, build_log: logs.join('\n') };

  } finally {
    // Cleanup
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * HTTP Server
 */
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/build') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleBuild(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[build-server] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'failed',
          output_files: {},
          build_log: `Server error: ${err.message}`,
        }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, srt: srtAvailable }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[build-server] Listening on port ${PORT} (srt: ${srtAvailable})`);
});
