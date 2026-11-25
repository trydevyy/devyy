import fs from "node:fs";
import path from "node:path";

function resolveDependency(directory, name) {
  for (;;) {
    const manifest = path.join(directory, "node_modules", name, "package.json");
    if (fs.existsSync(manifest)) return path.dirname(fs.realpathSync(manifest));
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function* productionDependencies(root) {
  const seen = new Set();
  function* visit(directory) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    if (directory !== root) yield { directory, pkg };
    const optional = { ...pkg.optionalDependencies };
    for (const [name, metadata] of Object.entries(
      pkg.peerDependenciesMeta ?? {},
    )) {
      if (metadata.optional) optional[name] = true;
    }
    const dependencies = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const dependency = resolveDependency(directory, name);
      if (!dependency) {
        if (Object.hasOwn(optional, name)) continue;
        throw Error(`Install dependencies before generating credits: ${name}`);
      }
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      yield* visit(dependency);
    }
  }
  yield* visit(root);
}
