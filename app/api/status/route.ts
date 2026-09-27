import { status } from "@/lib/service";

export async function GET() {
  return Response.json(await status(), { headers: { "Cache-Control": "no-store" } });
}
