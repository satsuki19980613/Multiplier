// Private tables (2026-10-08 さつき「バイインを選んで部屋を作り、部屋番号を共有できるように」): a host picks a stake and gets a 6-digit
// room code (and an invite URL /?room=123456). Friends join by the code. Three players start the table at once; with two, the host may
// start it and the empty seat goes to a bot. Buy-in and prize are the same as PLAY (the balance moves).
// Pure functions only (no I/O, `now` / `rnd` come in) so fakeNet can run them in the browser. docs/ARCHITECTURE.md §6.
//
// room = { id, code, stake, host: uid, members: [{ uid, name, seenAt, fx }] (join order, the host first; fx = the member's winner GIF slug | null),
//          status: 'waiting' | 'started' | 'closed', game: id | null, createdAt }
import{MoveError,STAKE_KEYS}from'./rules.js';
import{normalizeFx}from'../../src/fx.js';

export const ROOM_SEATS=3,ROOM_MIN_START=2;
/** The lobby polls every ROOM_POLL_MS. A member whose last poll is older than ROOM_AWAY_MS is away (e.g. sharing the invite in another
 *  app: phones suspend the page): the table does not start until everybody is back. Older than ROOM_GONE_MS, the member has left
 *  (the host leaving closes the room). */
export const ROOM_POLL_MS=2000,ROOM_AWAY_MS=8000,ROOM_GONE_MS=120000;
/** a room that has not started within this time is closed */
export const ROOM_TTL_MS=10*60*1000;
export const CODE_RE=/^\d{6}$/;
// the free-roll has its own rules (balance under 10, 3 a day): private tables are for the paid stakes only
export const ROOM_STAKES=STAKE_KEYS.filter(k=>k!=='free');

/** a random 6-digit room code ('000000'..'999999') */
export const genCode=rnd=>String(Math.floor(rnd()*1e6)%1e6).padStart(6,'0');

export function newRoom({id,code,stake,uid,name,now,fx=null}){
  if(!ROOM_STAKES.includes(stake))throw new MoveError('illegal');
  return{id,code,stake,host:uid,members:[{uid,name,seenAt:now,fx:normalizeFx(fx)}],status:'waiting',game:null,createdAt:now};
}

const clone=x=>structuredClone(x);
export const expiresAt=room=>room.createdAt+ROOM_TTL_MS;
export const isMember=(room,uid)=>room.members.some(m=>m.uid===uid);

export const isAway=(m,now)=>now-m.seenAt>=ROOM_AWAY_MS;

/** Drop members who stopped polling; close the room when it expired or the host is gone. Returns a new room. */
export function prune(room,now){
  const r=clone(room);
  if(r.status!=='waiting')return r;
  if(now>=expiresAt(r)){r.status='closed';return r}
  r.members=r.members.filter(m=>now-m.seenAt<ROOM_GONE_MS);
  if(!isMember(r,r.host))r.status='closed';
  return r;
}

/** Join (or, already a member, just refresh). fx = the member's winner GIF (undefined keeps it). Throws room_closed | room_full. Returns a new room. */
export function joinRoom(room,uid,name,now,fx){
  const r=prune(room,now);
  if(r.status!=='waiting')throw new MoveError('room_closed');
  const m=r.members.find(x=>x.uid===uid);
  if(m){m.seenAt=now;m.name=name;if(fx!==undefined)m.fx=normalizeFx(fx);return r}
  if(r.members.length>=ROOM_SEATS)throw new MoveError('room_full');
  r.members.push({uid,name,seenAt:now,fx:normalizeFx(fx??null)});
  return r;
}

/** the humans of the table a room starts: [{ uid, name, fx, host }] (names from `nameOf(uid)`, e.g. the current nicknames) */
export const roomHumans=(room,nameOf=null)=>room.members.map(m=>({uid:m.uid,name:nameOf?nameOf(m.uid):m.name,fx:m.fx??null,host:m.uid===room.host}));

/** A member's poll in the lobby. Throws not_found when the caller is no longer in the room (left, dropped, or the room closed
 *  before they were seated). A started room answers its members as is. Returns a new room. */
export function touchRoom(room,uid,now){
  const r=prune(room,now);
  if(!isMember(r,uid))throw new MoveError('not_found');
  if(r.status==='waiting')r.members.find(m=>m.uid===uid).seenAt=now;
  return r;
}

/** Leave the lobby. The host leaving closes the room. Returns a new room (a started room is not changed). */
export function leaveRoom(room,uid,now){
  const r=prune(room,now);
  if(r.status!=='waiting')return r;
  if(uid===r.host)r.status='closed';
  else r.members=r.members.filter(m=>m.uid!==uid);
  return r;
}

/** Can the table start now? Everybody in the room must be present (not away). auto: a full room starts by itself (=> bool);
 *  otherwise the host asks (throws not_host / not_enough / away). */
export function startReady(room,uid,now,{auto=false}={}){
  if(room.status!=='waiting')throw new MoveError('room_closed');
  const here=!room.members.some(m=>isAway(m,now));
  if(auto)return room.members.length>=ROOM_SEATS&&here;
  if(uid!==room.host)throw new MoveError('not_host');
  if(room.members.length<ROOM_MIN_START)throw new MoveError('not_enough');
  if(!here)throw new MoveError('away');
  return true;
}

/** what a member sees in the lobby */
export function roomView(room,uid,now){
  return{
    id:room.id,code:room.code,stake:room.stake,status:room.status,
    host:room.members.find(m=>m.uid===room.host)?.name??null,
    members:room.members.map(m=>({name:m.name,host:m.uid===room.host,me:m.uid===uid,away:isAway(m,now)})),
    seats:ROOM_SEATS,isHost:uid===room.host,expiresAt:expiresAt(room),
    game:room.status==='started'&&isMember(room,uid)?room.game:null,
  };
}

/** what anybody with the code sees before joining (no uids) */
export function roomPeek(room,uid,now){
  const r=prune(room,now);
  return{code:r.code,stake:r.stake,status:r.status,host:r.members.find(m=>m.uid===r.host)?.name??null,
    seated:r.members.length,seats:ROOM_SEATS,member:isMember(r,uid)};
}
