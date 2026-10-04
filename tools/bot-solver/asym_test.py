import numpy as np
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
eq={s:np.load(f"nash3_{s}_{s}_{s}.npz") for s in range(2,26)}
def table(node,s):
    s=min(25,max(2,s));lo=int(np.floor(s));hi=min(25,lo+1);t=s-lo
    return ((1-t)*eq[lo][node]+t*eq[hi][node]).astype(np.float32)
nodes=['a','sp','sc','b1','b2','b3']
rule={'a':lambda B,S,K:(min(B,S)+min(B,K))/2,'sp':lambda B,S,K:min(S,K),'sc':lambda B,S,K:min(B,S),'b1':lambda B,S,K:min(S,K),'b2':lambda B,S,K:min(B,K),'b3':lambda B,S,K:min(K,(B+S)/2)}
naive={n:(lambda B,S,K:(B+S+K)/3) for n in nodes}
held=[(20,6,9),(7,14,18),(10,10,4),(6,6,15),(18,9,12),(4,9,20)]
print("HELD-OUT configs: total node-wise loss (mbb/hand, sum over 6 nodes) | node rule vs naive mean-stack | per-node (rule)")
for cfg in held:
    G=Game3(T3,W3,E2,*cfg)
    d=np.load(f"nash3_{cfg[0]}_{cfg[1]}_{cfg[2]}.npz"); x={k:d[k] for k in nodes}
    g=G.gains(*[x[k] for k in nodes])
    L=[];N=[]
    for k,gi in zip(nodes,g):
        base=float((G.wt*x[k]*gi).sum())
        L.append(1000*(base-float((G.wt*table(k,rule[k](*cfg))*gi).sum())))
        N.append(1000*(base-float((G.wt*table(k,naive[k](*cfg))*gi).sum())))
    print(cfg,f"rule {sum(L):6.1f}  naive {sum(N):6.1f} |", " ".join(f"{k}:{v:.1f}" for k,v in zip(nodes,L)))
