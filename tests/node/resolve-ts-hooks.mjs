// Lets node:test load backend TypeScript that imports sibling modules with .js specifiers.
export async function resolve(specifier, context, nextResolve) {
  if (!context.parentURL?.includes("/node_modules/") && (specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
  return nextResolve(specifier, context);
}
