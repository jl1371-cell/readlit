// Copies the pdf.js worker and its data files into /public so the reader never depends on a CDN.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join(process.cwd(), "node_modules", "pdfjs-dist");
const dst = join(process.cwd(), "public", "pdfjs");
if (!existsSync(src)) process.exit(0);
mkdirSync(dst, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(dst, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  if (existsSync(join(src, dir))) cpSync(join(src, dir), join(dst, dir), { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
