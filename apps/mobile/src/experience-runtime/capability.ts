import type { ClientCapability, UISchema } from "@proxy/contracts";
import { getSchemaStats } from "@proxy/contracts";

// §11 Capability Protocol — frontend tells backend what it can render

export function buildClientCapability(input: {
  clientVersion: string;
  platform: "ios" | "android" | "web";
  uiRuntimeVersion: string;
  capabilities: string[];
  maxSchemaDepth?: number;
  maxNodes?: number;
  supportsStreamDelta?: boolean;
}): ClientCapability {
  return {
    client_version: input.clientVersion,
    platform: input.platform,
    ui_runtime_version: input.uiRuntimeVersion,
    capabilities: input.capabilities,
    limits: {
      max_schema_depth: input.maxSchemaDepth ?? 8,
      max_nodes: input.maxNodes ?? 80,
      supports_stream_delta: input.supportsStreamDelta ?? true,
    },
  };
}

// §11 后台流程的本地镜像：Capability Check → fallback
export function checkCapabilityForSchema(cap: ClientCapability, schema: UISchema): { ok: true } | { ok: false; reason: string } {
  const stats = getSchemaStats(schema);
  if (stats.depth > cap.limits.max_schema_depth) {
    return { ok: false, reason: `CAPABILITY_DEPTH_EXCEEDED: ${stats.depth} > ${cap.limits.max_schema_depth}` };
  }
  if (stats.nodes > cap.limits.max_nodes) {
    return { ok: false, reason: `CAPABILITY_NODES_EXCEEDED: ${stats.nodes} > ${cap.limits.max_nodes}` };
  }
  return { ok: true };
}

export function hasCapability(cap: ClientCapability, required: string): boolean {
  const [reqName, reqVerRaw] = required.split(":v");
  const reqVer = Number(reqVerRaw);
  for (const c of cap.capabilities) {
    const [name, verRaw] = c.split(":v");
    if (name === reqName && Number(verRaw) >= reqVer) return true;
  }
  return false;
}
