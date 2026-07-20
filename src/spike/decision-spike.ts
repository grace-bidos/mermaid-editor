/**
 * Decision Spikeの表示とJSON出力で共有する、Framework-independentなschemaです。
 *
 * 新しいSpikeでは、このschemaへGroup、Topic、Optionを追加し、Prototypeだけを
 * 個別実装します。選択UIやJSON serializerを作り直す必要はありません。
 */
export interface DecisionOption<Prototype extends string = string> {
  id: string;
  label: string;
  summary: string;
  prototype: Prototype;
  recommended?: boolean;
}

export interface DecisionTopic<Prototype extends string = string> {
  id: string;
  title: string;
  question: string;
  options: readonly DecisionOption<Prototype>[];
}

export interface DecisionGroup<Prototype extends string = string> {
  id: string;
  title: string;
  summary: string;
  topics: readonly DecisionTopic<Prototype>[];
}

export interface DecisionState {
  selections: Record<string, string | null>;
  notes: Record<string, string>;
}

/** Group階層から、進捗計算やserializerで使うTopic列を取り出します。 */
export function flattenDecisionTopics<Prototype extends string>(
  groups: readonly DecisionGroup<Prototype>[],
): readonly DecisionTopic<Prototype>[] {
  return groups.flatMap((group) => group.topics);
}

/** Topic数に依存しない空の選択Stateを生成します。 */
export function createDecisionState<Prototype extends string>(
  groups: readonly DecisionGroup<Prototype>[],
): DecisionState {
  const topics = flattenDecisionTopics(groups);
  return {
    selections: Object.fromEntries(topics.map((topic) => [topic.id, null])),
    notes: Object.fromEntries(topics.map((topic) => [topic.id, ""])),
  };
}

/**
 * Spikeの選択結果をAgentへ渡せるplain objectへ変換します。
 *
 * 未選択のTopicも`null`で残すため、Agentは未決事項を推測せず確認できます。
 */
export function serializeDecisionGroups<Prototype extends string>(
  groups: readonly DecisionGroup<Prototype>[],
  state: DecisionState,
): readonly object[] {
  return groups.map((group) => ({
    group: group.id,
    title: group.title,
    decisions: group.topics.map((topic) => {
      const selectedId = state.selections[topic.id];
      const selected = topic.options.find((option) => option.id === selectedId);
      return {
        topic: topic.id,
        selectedOption: selected ? { id: selected.id, label: selected.label } : null,
        note: state.notes[topic.id]?.trim() || null,
      };
    }),
  }));
}
