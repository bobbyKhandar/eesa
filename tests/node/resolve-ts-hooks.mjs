// Lets node:test load backend TypeScript that imports sibling modules with .js
// specifiers or with no extension (the backend's TypeScript style).
// Only project files are rewritten. Applying the same rewrite inside
// node_modules turns real .js files (for example zod/v3/external.js) into
// missing .ts paths.
const repoURL = new URL("../../", import.meta.url).href;

function isProjectModule(parentURL) {
  if (typeof parentURL !== "string" || !parentURL.startsWith(repoURL)) return false;
  return !parentURL.includes("/node_modules/");
}

export async function resolve(specifier, context, nextResolve) {
  if (isProjectModule(context.parentURL) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    if (specifier.endsWith(".js")) {
      try {
        return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      } catch (error) {
        if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
        // Some project modules are JavaScript; preserve those imports.
        return nextResolve(specifier, context);
      }
    }
    const base = specifier.split("/").pop() ?? specifier;
    if (!base.includes(".")) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        // Not a TypeScript sibling. Fall through to the default resolver.
      }
    }
  }
  return nextResolve(specifier, context);
}
