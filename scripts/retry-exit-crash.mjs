// Runs a native/e2e test command and repeats it (three attempts at most) when the
// ONLY thing that went wrong is Electron crashing while it exits.
//
// Electron 41 dies with an access violation (0xC0000005, exit code 3221225477)
// inside electron.exe on roughly four shutdowns in ten after OCR work - after
// the app has closed its windows and after every assertion has passed. The
// harnesses rightly insist on a clean exit code, so that race used to fail a
// whole pre-push run at random. A real failure is never retried: any other
// error in the output keeps the first result.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXIT_CRASH_CODE = "3221225477";
const RETRY_DELAY_MS = 8_000;
// Measured at roughly four crashes in ten exits, often twice in a row.
const MAX_ATTEMPTS = 3;

/** True when every failure the output reports is the exit crash. */
export function failedOnlyOnExitCrash(output) {
  const lines = output.split(/\r?\n/);

  // scripts/reward-scan-e2e and scripts/dbwin-regression: one summary line.
  const summaries = lines.filter((line) => line.startsWith("FAILURES: "));
  // Playwright: one "Error: ..." line per failed test.
  const errors = lines.filter((line) => /^\s*Error: /.test(line));

  const reported = [...summaries, ...errors];
  if (reported.length === 0) return false;
  return reported.every((line) => {
    if (!line.includes(EXIT_CRASH_CODE)) return false;
    // A summary joins several failures with ", " - each one must be the crash.
    if (!line.startsWith("FAILURES: ")) return true;
    return line
      .slice("FAILURES: ".length)
      .split(", ")
      .every((failure) => failure.includes(EXIT_CRASH_CODE));
  });
}

function run(command) {
  return new Promise((resolve) => {
    const child = spawn(command.join(" "), {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const forward = (stream) => (chunk) => {
      output += chunk;
      stream.write(chunk);
    };
    child.stdout.on("data", forward(process.stdout));
    child.stderr.on("data", forward(process.stderr));
    child.on("error", (error) => {
      output += String(error);
      resolve({ code: 1, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function main() {
  const command = process.argv.slice(2);
  if (command.length === 0) {
    console.error("usage: node scripts/retry-exit-crash.mjs <command...>");
    process.exit(2);
  }
  for (let attempt = 1; ; attempt++) {
    const result = await run(command);
    if (result.code === 0) process.exit(0);
    if (attempt >= MAX_ATTEMPTS || !failedOnlyOnExitCrash(result.output)) process.exit(result.code);

    console.error(
      "\nretry-exit-crash: every check passed and only Electron's exit crashed - " +
        `attempt ${attempt + 1} of ${MAX_ATTEMPTS}.\n`,
    );
    // The crashed process tree and its crash handler need a moment to go away; a
    // run started on top of them has lost its Electron host mid-test.
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
