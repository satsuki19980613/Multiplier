// STUB (replaced by the bot workstream, see docs/ARCHITECTURE.md §5): a legal but simple player so the server and UI can run.
import{legalActions}from'./engine.js';

export const PERSONAS=['tight','loose','aggro'];

export function botMove(view,seat,{rnd=Math.random}={}){
  const l=legalActions(view);
  if(!l||l.seat!==seat)throw new Error('bot: not my turn');
  if(l.canCheck)return{type:'check'};
  if(l.canCall&&rnd()<0.6)return{type:'call'};
  return{type:'fold'};
}
