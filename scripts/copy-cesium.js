const fs = require("fs");
const path = require("path");

const srcRoot = path.join(__dirname, "..", "node_modules", "cesium", "Build", "Cesium");
const destRoot = path.join(__dirname, "..", "public", "cesium");
const dirs = ["Workers", "ThirdParty", "Assets", "Widgets"];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(srcRoot)) {
  console.warn("[copy-cesium] cesium package not found — skip");
  process.exit(0);
}

for (const dir of dirs) {
  copyDir(path.join(srcRoot, dir), path.join(destRoot, dir));
}
console.log("[copy-cesium] synced Assets/Workers/Widgets/ThirdParty → public/cesium");
