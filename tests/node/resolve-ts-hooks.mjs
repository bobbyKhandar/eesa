// Lets node:test load backend TypeScript that imports sibling modules with .js
// specifiers or with no extension (the backend's TypeScript style).
// Only project files are rewritten. Applying the same rewrite inside
// node_modules turns real .js files (for example zod/v3/external.js) into
// missing .ts paths.
function isProjectModule(parentURL) {
  if (typeof parentURL !== "string" || !parentURL.includes("/workspace/")) return false;
  return !parentURL.includes("/node_modules/");
}

export async function resolve(specifier, context, nextResolve) {
  if (isProjectModule(context.parentURL) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    if (specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
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
