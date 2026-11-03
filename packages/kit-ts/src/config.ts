/** Configuration from the environment. */

export const ENV_VARS = ["CP_MODULE", "CP_VERSION", "CP_VALKEY_URL", "CP_ADMIN_URL"] as const;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Config {
  module: string;
  version: string;
  valkeyUrl: string;
  adminUrl: string;
}

/** Read the kit settings; throws naming every missing variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new ConfigError(`missing environment variable(s): ${missing.join(", ")}`);
  }
  const get = (name: (typeof ENV_VARS)[number]): string => env[name] ?? "";
  return {
    module: get("CP_MODULE"),
    version: get("CP_VERSION"),
    valkeyUrl: get("CP_VALKEY_URL"),
    adminUrl: get("CP_ADMIN_URL").replace(/\/+$/, ""),
  };
}
