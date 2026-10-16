import {afterEach,describe,it,expect,vi} from 'vitest';
import {Harness,MemoryStorage,createRegistry} from '@earendil-works/pi-durable';
import {createModels,fauxProvider} from '@earendil-works/pi-ai';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createEmptySessionSnapshot} from '$lib/features/notepad/session/session';
import {createNoteDraftState} from '$lib/features/notepad/state/noteStore';
import {createReviewEditorForTest} from '$lib/features/proposals/proposalEditorTestSupport';
import {documentRegistry} from '$lib/features/notepad/document/documentRegistry';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
import {Review,reviewExtension,stageReview,readReview,checkpointReview} from './reviews';
import {acknowledgedProbeDraft} from './probeReview';

afterEach(()=>{
  native.invoke.mockReset();
  for(const runtime of [...documentRegistry.values()]) {
    const editor=runtime.resources()?.runtime;if(editor?.review)editor.endReview(editor.review.reviewId);
    documentRegistry.dispose(runtime.documentHandle);
  }
});
describe('failure probe checkpoint baseline',()=>{
  it('waits for mounted hunk acknowledgement before distinguishing a failed human edit',async()=>{
    const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
    native.invoke.mockImplementation(async command=>{if(command==='pi_validate_review_checkpoint'){entered.resolve();await gate.promise;return;}throw new Error(`Unexpected ${command}`);});
    const registry=createRegistry();registry.install(reviewExtension(async()=> 'full',()=> 'answer-1'));
    const models=createModels();models.setProvider(fauxProvider().provider);
    const harness=await Harness.open(new MemoryStorage(),{models,registry},context);
    const document=createNoteDraftState({...createEmptySessionSnapshot(),title:'Plan'}),editor=createReviewEditorForTest(document);
    let mounting:Promise<unknown>|undefined;
    try {
      const conversation=await harness.root(context);let taskId=0;
      await harness.commit(async tx=>{taskId=await stageReview(tx,conversation.id,{kind:'create',noteId:null,title:'Plan',baseHash:null,suggestedPath:'/vault/Plan.md',preview:{reviewId:'preview'},payload:{markdown:'original',title:'Plan'}},'answer-1','origin');},context);
      const id=`pi-review-${taskId}`,initial=(await readReview(harness,id)).draft;
      editor.runtime.beginReview({reviewId:'preview',notePath:initial.path,title:'Plan',baseContentHash:'',baseEditorMarkdown:'',proposedEditorMarkdown:'original',hunks:[{
        id:'creation',baseFrom:0,baseTo:0,proposedFrom:0,proposedTo:8,oldText:'',newText:'original'
      }]},{onKeep:()=>{},onUndo:()=>{},onChange:()=>{},onMarkdownChange:()=>{}},initial);
      const working=()=>({markdown:editor.markdown,decisions:editor.review!.hunks});
      expect(initial.decisions).toEqual([]);expect(working().decisions).toHaveLength(1);
      mounting=checkpointReview(harness,id,{...initial,...working()},undefined,'full');await entered.promise;
      const until=async<V>(read:()=>V|Promise<V>,label:string):Promise<NonNullable<V>>=>{
        for(let poll=0;poll<3;poll++){const value=await read();if(value)return value as NonNullable<V>;if(poll===0){gate.resolve();await mounting;}}
        throw new Error(`deadline: ${label}`);
      };
      const baseline=await acknowledgedProbeDraft({draft:async()=>(await readReview(harness,id)).draft,working,until});
      expect(baseline.version).toBe(2);expect(baseline.decisions).toEqual(working().decisions);expect(baseline.markdown).toBe(initial.markdown);
      await harness.commit(async tx=>{(await tx.doc(Review,String(taskId),'')).fault='checkpoint';},context);
      editor.view.dispatch({changes:{from:0,to:editor.view.state.doc.length,insert:'unacknowledged human bytes'},userEvent:'input.type'});
      await expect(checkpointReview(harness,id,{...baseline,...working()},undefined,'full')).rejects.toThrow('checkpoint persistence failure');
      expect((await readReview(harness,id)).draft).toEqual(baseline);expect(editor.markdown).toBe('unacknowledged human bytes');
    } finally {gate.resolve();await mounting;editor.dispose();await harness.close(context);}
  });
});
