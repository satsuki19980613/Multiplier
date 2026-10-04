"""3-handed (BTN/SB/BB) push-or-fold Nash (chipEV) by fictitious play over 169 hand classes.
Players: B=BTN (posts 0), S=SB (0.5), K=BB (1).  Stacks tB,tS,tK are TOTAL stacks in bb (before posting).
Tree: BTN push/fold -> if fold: SB push/fold -> BB call/fold.  if push: SB call/fold -> BB call/fold.
Strategy vectors (prob of 'aggressive/continue' per hand class):
 a  : BTN push                 sp : SB push (BTN folded)       sc : SB call (BTN pushed)
 b1 : BB call vs SB push       b2 : BB call vs BTN push (SB folded)   b3 : BB call vs BTN push + SB call
"""
import numpy as np, sys, time, json
from hands import CN, NAMES, IDX

def cs(X,ua,u,ub,v):
    """contract X[i,j,k] along axes ua(with vector u) and ub(with vector v); returns vector along remaining axis"""
    # move: tensordot over ua, then the remaining 2D contracted with v
    Y=np.tensordot(X,u,axes=([ua],[0]))   # axes left in order
    rem=[ax for ax in range(3) if ax!=ua]
    axb=rem.index(ub)
    return np.tensordot(Y,v,axes=([axb],[0]))

