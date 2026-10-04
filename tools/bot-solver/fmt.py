import numpy as np
from hands import *
R=RANKS
def compress(prob,thr=0.5,mixlo=0.1):
    parts=[]
    inr=lambda n:prob[IDX[n]]>=thr
    # pairs
    pr=[r for r in range(12,-1,-1) if inr(R[r]*2)]
    if pr:
        # contiguous runs
        runs=[];s=pr[0];prev=pr[0]
        for r in pr[1:]:
            if r==prev-1: prev=r
            else: runs.append((s,prev));s=r;prev=r
        runs.append((s,prev))
        for a,b in runs:
            if a==b: parts.append(R[a]*2)
            elif a==12: parts.append(R[b]*2+"+")
            else: parts.append(R[a]*2+"-"+R[b]*2)
    for suf in ("s","o"):
        for hi in range(12,0,-1):
            ks=[k for k in range(hi-1,-1,-1) if inr(R[hi]+R[k]+suf)]
            if not ks: continue
            runs=[];s=ks[0];prev=ks[0]
            for k in ks[1:]:
                if k==prev-1: prev=k
                else: runs.append((s,prev));s=k;prev=k
            runs.append((s,prev))
            for a,b in runs:
                top=R[hi]+R[a]+suf;bot=R[hi]+R[b]+suf
                if a==b: parts.append(top)
                elif a==hi-1: parts.append(bot+"+")
                else: parts.append(top+"-"+bot)
    mixed=[f"{NAMES[i]}:{prob[i]:.2f}" for i in range(169) if mixlo<=prob[i]<thr]
    mixed2=[f"{NAMES[i]}:{prob[i]:.2f}" for i in range(169) if thr<=prob[i]<0.9]
    return ", ".join(parts),mixed+mixed2
if __name__=="__main__":
    P=np.load("hu_P.npy");Q=np.load("hu_Q.npy");st=list(np.load("hu_stacks.npy"))
    for S in [8,10,12,15,20]:
        n=st.index(S)
        a,m=compress(P[n]);b,m2=compress(Q[n])
        print(f"== HU {S}bb  SB push ({(P[n]*CN).sum()/13.26:.1f}%): {a}  mixed:{m}")
        print(f"   BB call ({(Q[n]*CN).sum()/13.26:.1f}%): {b}  mixed:{m2}")
