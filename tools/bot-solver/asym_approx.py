import numpy as np
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
eq={s:np.load(f"nash3_{s}_{s}_{s}.npz") for s in range(2,26)}
def table(node,s):
    lo=int(np.floor(s));hi=min(25,lo+1);lo=max(2,min(lo,25));t=s-lo
    return ((1-t)*eq[lo][node]+t*eq[hi][node]).astype(np.float32)
nodes=['a','sp','sc','b1','b2','b3']; pos={'a':0,'sp':1,'sc':1,'b1':2,'b2':2,'b3':2}
print("loss (mbb/hand, node-wise, others at asymmetric Nash) when using equal-stack table at stack = own / mean / min / max of the 3 stacks")
for cfg in [(12,8,5),(5,12,8),(8,5,12),(15,10,6)]:
    G=Game3(T3,W3,E2,*cfg)
    d=np.load(f"nash3_{cfg[0]}_{cfg[1]}_{cfg[2]}.npz"); x={k:d[k] for k in nodes}
    g=G.gains(*[x[k] for k in nodes])
    tot={m:0.0 for m in ['own','mean','min','max']}
    for k,gi in zip(nodes,g):
        base=float((G.wt*x[k]*gi).sum())
        row=[]
        for m in tot:
            s={'own':cfg[pos[k]],'mean':sum(cfg)/3,'min':min(cfg),'max':max(cfg)}[m]
            ev=float((G.wt*table(k,s)*gi).sum())
            loss=1000*(base-ev); tot[m]+=loss; row.append(f"{m}:{loss:6.1f}")
        print(cfg,k," ".join(row))
    print(cfg,"TOTAL"," ".join(f"{m}:{v:6.1f}" for m,v in tot.items()))

print("\n=== node-specific effective-stack rules ===")
rules={
 'a':{'min3':lambda B,S,K:min(B,S,K),'min(B,max(S,K))':lambda B,S,K:min(B,max(S,K)),'mean(min(B,S),min(B,K))':lambda B,S,K:(min(B,S)+min(B,K))/2,'B':lambda B,S,K:B},
 'sp':{'min(S,K)':lambda B,S,K:min(S,K),'S':lambda B,S,K:S},
 'sc':{'min(B,S)':lambda B,S,K:min(B,S),'min3':lambda B,S,K:min(B,S,K),'S':lambda B,S,K:S},
 'b1':{'min(S,K)':lambda B,S,K:min(S,K),'K':lambda B,S,K:K},
 'b2':{'min(B,K)':lambda B,S,K:min(B,K),'K':lambda B,S,K:K},
 'b3':{'min3':lambda B,S,K:min(B,S,K),'min(K,mean(others))':lambda B,S,K:min(K,(B+S)/2),'K':lambda B,S,K:K,'min(B,S,K) avg w/ K':lambda B,S,K:(min(B,S,K)+K)/2},
}
res={n:{r:0.0 for r in rules[n]} for n in rules}
for cfg in [(12,8,5),(5,12,8),(8,5,12),(15,10,6)]:
    G=Game3(T3,W3,E2,*cfg)
    d=np.load(f"nash3_{cfg[0]}_{cfg[1]}_{cfg[2]}.npz"); x={k:d[k] for k in nodes}
    g=G.gains(*[x[k] for k in nodes])
    for k,gi in zip(nodes,g):
        base=float((G.wt*x[k]*gi).sum())
        for r,f in rules[k].items():
            s=min(25,max(2,f(*cfg)))
            res[k][r]+=1000*(base-float((G.wt*table(k,s)*gi).sum()))
for k in rules: print(k,{r:round(v/4,1) for r,v in res[k].items()},"(avg over 4 configs, mbb/hand)")
