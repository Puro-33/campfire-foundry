import catalog from "@/data/physical-ai-ontology.v1.json";
import { requireSiteUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSiteUser(request);
    return new Response(JSON.stringify(catalog, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="physical-ai-ontology.v1.json"',
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "온톨로지 파일을 내보내지 못했습니다." }, { status: 500 });
  }
}
