// socket.io のクライアントJSを public/ にコピーする。
// exe化(pkg)時に socket.io 標準のクライアント配信が不安定になるのを避け、
// 自前でアセットとして同梱・配信するため。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "node_modules", "socket.io", "client-dist", "socket.io.min.js");
const dest = path.join(root, "public", "socket.io.min.js");

fs.copyFileSync(src, dest);
console.log("copied socket.io client ->", path.relative(root, dest));
