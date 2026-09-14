import { capabilities } from "@/lib/service";

export function GET() {
  return Response.json(capabilities(), { headers: { "Cache-Control": "no-store" } });
}