class Game3:
    def __init__(s,T3,W3,E2,tB,tS,tK):
        f=np.float32
        s.tB,s.tS,s.tK=tB,tS,tK
        D=W3.sum((1,2)).astype(np.float64)   # symmetric
        Wn=(W3/D[:,None,None]).astype(f)     # BTN hero: P(j,k | i)
        WnS=(W3/D[None,:,None]).astype(f)    # SB hero:  P(i,k | j)
        WnK=(W3/D[None,None,:]).astype(f)    # BB hero:  P(i,j | k)
        s.Wn=Wn; s.WnS=WnS; s.WnK=WnK
        TB=T3; TS=T3.transpose(1,0,2); TK=T3.transpose(1,2,0)
        E=E2.astype(f)
        # --- terminal payoffs (net chips) ---
        # T1: BTN folded, SB push, BB call: HU S vs K, tensors over [j,k]
        m=min(tS,tK); T1S=(m*(2*E-1)).astype(f)      # [j,k] SB net (E[j,k]= SB equity vs BB)
        T1K=-T1S
        # T2: BTN push, SB fold, BB call: HU B vs K  [i,k]
        m=min(tB,tK); T2B=(E*(2*m+0.5)-m).astype(f); T2K=((1-E)*(2*m+0.5)-m).astype(f)   # E[i,k]; T2K is BB net
        # T3: BTN push, SB call, BB fold: HU B vs S [i,j], BB dead 1
        m=min(tB,tS); T3B=(E*(2*m+1)-m).astype(f); T3S=((1-E)*(2*m+1)-m).astype(f)
        # T4: 3-way all-in w/ side pots
        t=[tB,tS,tK]; order=np.argsort(t,kind='stable'); m1=t[order[0]]; m2=t[order[1]]
        contrib=[m2,m2,m2]; contrib[order[0]]=m1
        net=[3*m1*TB, 3*m1*TS, 3*m1*TK]
        net=[x.astype(f) for x in net]
        cls_axis={0:0,1:1,2:2}
        def pair_eq(p,q):  # equity tensor of position p vs q over [i,j,k]
            Ex=E  # E[a,b]
            shape=[None,None,None]
            # E indexed [class_p,class_q]
            idx=[slice(None) if ax in (p,q) else None for ax in range(3)]
            M=Ex if p<q else Ex.T   # make array indexed [axis min, axis max]
            # M has dims (class at lower axis, class at higher axis) but we want eq of p vs q: if p<q M=E[p,q]; else need E[p,q] with p>q -> array indexed [q,p]=E.T[q,p]=E[p,q]
            return M[tuple(idx)] if True else None
        o0,o1,o2=order
        side=2*(m2-m1)
        if side>0:
            e12=pair_eq(o1,o2)   # equity of o1 vs o2  broadcast to [i,j,k]
            net[o1]=net[o1]+(side*e12).astype(f); net[o2]=net[o2]+(side*(1-e12)).astype(f)
        for p in range(3): net[p]=net[p]-np.float32(contrib[p])
        T4B,T4S,T4K=net
        # --- fixed tensors for gains ---
        s.A_B=Wn                       # BTN hero
        s.A2=(Wn*T2B[:,None,:]).astype(f); s.A3=(Wn*T3B[:,:,None]).astype(f); s.A4=(Wn*T4B).astype(f)
        s.WS1=(WnS*T1S[None,:,:]).astype(f)       # SB push node:  Wn*T1S[j,k]
        s.WS3=(WnS*T3S[:,:,None]).astype(f); s.WS4=(WnS*T4S).astype(f)
        s.WK1=(WnK*T1K[None,:,:]).astype(f)       # BB b1: T1K[j,k]  (axes i dummy)
        s.WK2=(WnK*T2K[:,None,:]).astype(f); s.WK4=(WnK*T4K).astype(f)
        s.wt=CN/1326.0
        s.one=np.ones(169,np.float32)

    def gains(s,a,sp,sc,b1,b2,b3):
        o=s.one; W=s.Wn
        # BTN: push minus fold(0)
        gB=(cs(s.A2,1,1-sc,2,b2)+1.5*cs(W,1,1-sc,2,1-b2)+cs(s.A4,1,sc,2,b3)+cs(s.A3,1,sc,2,1-b3))
        # SB push node (axes: i=0 BTN folded weight (1-a), k=2 -> b1)
        gSp=(cs(s.WS1,0,1-a,2,b1)+cs(s.WnS,0,1-a,2,1.5*o-b1))
        # SB call node: reach a_i, BB b3_k
        gSc=(cs(s.WS4,0,a,2,b3)+cs(s.WS3,0,a,2,1-b3)+0.5*cs(s.WnS,0,a,2,o))
        # BB b1: reach (1-a_i) sp_j ; payoff T1K[j,k]+1
        gb1=cs(s.WK1,0,1-a,1,sp)+cs(s.WnK,0,1-a,1,sp)
        # BB b2: reach a_i (1-sc_j); T2K[i,k]+1
        gb2=cs(s.WK2,0,a,1,1-sc)+cs(s.WnK,0,a,1,1-sc)
        # BB b3
        gb3=cs(s.WK4,0,a,1,sc)+cs(s.WnK,0,a,1,sc)
        return gB,gSp,gSc,gb1,gb2,gb3

def solve(G,iters=3000,verbose=True,init=0.5):
    names=['a','sp','sc','b1','b2','b3']
    x=[np.full(169,init,np.float32) for _ in names]
    xa=[v.copy() for v in x]   # average of recent
    last=[]
    for t in range(1,iters+1):
        g=G.gains(*x)
        br=[(gi>0).astype(np.float32) for gi in g]
        al=1.0/(t+1)
        x=[(1-al)*xi+al*bi for xi,bi in zip(x,br)]
        if t%500==0 or t==iters:
            g=G.gains(*x)
            loss=sum(float((G.wt*np.maximum(gi,0)*np.abs(xi-(gi>0))*1).sum()) for gi,xi in zip(g,x))
            # improvement from deviating to BR at each hand: |gain| * |x - br| ; use sum over hands
            loss=sum(float((G.wt*np.abs(gi)*np.abs(xi-(gi>0))).sum()) for gi,xi in zip(g,x))
            if verbose: print(f" it {t} approx exploitability {loss*1000:.3f} mbb/hand",flush=True)
    return dict(zip(names,x)),loss

def pct(v): return 100*float((v*CN).sum())/1326
