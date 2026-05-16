import { execFile } from "node:child_process";

type SandboxResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MEMORY_LIMIT = "256m";
const CPU_LIMIT = "0.5";

// Docker images per language
const LANGUAGE_IMAGES: Record<string, string> = {
  python: "python:3.11-slim",
  bash: "bash:5",
  javascript: "node:20-slim",
};

export async function runInSandbox(params: {
  language: string;
  script: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<SandboxResult> {
  const { language, script, args, timeoutMs = DEFAULT_TIMEOUT_MS } = params;

  const image = LANGUAGE_IMAGES[language];
  if (!image) {
    return {
      stdout: "",
      stderr: `Unsupported language: ${language}`,
      exitCode: 1,
      timedOut: false,
    };
  }

  // Build the command to execute inside the container
  let cmd: string[];
  const argsJson = args ? JSON.stringify(args) : "{}";

  if (language === "python") {
    // Pass script via stdin, args via env
    cmd = ["python3", "-c", script];
  } else if (language === "bash") {
    cmd = ["bash", "-c", script];
  } else {
    // javascript
    cmd = ["node", "-e", script];
  }

  const dockerArgs = [
    "run",
    "--rm",
    "--network=none",
    `--memory=${MEMORY_LIMIT}`,
    `--cpus=${CPU_LIMIT}`,
    "--read-only",
    "--tmpfs", "/tmp:size=64m",
    "--env", `ARGS=${argsJson}`,
    image,
    ...cmd,
  ];

  return new Promise<SandboxResult>((resolve) => {
    let timedOut = false;

    const proc = execFile("docker", dockerArgs, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      encoding: "utf-8",
    }, (error, stdout, stderr) => {
      if (error && "killed" in error && error.killed) {
        timedOut = true;
      }
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: error ? (error as any).code ?? 1 : 0,
        timedOut,
      });
    });

    // Extra safety: force kill after timeout + 5s
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
        timedOut = true;
      }
    }, timeoutMs + 5000);
  });
}
