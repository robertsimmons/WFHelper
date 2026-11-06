// Prints one acquisition plan's steps as text, full and as the saved player
// state sees it: `pnpm plan:text <slug or item name>`, or `--all` to write every
// plan to plans/review/. Runs in vitest because the plan code needs its
// import.meta.glob and the item database build.
import { fileURLToPath } from "node:url";

import { startVitest } from "vitest/node";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = "tests/renderer/planText";

const vitest = await startVitest("test", [], {
  root,
  config: false,
  watch: false,
  include: [`${dir}/planText.run.ts`],
  setupFiles: [`${dir}/savedStorage.ts`],
  provide: { planTextArgs: process.argv.slice(2) },
  reporters: [{}],
  testTimeout: 600000,
  hookTimeout: 600000,
});

const tasks = vitest.state.getFiles().flatMap((file) => file.tasks);
const result = tasks.map((task) => task.meta.planText).find(Boolean);
const errors = vitest.state
  .getFiles()
  .flatMap((file) => [file, ...file.tasks])
  .flatMap((task) => task.result?.errors ?? []);
await vitest.close();

if (result) console.log(result.output);
for (const error of errors) console.error(error.stack ?? error.message);
process.exit(result?.ok && errors.length === 0 ? 0 : 1);
