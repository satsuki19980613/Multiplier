// JS 7-card evaluator + Monte Carlo equity benchmark (Node.js)
const cnt=new Int32Array(13), sm=new Int32Array(4), sc=new Int32Array(4);
function straightHigh(mask){
  for(let hi=12;hi>=4;hi--){const m=0x1F<<(hi-4); if((mask&m)===m) return hi;}
  if((mask&0x100F)===0x100F) return 3; return -1;
}
function top5(mask){let v=0,n=0;for(let r=12;r>=0;r--){if(mask>>r&1){v=v*13+r;if(++n===5)break;}}return v;}
function eval7(c){ // c: Int32Array(7) of 0..51, rank=c>>2
  cnt.fill(0);sm.fill(0);sc.fill(0);
  for(let i=0;i<7;i++){const r=c[i]>>2,s=c[i]&3;cnt[r]++;sm[s]|=1<<r;sc[s]++;}
  for(let s=0;s<4;s++) if(sc[s]>=5){const sh=straightHigh(sm[s]); if(sh>=0) return 8e7+sh; return 5e7+top5(sm[s]);}
  let quad=-1,t0=-1,t1=-1,nt=0,p0=-1,p1=-1,np=0,mask=0;
  for(let r=12;r>=0;r--){const k=cnt[r]; if(k>0)mask|=1<<r;
    if(k===4)quad=r; else if(k===3){if(nt===0)t0=r;else if(nt===1)t1=r;nt++;}
    else if(k===2){if(np===0)p0=r;else if(np===1)p1=r;np++;}}
  if(quad>=0){let kick=-1;for(let r=12;r>=0;r--)if(cnt[r]>0&&r!==quad){kick=r;break;}return 7e7+quad*13+kick;}
  if(nt>=1&&(nt>=2||np>=1)){let p=nt>=2?t1:-1;if(np>=1&&p0>p)p=p0;return 6e7+t0*13+p;}
  const sh=straightHigh(mask); if(sh>=0) return 4e7+sh;
  if(nt===1){let v=t0,n=0;for(let r=12;r>=0;r--)if(cnt[r]>0&&r!==t0){v=v*13+r;if(++n===2)break;}return 3e7+v;}
  if(np>=2){let v=p0*13+p1;for(let r=12;r>=0;r--)if(cnt[r]>0&&r!==p0&&r!==p1){v=v*13+r;break;}return 2e7+v;}
  if(np===1){let v=p0,n=0;for(let r=12;r>=0;r--)if(cnt[r]>0&&r!==p0){v=v*13+r;if(++n===3)break;}return 1e7+v;}
  return top5(mask);
}
// xorshift rng
let st=123456789; function rnd(){st^=st<<13;st^=st>>>17;st^=st<<5;return (st>>>0)/4294967296;}
function equityVsRandom(h0,h1,N){
  const used=new Uint8Array(52),a=new Int32Array(7),b=new Int32Array(7);let w=0;
  for(let t=0;t<N;t++){
    used.fill(0);used[h0]=1;used[h1]=1;const d=[];
    // draw 7 distinct cards: 2 opp + 5 board
    let k=0;while(k<7){const x=(rnd()*52)|0;if(!used[x]){used[x]=1;d.push(x);k++;}}
    a[0]=h0;a[1]=h1;b[0]=d[0];b[1]=d[1];for(let i=0;i<5;i++){a[2+i]=d[2+i];b[2+i]=d[2+i];}
    const s1=eval7(a),s2=eval7(b); w+=s1>s2?1:(s1===s2?0.5:0);
  }return w/N;
}
let t=process.hrtime.bigint();
const N=1000000; const e=equityVsRandom(12*4+0,11*4+0,N); // AKs
const ms=Number(process.hrtime.bigint()-t)/1e6;
console.log("AKs vs random equity",e.toFixed(4),"; ",N,"deals (2 evals each) in",ms.toFixed(0),"ms =>",(N*2/ms/1000).toFixed(2),"M evals/s");
