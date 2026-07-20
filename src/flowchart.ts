export type FlowDirection = "TD" | "TB" | "LR" | "RL" | "BT";
export type NodeShape = "rectangle" | "rounded" | "terminal" | "decision" | "circle";

export interface NodeSemantics {
  shortLabel: string;
  accessibleDescription: string;
  detailDescription: string;
}

export const NODE_SHAPE_SEMANTICS: Record<NodeShape, NodeSemantics> = {
  rectangle: {
    shortLabel: "処理",
    accessibleDescription: "一般的には処理を表す形",
    detailDescription: "実行する作業や処理の内容を表すときに使われます。",
  },
  rounded: {
    shortLabel: "イベント",
    accessibleDescription: "一般的にはイベントを表す形",
    detailDescription: "工程で起きる出来事や状態の変化を表すときに使われます。",
  },
  terminal: {
    shortLabel: "開始・終了",
    accessibleDescription: "一般的には開始または終了を表す形",
    detailDescription: "フローの開始地点または終了地点を表すときに使われます。",
  },
  decision: {
    shortLabel: "判断",
    accessibleDescription: "一般的には判断を表す形",
    detailDescription: "条件を確認し、結果によって流れが分かれる地点を表します。",
  },
  circle: {
    shortLabel: "開始点",
    accessibleDescription: "一般的には開始点を表す形",
    detailDescription: "フローの開始点や、別の場所へつながる接続点として使われます。",
  },
};

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

export interface SourceRange {
  from: number;
  to: number;
}

export interface NodeSourceOccurrence extends SourceRange {
  kind: "explicit" | "bare";
}

export type NodeSourceRangeMap = Readonly<Partial<Record<string, readonly NodeSourceOccurrence[]>>>;

interface SourceLine {
  text: string;
  start: number;
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
const nodeLineRangePattern = new RegExp(`^\\s*${NODE_TOKEN}\\s*$`, "d");
const edgeLineRangePattern = new RegExp(
  `^\\s*${NODE_TOKEN}\\s*(-->|---|-\\.->|==>)\\s*(?:\\|([^|]*)\\|\\s*)?${NODE_TOKEN}\\s*$`,
  "d",
);
const labeledEdgeLineRangePattern = new RegExp(
  `^\\s*${NODE_TOKEN}\\s*--\\s+(.+?)\\s+-->\\s*${NODE_TOKEN}\\s*$`,
  "d",
);

export function parseFlowchart(source: string): ParseResult {
  const lines = scanSourceLines(source);
  const headerIndex = lines.findIndex(({ text }) => /^\s*(flowchart|graph)\s+/i.test(text));
  if (headerIndex < 0) return { model: null, reason: "フローチャートのみビジュアル編集できます" };

  const header = lines[headerIndex]?.text.match(/^\s*(?:flowchart|graph)\s+(TD|TB|LR|RL|BT)\s*$/i);
  if (!header?.[1]) return { model: null, reason: "図の方向を読み取れません" };

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.text.trim() ?? "";
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

/**
 * Returns every supported node occurrence as an absolute, half-open source range.
 *
 * An explicit node with shape or label syntax includes that syntax in its range.
 * A bare node occurrence includes only its ID. Invalid or unsupported flowcharts
 * return null, so callers never receive a partial mapping.
 */
export function getNodeSourceRanges(source: string): NodeSourceRangeMap | null {
  if (!parseFlowchart(source).model) return null;

  const lines = scanSourceLines(source);
  const headerIndex = lines.findIndex(({ text }) => /^\s*(flowchart|graph)\s+/i.test(text));
  const occurrences = new Map<string, NodeSourceOccurrence[]>();

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const sourceLine = lines[index];
    if (!sourceLine) continue;
    const { text: line, start: lineStart } = sourceLine;
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("%%")) {
      const labeledEdgeMatch = labeledEdgeLineRangePattern.exec(line);
      if (labeledEdgeMatch) {
        addNodeOccurrence(occurrences, labeledEdgeMatch, 1, 2, lineStart);
        addNodeOccurrence(occurrences, labeledEdgeMatch, 4, 5, lineStart);
      } else {
        const edgeMatch = edgeLineRangePattern.exec(line);
        if (edgeMatch) {
          addNodeOccurrence(occurrences, edgeMatch, 1, 2, lineStart);
          addNodeOccurrence(occurrences, edgeMatch, 5, 6, lineStart);
        } else {
          const nodeMatch = nodeLineRangePattern.exec(line);
          if (nodeMatch) addNodeOccurrence(occurrences, nodeMatch, 1, 2, lineStart);
        }
      }
    }
  }

  const result = Object.create(null) as Record<string, readonly NodeSourceOccurrence[]>;
  for (const [id, nodeOccurrences] of occurrences) result[id] = nodeOccurrences;
  return result;
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

function addNodeOccurrence(
  occurrences: Map<string, NodeSourceOccurrence[]>,
  match: RegExpExecArray,
  idGroup: number,
  syntaxGroup: number,
  lineStart: number,
): void {
  const id = match[idGroup];
  const idRange = match.indices?.[idGroup];
  if (!id || !idRange) return;

  const syntaxRange = match.indices?.[syntaxGroup];
  const existing = occurrences.get(id) ?? [];
  existing.push({
    from: lineStart + idRange[0],
    to: lineStart + (syntaxRange?.[1] ?? idRange[1]),
    kind: syntaxRange ? "explicit" : "bare",
  });
  occurrences.set(id, existing);
}

function scanSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  while (start <= source.length) {
    let end = start;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
    lines.push({ text: source.slice(start, end), start });
    if (end === source.length) break;
    start = source.startsWith("\r\n", end) ? end + 2 : end + 1;
  }

  return lines;
}
