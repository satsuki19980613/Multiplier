import numpy as np
from hands import *
E=np.load("hu_eq.npy"); W=np.load("W2.npy")
P=np.load("hu_P.npy");Q=np.load("hu_Q.npy");st=list(np.load("hu_stacks.npy"))
den=W.sum(1); wt=CN/1326
def ev_sb(p,q,S):
    evp=((W*((1-q)[None,:]*1+q[None,:]*S*(2*E-1))).sum(1))/den
    return float((wt*(p*evp+(1-p)*(-0.5))).sum()),evp
def ev_bb(p,q,S):
    pj=(W*p[:,None]).sum(0)/den
    callev=((W*p[:,None]*(S*(2*E.T-1))).sum(0))/den
    return float((wt*(q*callev+(1-q)*(-pj))).sum())
def bandby(order,width):
    v=np.zeros(169);cum=0
    for i in order:
        if cum+CN[i]<=width*1326+1e-9: v[i]=1;cum+=CN[i]
        else: v[i]=(width*1326-cum)/CN[i];break
    return v
print("Loss (mbb/hand) vs Nash opponent when own range width is shifted by delta (ordering = exact Nash EV order)")
print("S  side   width |  -20   -10   -5    +5   +10   +20 (pts)")
for S in [8,10,15,20]:
    n=st.index(S);p=P[n];q=Q[n]
    base,evp=ev_sb(p,q,S); orderS=np.argsort(-(evp+0.5)) 
    wp=(p*CN).sum()/1326
    row=[]
    for d in (-.2,-.1,-.05,.05,.1,.2):
        row.append((base-ev_sb(bandby(orderS,np.clip(wp+d,0,1)),q,S)[0])*1000)
    print(f"{S:2d} SBpush {wp*100:4.1f}% | "+"  ".join(f"{x:5.1f}" for x in row))
    base=ev_bb(p,q,S)
    pj=(W*p[:,None]).sum(0)/den
    callev=((W*p[:,None]*(S*(2*E.T-1))).sum(0))/den
    orderK=np.argsort(-(callev+pj))
    wq=(q*CN).sum()/1326
    row=[]
    for d in (-.2,-.1,-.05,.05,.1,.2):
        row.append((base-ev_bb(p,bandby(orderK,np.clip(wq+d,0,1)),S))*1000)
    print(f"{S:2d} BBcall {wq*100:4.1f}% | "+"  ".join(f"{x:5.1f}" for x in row))
