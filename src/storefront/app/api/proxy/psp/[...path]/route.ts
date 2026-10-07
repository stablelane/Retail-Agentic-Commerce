import type { NextRequest } from "next/server";

import { forwardToUpstream } from "@/lib/commerce/proxy";
import { PSP_PROXY_RULES } from "@/lib/commerce/proxy-allowlist";
import { getPspConfig } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: NextRequest, { params }: RouteContext) {
  const { path } = await params;
  return forwardToUpstream(request, path, {
    upstream: getPspConfig(),
    rules: PSP_PROXY_RULES,
    keyName: "PSP_API_KEY",
  });
}

export { handle as GET, handle as POST };
