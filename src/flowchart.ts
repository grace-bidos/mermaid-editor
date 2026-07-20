export type FlowDirection = "TD" | "TB" | "LR" | "RL" | "BT";
export type NodeShape = "rectangle" | "rounded" | "terminal" | "decision" | "circle";

export interface FlowNode {
  id: string;
  label: string;
  shape: NodeShape;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  connector: "-->" | "---" | "-.->" | "==>";
}

export interface FlowchartModel {
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface ParseResult {
  model: FlowchartModel | null;
  reason?: string;
}

const NODE_ID = "[A-Za-z_][\\w-]*";
const NODE_TOKEN = `(${NODE_ID})(\\(\\[[^\\n]*?\\]\\)|\\(\\([^\\n]*?\\)\\)|\\[[^\\n]*?\\]|\\([^\\n]*?\\)|\\{[^\\n]*?\\})?`;
const nodeLinePattern = new RegExp(`^\\s*${NODE_TOKEN}\\s*$`);
const edgeLinePattern = new RegExp(
  `^\\s*${NODE_TOKEN}\\s*(-->|---|-\\.->|==>)\\s*(?:\\|([^|]*)\\|\\s*)?${NODE_TOKEN}\\s*$`,
);
const labeledEdgeLinePattern = new RegExp(
  `^\\s*${NODE_TOKEN}\\s*--\\s+(.+?)\\s+-->\\s*${NODE_TOKEN}\\s*$`,
);

export function parseFlowchart(source: string): ParseResult {
  const lines = source.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\s*(flowchart|graph)\s+/i.test(line));
  if (headerIndex < 0) return { model: null, reason: "フローチャートのみビジュアル編集できます" };

  const header = lines[headerIndex]?.match(/^\s*(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\s*$/i);
  if (!header?.[1]) return { model: null, reason: "図の方向を読み取れません" };

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line || line.startsWith("%%")) continue;

    const labeledEdgeMatch = line.match(labeledEdgeLinePattern);
    if (labeledEdgeMatch) {
      const [, fromId, fromSyntax, edgeLabel, toId, toSyntax] = labeledEdgeMatch;
      if (!fromId || !toId) {
        return { model: null, reason: `ビジュアル編集できない行があります（${index + 1}行目）` };
      }

      upsertNode(nodes, fromId, fromSyntax);
      upsertNode(nodes, toId, toSyntax);
      edges.push({
        from: fromId,
        to: toId,
        label: stripQuotes(edgeLabel?.trim() ?? ""),
        connector: "-->",
      });
      continue;
    }

    const edgeMatch = line.match(edgeLinePattern);
    if (edgeMatch) {
      const [, fromId, fromSyntax, connector, edgeLabel, toId, toSyntax] = edgeMatch;
      if (!fromId || !toId || !isConnector(connector)) {
        return { model: null, reason: `ビジュアル編集できない行があります（${index + 1}行目）` };
      }

      upsertNode(nodes, fromId, fromSyntax);
      upsertNode(nodes, toId, toSyntax);
      edges.push({
        from: fromId,
        to: toId,
        label: stripQuotes(edgeLabel?.trim() ?? ""),
        connector,
      });
      continue;
    }

    const nodeMatch = line.match(nodeLinePattern);
    if (nodeMatch?.[1]) {
      upsertNode(nodes, nodeMatch[1], nodeMatch[2]);
      continue;
    }

    return { model: null, reason: `高度な構文があるため読み取り専用です（${index + 1}行目）` };
  }

  if (nodes.size === 0) return { model: null, reason: "編集できるノードがありません" };

  return {
    model: {
      direction: header[1].toUpperCase() as FlowDirection,
      nodes: [...nodes.values()],
      edges,
    },
  };
}

export function serializeFlowchart(model: FlowchartModel): string {
  const nodeLines = model.nodes.map((node) => `  ${node.id}${formatNode(node)}`);
  const edgeLines = model.edges.map((edge) => {
    const label = edge.label ? `|${escapeLabel(edge.label)}|` : "";
    return `  ${edge.from} ${edge.connector}${label} ${edge.to}`;
  });

  return [`flowchart ${model.direction}`, ...nodeLines, ...(edgeLines.length ? ["", ...edgeLines] : [])].join(
    "\n",
  );
}

export function cloneFlowchart(model: FlowchartModel): FlowchartModel {
  return {
    direction: model.direction,
    nodes: model.nodes.map((node) => ({ ...node })),
    edges: model.edges.map((edge) => ({ ...edge })),
  };
}

export function nextNodeId(model: FlowchartModel): string {
  const ids = new Set(model.nodes.map((node) => node.id));
  let number = 1;
  while (ids.has(`node${number}`)) number += 1;
  return `node${number}`;
}

function upsertNode(nodes: Map<string, FlowNode>, id: string, syntax?: string): void {
  const parsed = parseNodeSyntax(id, syntax);
  const existing = nodes.get(id);

  if (!existing) {
    nodes.set(id, parsed);
  } else if (syntax) {
    nodes.set(id, parsed);
  }
}

function parseNodeSyntax(id: string, syntax?: string): FlowNode {
  if (!syntax) return { id, label: id, shape: "rectangle" };

  if (syntax.startsWith("([")) {
    return { id, label: stripQuotes(syntax.slice(2, -2)), shape: "terminal" };
  }
  if (syntax.startsWith("((")) {
    return { id, label: stripQuotes(syntax.slice(2, -2)), shape: "circle" };
  }
  if (syntax.startsWith("[")) {
    return { id, label: stripQuotes(syntax.slice(1, -1)), shape: "rectangle" };
  }
  if (syntax.startsWith("{")) {
    return { id, label: stripQuotes(syntax.slice(1, -1)), shape: "decision" };
  }
  return { id, label: stripQuotes(syntax.slice(1, -1)), shape: "rounded" };
}

function formatNode(node: FlowNode): string {
  const label = quoteLabel(node.label);
  switch (node.shape) {
    case "rounded":
      return `(${label})`;
    case "terminal":
      return `([${label}])`;
    case "decision":
      return `{${label}}`;
    case "circle":
      return `((${label}))`;
    case "rectangle":
      return `[${label}]`;
  }
}

function escapeLabel(label: string): string {
  return label.replaceAll("\n", " ").replaceAll('"', '\\"');
}

function quoteLabel(label: string): string {
  return `"${escapeLabel(label)}"`;
}

function stripQuotes(label: string): string {
  if (label.length >= 2 && label.startsWith('"') && label.endsWith('"')) {
    return label.slice(1, -1).replaceAll('\\"', '"');
  }
  return label;
}

function isConnector(value: string | undefined): value is FlowEdge["connector"] {
  return value === "-->" || value === "---" || value === "-.->" || value === "==>";
}
