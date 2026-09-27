/** In-memory stand-in for the Upstash REST `/pipeline` endpoint, covering the commands the app uses. */
export function upstashMock(url = "https://kv.upstash.test") {
  const data = new Map<string, number | string>();
  const commands: string[][] = [];
  let down = false;
  const run = ([name, key, ...args]: string[]) => {
    commands.push([name, key, ...args]);
    const current = Number(data.get(key) ?? 0);
    if (name === "GET") return data.has(key) ? String(data.get(key)) : null;
    if (name === "SET") {
      if (args.includes("NX") && data.has(key)) return null;
      data.set(key, args[0]);
      return "OK";
    }
    if (name === "INCR" || name === "INCRBY" || name === "DECRBY") {
      const next = current + (name === "INCR" ? 1 : name === "INCRBY" ? Number(args[0]) : -Number(args[0]));
      data.set(key, next);
      return next;
    }
    throw new Error(`upstash mock: unsupported command ${name}`);
  };
  const fetcher: typeof fetch = async (input, init) => {
    if (!String(input).startsWith(url)) throw new Error(`Unexpected network call to ${String(input)}`);
    if (down) throw new Error("store down");
    const body = JSON.parse(String(init?.body)) as string[][];
    return Response.json(body.map((command) => ({ result: run(command) })));
  };
  return {
    url,
    data,
    commands,
    fetcher,
    env: { KV_REST_API_URL: url, KV_REST_API_TOKEN: "store-token" },
    setDown(value: boolean) { down = value; },
  };
}
