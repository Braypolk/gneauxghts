import { Annotation, StateGraph, START, END, Command, MemorySaver, interrupt } from '@langchain/langgraph/web';

// Research fixture only. Serializing MemorySaver internals is NOT a production
// checkpointer; it tests browser loading and interrupt replay across reload.
class ReloadSaver extends MemorySaver {
  constructor() {
    super();
    const saved = localStorage.getItem('checkpoints');
    if (saved) Object.assign(this, JSON.parse(saved, (_, value) =>
      value && value.__bytes ? new Uint8Array(value.__bytes) : value));
  }
  flush() {
    localStorage.setItem('checkpoints', JSON.stringify({ storage: this.storage, writes: this.writes },
      (_, value) => value instanceof Uint8Array ? { __bytes: [...value] } : value));
  }
  async put(...args) { const value = await super.put(...args); this.flush(); return value; }
  async putWrites(...args) { await super.putWrites(...args); this.flush(); }
}
const State = Annotation.Root({ draft: Annotation(), decision: Annotation(), receipt: Annotation() });
const staticMode = new URLSearchParams(location.search).has('static');
const graph = new StateGraph(State)
  .addNode('review', (state) => staticMode ? { draft: state.draft } : { decision: interrupt({ draft: state.draft }) })
  .addNode('commit', (state) => {
    if (!state.decision.approved) return { receipt: 'rejected' };
    // Simulates the native mutation service's receipt deduplication.
    const key = 'receipt:' + state.decision.intentId;
    let receipt = localStorage.getItem(key);
    if (!receipt) {
      receipt = state.decision.body;
      localStorage.setItem(key, receipt);
      localStorage.setItem('effects', String(Number(localStorage.getItem('effects') || 0) + 1));
    }
    return { draft: state.decision.body, receipt };
  })
  .addEdge(START, 'review').addEdge('review', 'commit').addEdge('commit', END)
  .compile({ checkpointer: new ReloadSaver(), ...(staticMode ? { interruptBefore: ['commit'] } : {}) });
window.probe = {
  start: (id) => graph.invoke({ draft: 'model draft' }, { configurable: { thread_id: id }, durability: 'sync' }),
  state: (id) => graph.getState({ configurable: { thread_id: id } }),
  resume: async (id, approved) => {
    const config = { configurable: { thread_id: id }, durability: 'sync' };
    const decision = { approved, body: 'human edited draft', intentId: id };
    if (staticMode) {
      await graph.updateState(config, { decision });
      return graph.invoke(null, config);
    }
    return graph.invoke(new Command({ resume: decision }), config);
  },
};
