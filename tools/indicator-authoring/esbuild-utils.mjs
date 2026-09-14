import path from "node:path";

export function loaderFor(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  )
    return "ts";
  return "js";
}

export function isWithinRoot(root, fileName) {
  const relative = path.relative(root, fileName);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function isDependencyPath(fileName) {
  return path.resolve(fileName).split(path.sep).includes("node_modules");
}
