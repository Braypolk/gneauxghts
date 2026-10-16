import {expect,it} from 'vitest';
import {fauxAssistantMessage} from '@earendil-works/pi-ai/providers/faux';
import {createTextProjection} from './streamProjection';

it('projects initial whole text, block insertions and suffix deltas once',()=>{
  const project=createTextProjection();
  expect(project({type:'message_start',message:fauxAssistantMessage('First')})).toEqual({type:'delta',delta:'First'});
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'text_start',contentIndex:0,block:{type:'text',text:'First'}}]})).toBeUndefined();
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'text_delta',contentIndex:0,delta:' point'},{type:'text_start',contentIndex:1,block:{type:'text',text:'.'}}]})).toEqual({type:'delta',delta:' point.'});
});

it('replaces or resets text with ordered snapshots and keeps later appends in that channel',()=>{
  const project=createTextProjection();project({type:'message_start',message:fauxAssistantMessage('Old')});
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'block',contentIndex:0,block:{type:'text',text:'New'}}]})).toEqual({type:'draft',attempt:1,sequence:1,content:'New'});
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'message',message:fauxAssistantMessage('New text')}]})).toEqual({type:'draft',attempt:1,sequence:2,content:'New text'});
  expect(project({type:'message_start',message:fauxAssistantMessage('')})).toEqual({type:'draft',attempt:1,sequence:3,content:''});
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'text_delta',contentIndex:0,delta:'Next'}]})).toEqual({type:'draft',attempt:1,sequence:4,content:'Next'});
});

it('recovers overflow snapshots and excludes nontext blocks',()=>{
  const project=createTextProjection();
  expect(project({type:'message_start',message:fauxAssistantMessage([{type:'thinking',thinking:'private'},{type:'toolCall',id:'t',name:'read',arguments:{}}])})).toBeUndefined();
  expect(project({type:'message_update',usage:fauxAssistantMessage('').usage,changes:[{type:'thinking_delta',contentIndex:0,delta:'secret'},{type:'block',contentIndex:1,block:{type:'text',text:'Public'}}]})).toEqual({type:'delta',delta:'Public'});
  expect(project({type:'snapshot',generation:{attempt:1,message:fauxAssistantMessage('Recovered')},entries:[],tools:[],nestedTools:[],compactions:[],inbox:[],agent:{},usage:{models:{},tools:{}}})).toEqual({type:'draft',attempt:1,sequence:1,content:'Recovered'});
});
