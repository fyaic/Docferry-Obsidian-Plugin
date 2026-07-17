export type DocferryProtocolCallback =
  | { kind: "billing-return"; status?: string }
  | { kind: "import"; url: string }
  | { kind: "auth"; data: Record<string, string> };

export function classifyProtocolCallback(data: Record<string, string>): DocferryProtocolCallback {
  if (data.flow === "billing-return") return { kind: "billing-return", status: data.status };
  if (data.flow === "import" && data.url) return { kind: "import", url: data.url };
  return { kind: "auth", data };
}
