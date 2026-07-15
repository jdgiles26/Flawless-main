import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(join(projectRoot, "frontend", "modern", "package.json"));
const { chromium } = require("playwright-core");
const distDir = join(projectRoot, "frontend", "dist");
const videoDir = resolve(process.env.Flawless_DEMO_OUTPUT_DIR || join(projectRoot, "outputs", "demo-videos"));
const rawDir = join(videoDir, "raw");
const coverDir = join(videoDir, "covers");
const port = Number(process.env.Flawless_DEMO_PORT || 8765);
const baseUrl = `http://127.0.0.1:${port}`;

const chromePath = process.env.Flawless_CHROME_PATH || "";
const ffmpeg = process.env.Flawless_FFMPEG_PATH || "ffmpeg";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const jobs = [
  {
    mode: "inspection",
    durationMs: 26000,
    fps: 24,
    output: "01-ai-inspection-auto-healing-cinematic.mp4",
    cover: "01-ai-inspection-auto-healing-cinematic.png",
    coverAtMs: 17800,
  },
  {
    mode: "skills",
    durationMs: 16500,
    fps: 24,
    output: "02-ops-skills-library-scroll-cinematic.mp4",
    cover: "02-ops-skills-library-scroll-cinematic.png",
    coverAtMs: 9000,
  },
  {
    mode: "topology",
    durationMs: 22000,
    fps: 24,
    output: "03-release-topology-impact-simulation-cinematic.mp4",
    cover: "03-release-topology-impact-simulation-cinematic.png",
    coverAtMs: 13200,
  },
];

function ensureReady() {
  if (!existsSync(distDir)) {
    throw new Error(`frontend/dist not found: ${distDir}. Run "npm run build" in frontend/modern first.`);
  }
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(coverDir, { recursive: true });
}

function createStaticServer() {
  return createServer((req, res) => {
    const url = new URL(req.url || "/", baseUrl);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || !extname(pathname)) pathname = "/index.html";
    const filePath = resolve(distDir, `.${pathname}`);
    if (!filePath.startsWith(distDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  });
}

async function recordOne(browser, job) {
  const frameDir = join(rawDir, job.mode);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?demoVideo=${job.mode}`, { waitUntil: "networkidle" });

  const totalFrames = Math.ceil((job.durationMs / 1000) * job.fps);
  const frameIntervalMs = 1000 / job.fps;
  const coverFrame = Math.round(job.coverAtMs / frameIntervalMs);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const progress = totalFrames <= 1 ? 1 : frame / (totalFrames - 1);
    await page.evaluate((value) => {
      window.__luxyaiDemoProgress = value;
      window.dispatchEvent(new CustomEvent("luxyai-demo-progress", { detail: value }));
    }, progress);
    await page.waitForTimeout(8);
    const framePath = join(frameDir, `frame_${String(frame + 1).padStart(5, "0")}.jpg`);
    await page.screenshot({ path: framePath, type: "jpeg", quality: 88, fullPage: false });
    if (frame === coverFrame) {
      await page.screenshot({ path: join(coverDir, job.cover), fullPage: false });
    }
    await page.waitForTimeout(frameIntervalMs);
  }
  await context.close();
  const mp4Path = join(videoDir, job.output);

  const result = spawnSync(ffmpeg, [
    "-y",
    "-framerate", String(job.fps),
    "-i", join(frameDir, "frame_%05d.jpg"),
    "-vf", "fps=30,format=yuv420p",
    "-movflags", "+faststart",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-an",
    mp4Path,
  ], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    throw new Error(`Unable to start ffmpeg (${ffmpeg}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${job.output}`);
  }
  console.log(`wrote ${mp4Path}`);
}

async function main() {
  ensureReady();
  const selectedModes = new Set(process.argv.slice(2));
  const selectedJobs = selectedModes.size ? jobs.filter((job) => selectedModes.has(job.mode)) : jobs;
  if (!selectedJobs.length) {
    throw new Error(`No matching demo modes. Available: ${jobs.map((job) => job.mode).join(", ")}`);
  }
  const server = createStaticServer();
  await new Promise((resolveStart) => server.listen(port, "127.0.0.1", resolveStart));
  console.log(`serving ${distDir} at ${baseUrl}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath && existsSync(chromePath) ? chromePath : undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    for (const job of selectedJobs) {
      await recordOne(browser, job);
    }
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
