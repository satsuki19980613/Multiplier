import numpy as np, json
from hu_nash import *
E=np.load("hu_eq.npy"); W=np.load("W2.npy")
res={}
for S in [9.5,12.5,15.5]:
    p,q,ps,qs,_=solve_hu(E,W,S,iters=8000)
    print(S,round(pct(ps,CN),1),round(pct(qs,CN),1))
stacks=[x*0.5 for x in range(2,61)]  # 1.0 .. 30.0
P=np.zeros((len(stacks),169)); Q=np.zeros((len(stacks),169))
for n,S in enumerate(stacks):
    p,q,ps,qs,_=solve_hu(E,W,S,iters=8000)
    P[n]=ps;Q[n]=qs
np.save("hu_P.npy",P);np.save("hu_Q.npy",Q);np.save("hu_stacks.npy",np.array(stacks))
def grid(prob):
    out=[]
    for r1 in range(12,-1,-1):
        row=[]
        for r2 in range(12,-1,-1):
            if r1==r2: n=RANKS[r1]*2
            elif r1>r2: n=RANKS[r1]+RANKS[r2]+'s'
            else: n=RANKS[r2]+RANKS[r1]+'o'
            v=prob[IDX[n]]
            row.append('#' if v>0.95 else ('+' if v>0.5 else ('-' if v>0.05 else '.')))
        out.append(''.join(row))
    return out
from hands import RANKS
for S in [5,10,15,20]:
    n=stacks.index(S)
    print("S=",S,"SB push (rows=high card A..2, cols; suited above diag) | BB call")
    a=grid(P[n]);b=grid(Q[n])
    hdr="   "+" ".join(RANKS[::-1])
    for r in range(13):
        print(RANKS[::-1][r],' '.join(a[r]),'   |  ',' '.join(b[r]))
