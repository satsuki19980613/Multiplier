import numpy as np
from hands import *
E=np.load("hu_eq.npy"); W=np.load("W2.npy")
P=np.load("hu_P.npy");Q=np.load("hu_Q.npy");st=list(np.load("hu_stacks.npy"))
den=W.sum(1); wt=CN/1326
# ranking by equity vs random
eqr=(W*E).sum(1)/den
order=np.argsort(-eqr)   # best first
def band(width):
    v=np.zeros(169);cum=0
    for i in order:
        if cum+CN[i]<=width*1326+1e-9: v[i]=1;cum+=CN[i]
        else:
            v[i]=(width*1326-cum)/CN[i];break
    return v
def ev_sb(p,q,S): # SB total EV (chips) of pushing set p vs BB call q, fold=-0.5
    evp=((W*((1-q)[None,:]*1+q[None,:]*S*(2*E-1))).sum(1))/den
    return float((wt*(p*evp+(1-p)*(-0.5))).sum()),evp
def ev_bb(p,q,S):
    pj=(W*p[:,None]).sum(0)/den
    callev=((W*p[:,None]*(S*(2*E.T-1))).sum(0))/den
    fold=-1*pj
    return float((wt*(q*callev+(1-q)*fold+(1-pj)*0.5*0)).sum()) # excludes constant part when SB folds (indep of q)
print("S  | SB width Nash | SB loss(band same width) | +-5pts | BB width | BB loss band same | +-5pts   (mbb/hand, other side plays Nash)")
for S in [5,8,10,12,15,20]:
    n=st.index(S); p=P[n]; q=Q[n]
    base_sb,_=ev_sb(p,q,S); base_bb=ev_bb(p,q,S)
    wp=(p*CN).sum()/1326; wq=(q*CN).sum()/1326
    r=[]
    for d in (0,-0.05,0.05):
        r.append((base_sb-ev_sb(band(min(1,max(0,wp+d))),q,S)[0])*1000)
    r2=[]
    for d in (0,-0.05,0.05):
        r2.append((base_bb-ev_bb(p,band(min(1,max(0,wq+d))),S))*1000)
    print(f"{S:2d} | {wp*100:5.1f}% | {r[0]:6.1f} | {r[1]:6.1f}/{r[2]:6.1f} | {wq*100:5.1f}% | {r2[0]:6.1f} | {r2[1]:6.1f}/{r2[2]:6.1f}")
