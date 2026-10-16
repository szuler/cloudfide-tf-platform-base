// Thin, side-effecting process wrapper. Kept separate from pure logic so the
// pure logic stays unit-testable without spawning processes.
import { spawnSync } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command without a shell (no shell interpolation -> no shell injection). */
export function run(cmd: string, args: string[], cwd: string): ExecResult {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Terraform binary. Overridable via TERRAFORM_BIN (local Windows pins 1.16.6). */
export function terraformBin(): string {
  return process.env.TERRAFORM_BIN ?? "terraform";
}
