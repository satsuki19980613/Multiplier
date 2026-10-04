import numpy as np
from hands import *
E=np.load("hu_eq.npy"); W=np.load("W2.npy")
P=np.load("hu_P.npy");Q=np.load("hu_Q.npy");st=list(np.load("hu_stacks.npy"))
den=W.sum(1); wt=CN/1326
sig=lambda z:1/(1+np.exp(-z))
print("Logit(softmax) noise: p = sigmoid(lambda*gain_bb); loss in mbb/hand vs Nash opp; also resulting range width")
for S in [10,15]:
    n=st.index(S);p=P[n];q=Q[n]
    evp=((W*((1-q)[None,:]*1+q[None,:]*S*(2*E-1))).sum(1))/den
    gS=evp+0.5
    pj=(W*p[:,None]).sum(0)/den
    callev=((W*p[:,None]*(S*(2*E.T-1))).sum(0))/den
    gK=(callev+pj)/np.maximum(pj,1e-9)   # per-hand gain conditional on facing a push (bb)
    gK_w=callev+pj                       # reach weighted
    for lam in [100,30,10,5,3,2,1]:
        ps=sig(lam*gS); 
        loss_sb=float((wt*(np.maximum(gS,0)-ps*gS)).sum())*1000
        qs=sig(lam*gK)
        loss_bb=float((wt*(np.maximum(gK_w,0)-qs*gK_w)).sum())*1000
        print(f"S={S} lambda={lam:3d}/bb: SB width {(ps*CN).sum()/13.26:5.1f}% loss {loss_sb:6.2f} | BB width {(qs*CN).sum()/13.26:5.1f}% loss {loss_bb:6.2f}")
