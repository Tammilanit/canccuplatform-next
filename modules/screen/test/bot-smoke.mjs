// Compose smoke test: Screen's server reads the bot's module paths for the screens (contracts/bot.md,
// For the screens) as a module, with its own service identity, on the stack's network (CI's compose
// job). The demo event has no guild bound there, so each answers, counts only, `available: false`:
//   docker compose -f deploy/compose.yml exec -T screen node --input-type=module < modules/screen/test/bot-smoke.mjs
const dist = process.env.CANCCU_SCREEN_DIST ?? "/repo/modules/screen/dist";
const kit = process.env.CANCCU_KIT_DIST ?? "/repo/packages/kit-ts/dist/index.js";
const { ServiceIdentity, serviceKeyFromEnv } = await import(kit);
const { httpSources } = await import(`${dist}/compose/sources.js`);

const service = new ServiceIdentity({ module: "screen", key: serviceKeyFromEnv() });
const bot = process.env.CANCCU_BOT_URL ?? "http://bot:8080";
const urls = { agenda: "", tenants: "", theming: "", notify: "", bot };
const sources = httpSources(urls, service, { warn: (o, m) => console.error(m, JSON.stringify(o)) });
for (const [name, read, list] of [
  ["playing", sources.botPlaying, "games"],
  ["voice", sources.botVoice, "channels"],
]) {
  const answer = await read("demo");
  console.log(name, JSON.stringify(answer));
  if (answer === null || typeof answer.available !== "boolean" || !Array.isArray(answer[list]))
    throw new Error(`the bot's ${name} counts did not answer the screen module`);
}
