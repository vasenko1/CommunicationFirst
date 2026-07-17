import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Run tests inside a real workerd instance using the bindings and
// Durable Object migrations declared in wrangler.jsonc.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.jsonc"
        }
      }
    }
  }
});
