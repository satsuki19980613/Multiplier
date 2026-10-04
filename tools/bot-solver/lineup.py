import numpy as np, itertools
from nash3 import *
from sim_check import model_ev
from hands import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy"); W2=np.load("W2.npy")
S=10
G=Game3(T3,W3,E2,S,S,S)
nodes=['a','sp','sc','b1','b2','b3']
d=np.load("nash3_10_10_10.npz"); nash={k:d[k].astype(np.float32) for k in nodes}
eqr=(W2*E2).sum(1)/W2.sum(1); order=np.argsort(-eqr)
def band(width):
    v=np.zeros(169,np.float32);cum=0
    for i in order:
        if cum+CN[i]<=width*1326+1e-9: v[i]=1;cum+=CN[i]
        else: v[i]=(width*1326-cum)/CN[i];break
    return v
def shifted(delta):   # every node's width shifted by delta (points), equity-rank bands
    return {k:band(np.clip(pct(nash[k])/100+delta,0,1)) for k in nodes}
def bandnash():       # equity-rank band, same widths as Nash
    return shifted(0.0)
def allpush(): return {k:np.ones(169,np.float32) for k in nodes}
def tightbot(): # "never calls/pushes except top 15%"
    return {k:band(0.15) for k in nodes}
bots={'Nash':nash,'RankBand(=Nash width)':bandnash(),'Loose +10pt':shifted(.10),'Tight -10pt':shifted(-.10),'Tight -20pt':shifted(-.20),'Loose +20pt':shifted(.20),'AlwaysPush/Call':allpush(),'Top15% only':tightbot()}
def seat_ev(sb,ss,sk):   # strategies for BTN,SB,BB seats -> EV of each seat (bb/hand)
    x={'a':sb['a'],'sp':ss['sp'],'sc':ss['sc'],'b1':sk['b1'],'b2':sk['b2'],'b3':sk['b3']}
    evB,evS,evK=model_ev(G,x)
    wt=G.wt
    return float((wt*evB).sum()),float((wt*evS).sum()),float((wt*evK).sum())
def table_ev(p1,p2,p3):  # players 1,2,3 rotate seats; returns avg EV per player
    ps=[p1,p2,p3]; tot=np.zeros(3)
    for rot in range(3):
        seats=[ps[(rot+i)%3] for i in range(3)]
        e=seat_ev(*seats)
        for i in range(3): tot[(rot+i)%3]+=e[i]/3
    return tot
print("hero strategy vs two identical opponents (3-way, 10bb equal stacks, seats rotate each hand) : hero EV bb/hand (opps get -half each)")
for name in bots:
    for opp in ['Nash','Loose +10pt','Tight -10pt']:
        if name==opp: continue
        e=table_ev(bots[name],bots[opp],bots[opp])
        print(f"{name:24s} vs 2x{opp:12s}: hero {e[0]:+.4f}  opp {e[1]:+.4f}")
