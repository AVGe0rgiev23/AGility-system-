import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative asset paths so the static bundle works from any host path or folder.
  base: './',
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // A worker flake was reported during stage-0-ui: a test file silently did not run. Looked into
    // on 2026-09-16 (Vitest 5.0.0, Node 22.16, Windows 11, 16 logical CPUs) and not reproduced in 20
    // full runs, each checked file by file against the test files on disk through the JSON reporter:
    // 8 with these defaults (the forks pool), 3 with --pool=threads, 3 with --pool=forks
    // --maxWorkers=16, 2 with --no-file-parallelism, and 4 as two suites running at once. No pool or
    // worker setting is changed, since none was shown to matter. If it recurs, run
    // `vitest run --reporter=json --outputFile=report.json` and compare report.testResults with the
    // files on disk to name the file that did not run.
  },
})
