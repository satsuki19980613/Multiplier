"""Independent check of the 3-way payoff model: simulate real deals/boards/showdowns with generic side-pot logic"""
import numpy as np, numba as nb, sys, time
from hands import CB,CN,INFO
from evalnb import eval7
from nash3 import *

CLS=np.zeros((52,52),np.int64)
from hands import combos_of
for i in range(169):
    for (a,b) in combos_of(i):
        CLS[a,b]=i;CLS[b,a]=i

@nb.njit(cache=True)
def settle(stk,contrib,folded,scores):
    """generic side pot. returns net chips for 3 players. contrib[p]=total chips put in. folded[p]=True if folded."""
    net=np.zeros(3)
    for p in range(3): net[p]=-contrib[p]
    # levels
    done=np.zeros(3)  # amount of each contribution already distributed
    prev=0.0
    lv=np.sort(contrib.copy())
    for L in lv:
        if L<=prev: continue
        amt=0.0
        for p in range(3):
            amt+=min(contrib[p],L)-min(contrib[p],prev)
        # eligible: not folded and contrib>=L
        best=-1; nb_=0
        for p in range(3):
            if (not folded[p]) and contrib[p]>=L-1e-9:
                if scores[p]>best: best=scores[p]; nb_=1
                elif scores[p]==best: nb_+=1
        if nb_==0:
            # nobody eligible (all contributors to this layer folded): give to... shouldn't happen
            continue
        for p in range(3):
            if (not folded[p]) and contrib[p]>=L-1e-9 and scores[p]==best:
                net[p]+=amt/nb_
        prev=L
    return net

@nb.njit(parallel=True,cache=True)
def simulate(CB,CN,CLS,tB,tS,tK,a,sp,sc,b1,b2,b3,N,seed):
    nth=64
    acc=np.zeros((nth,3,169)); cnt=np.zeros((nth,3,169))
    for th in nb.prange(nth):
        np.random.seed(seed+th)
        for t in range(N//nth):
            used=np.zeros(52,np.int64)
            h=np.zeros((3,2),np.int64)
            for p in range(3):
                while True:
                    c0=np.random.randint(0,52);c1=np.random.randint(0,52)
                    if c0!=c1 and used[c0]==0 and used[c1]==0: break
                used[c0]=1;used[c1]=1;h[p,0]=c0;h[p,1]=c1
            board=np.zeros(5,np.int64);m=0
            while m<5:
                x=np.random.randint(0,52)
                if used[x]==0: used[x]=1;board[m]=x;m+=1
            cl=np.zeros(3,np.int64)
            for p in range(3): cl[p]=CLS[h[p,0],h[p,1]]
            sc_=np.zeros(3)
            for p in range(3):
                sc_[p]=eval7(h[p,0],h[p,1],board[0],board[1],board[2],board[3],board[4])
            contrib=np.zeros(3); contrib[1]=0.5; contrib[2]=1.0; folded=np.zeros(3,np.bool_)
            stk=np.zeros(3); stk[0]=tB; stk[1]=tS; stk[2]=tK
            r=np.random.random
            if r()<a[cl[0]]:
                contrib[0]=tB
                # SB
                if r()<sc[cl[1]]:
                    contrib[1]=tS
                    if r()<b3[cl[2]]: contrib[2]=tK
                    else: folded[2]=True
                else:
                    folded[1]=True
                    if r()<b2[cl[2]]: contrib[2]=tK
                    else: folded[2]=True
            else:
                folded[0]=True
                if r()<sp[cl[1]]:
                    contrib[1]=tS
                    if r()<b1[cl[2]]: contrib[2]=tK
                    else: folded[2]=True
                else:
                    folded[1]=True
            # cap contributions: an all-in call can't exceed what's needed, handled by layering (uncalled returned via single-eligible layer)
            net=settle(stk,contrib,folded,sc_)
            for p in range(3):
                acc[th,p,cl[p]]+=net[p]; cnt[th,p,cl[p]]+=1
    return acc.sum(0),cnt.sum(0)

def model_ev(G,x):
    a,sp,sc,b1,b2,b3=[x[k] for k in ['a','sp','sc','b1','b2','b3']]
    gB,gSp,gSc,gb1,gb2,gb3=G.gains(a,sp,sc,b1,b2,b3)
    W=G.WnK;o=G.one
    evB=a*gB
    evS=-0.5+sp*gSp+sc*gSc
    const=cs(W,0,(1-a)*(1-sp)*0.5-(1-a)*sp-a,1,o) if False else None
    # const_k = sum_ij W[i,j,k]*((1-a_i)(1-sp_j)*0.5 - (1-a_i)sp_j - a_i)
    wgt=np.outer((1-a),(1-sp))*0.5-np.outer((1-a),sp)-np.outer(a,np.ones(169))
    const=np.einsum('ijk,ij->k',W,wgt)
    evK=const+b1*gb1+b2*gb2+b3*gb3
    return evB,evS,evK

if __name__=="__main__":
    S=[float(v) for v in sys.argv[1:4]]
    T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
    G=Game3(T3,W3,E2,*S)
    d=np.load(f"nash3_{S[0]:g}_{S[1]:g}_{S[2]:g}.npz")
    x={k:d[k].astype(np.float64) for k in d.files}
    t=time.time()
    acc,cnt=simulate(CB,CN,CLS,S[0],S[1],S[2],x['a'],x['sp'],x['sc'],x['b1'],x['b2'],x['b3'],int(sys.argv[4]),1)
    print("sim time",time.time()-t)
    ev=model_ev(G,{k:v.astype(np.float32) for k,v in x.items()})
    wt=CN/1326
    for p,name in enumerate("BTN SB BB".split()):
        sim=acc[p]/np.maximum(cnt[p],1)
        m=ev[p]
        tot_sim=(acc[p].sum()/cnt[p].sum()); tot_mod=float((wt*m).sum())
        ok=cnt[p]>2000
        se=np.sqrt(((sim-m)**2*cnt[p])[ok].sum()/cnt[p][ok].sum())
        print(f"{name}: overall EV sim {tot_sim:+.4f} model {tot_mod:+.4f}; rms diff per-class(weighted) {se:.3f}  (classes counted {ok.sum()})")
