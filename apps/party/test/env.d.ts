declare module 'cloudflare:test' {
  // The test environment exposes the same bindings as the Worker.
  // Typed loosely here; tests cast to the concrete `Env`.
  export const env: Record<string, unknown>;
}
