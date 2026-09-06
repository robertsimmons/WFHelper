// A fetch-shaped wrapper around the system curl, for the suggest data build.

// Cloudflare answers node's TLS fingerprint with a 403 on every overframe.gg
// HTML route, so the page crawl goes through curl instead. The JSON API is not
// behind that check and uses plain fetch, which keeps it reusable at runtime.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const NO_HEADERS = { get: () => null };

export function curlFetch(url, init = {}) {
  const body = path.join(os.tmpdir(), `wfhelper-curl-${process.pid}.body`);
  const args = ["-sS", "--compressed", "-o", body, "-w", "%{http_code}", url];
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    args.push("-H", `${name}: ${value}`);
  }
  return run("curl", args, { windowsHide: true }).then(({ stdout }) => {
    const status = Number(stdout.trim());
    const text = fs.existsSync(body) ? fs.readFileSync(body, "utf-8") : "";
    fs.rmSync(body, { force: true });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: NO_HEADERS,
      text: async () => text,
    };
  });
}
