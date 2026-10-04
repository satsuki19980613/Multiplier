import numpy as np, sys
from nash3 import *
from hands import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy"); W2=np.load("W2.npy")
S=[float(v) for v in sys.argv[1:4]]
G=Game3(T3,W3,E2,*S)
d=np.load(f"nash3_{S[0]:g}_{S[1]:g}_{S[2]:g}.npz"); x={k:d[k] for k in d.files}
eqr=(W2*E2).sum(1)/W2.sum(1); order=np.argsort(-eqr)
def band(width):
    v=np.zeros(169,np.float32);cum=0
    for i in order:
        if cum+CN[i]<=width*1326+1e-9: v[i]=1;cum+=CN[i]
        else: v[i]=(width*1326-cum)/CN[i];break
    return v
wt=G.wt
g=G.gains(*[x[k] for k in ['a','sp','sc','b1','b2','b3']])
names=['a','sp','sc','b1','b2','b3']
print("node: Nash width | reach-weighted EV loss (mbb/hand) if replaced by equity-rank band of same width (others Nash)")
tot={}
for nme,gi in zip(names,g):
    nsh=x[nme]; w=pct(nsh)/100
    # EV of node strategy = sum wt * strat * gain
    base=float((wt*nsh*gi).sum()); best=float((wt*np.maximum(gi,0)).sum())
    b=band(w); ev=float((wt*b*gi).sum())
    print(f"{nme:3s}: {w*100:5.1f}%  loss band {1000*(base-ev):7.2f}   (Nash node value {1000*base:.1f}; BR slack {1000*(best-base):.2f})")
