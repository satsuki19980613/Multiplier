import numpy as np, sys
from hands import NAMES, IDX, CB, CN, INFO

def disjoint_weights():
    """W[i,j] = number of (combo of i, combo of j) pairs that don't share a card"""
    W=np.zeros((169,169))
    for i in range(169):
        for j in range(169):
            n=0
            for a in range(CN[i]):
                s1={CB[i,a,0],CB[i,a,1]}
                for b in range(CN[j]):
                    if CB[j,b,0] not in s1 and CB[j,b,1] not in s1: n+=1
            W[i,j]=n
    return W

def solve_hu(E,W,S,iters=20000,sb=0.5,bb=1.0):
    """E[i,j]=equity of i vs j. S = effective stack in bb (incl. posted blind).
    returns push prob p[i] (SB), call prob q[j] (BB) via fictitious play."""
    p=np.ones(169)*0.5; q=np.ones(169)*0.5
    ps=np.zeros(169); qs=np.zeros(169)
    WE=W            # weights
    for t in range(1,iters+1):
        # SB best response to q:  EV(push)= sum_j w_ij[(1-q_j)*bb + q_j*S*(2E_ij-1)] / sum_j w_ij ; fold = -sb
        den=W.sum(1)
        ev_push=((W*((1-q)[None,:]*bb + q[None,:]*S*(2*E-1))).sum(1))/den
        br_p=(ev_push>-sb).astype(float)
        # BB best response to p: call if avg over pusher range of S*(2E_ji-1) > -bb
        wp=W*p[:,None]      # [i,j] weight of SB hand i given BB hand j  (W symmetric)
        num=(wp*(S*(2*E.T-1))).sum(0)   # E.T[j,i]=E[j,i]? careful below
        # E.T[i,j]=E[j,i] -> equity of BB hand j vs SB hand i = E[j,i] = E.T[i,j]
        d=wp.sum(0)
        avg=np.where(d>0,num/np.maximum(d,1e-12),-1e9)
        br_q=(avg>-bb).astype(float)
        a=1.0/(t+1)
        p=(1-a)*p+a*br_p; q=(1-a)*q+a*br_q
        if t>iters//2:
            ps+=br_p; qs+=br_q   # average of later best responses
    n=iters-iters//2
    return p,q,ps/n,qs/n,ev_push

def pct(prob,CN): return 100*(prob*CN).sum()/1326

def range_str(prob,thr=0.5):
    return [NAMES[i] for i in range(169) if prob[i]>=thr]

def exploit(E,W,S,p,q,sb=0.5,bb=1.0):
    """total exploitability (chips) of strategy pair: BR value minus current value for both players, using hand-weights."""
    den=W.sum(1); wt=CN/1326.0
    ev_push=((W*((1-q)[None,:]*bb + q[None,:]*S*(2*E-1))).sum(1))/den
    ev_sb=np.where(True,p*ev_push+(1-p)*(-sb),0)
    br_sb=np.maximum(ev_push,-sb)
    loss_sb=((br_sb-ev_sb)*wt).sum()
    # BB: value contributed by BB hand j (per BB hand): sum_i p_i w_ij/den_j *[q S(2E_ji-1) + (1-q)(-bb)] + (1-sum p...) * (+sb) ... compute vs BR
    pw=W*p[:,None]/den[:,None]  # prob SB hand i given pushing weighting: for BB hand j: P(i|j)=w_ij/den_j ... W sym, den same by symmetry
    # P(SB pushes and has i | BB has j) = W[i,j]*p[i]/den_j
    pj=(W*p[:,None]).sum(0)/den  # prob SB pushes given j
    call_ev=((W*p[:,None]*(S*(2*E.T-1))).sum(0))/den  # contribution = P(push&i)*net
    fold_ev=-bb*pj
    cur=q*call_ev+(1-q)*fold_ev
    br=np.maximum(call_ev,fold_ev)
    loss_bb=((br-cur)*wt).sum()
    return loss_sb+loss_bb

if __name__=="__main__":
    E=np.load(sys.argv[1])
    W=disjoint_weights()
    np.save("W2.npy",W)
    for S in [float(x) for x in sys.argv[2:]]:
        p,q,ps,qs,_=solve_hu(E,W,S)
        print(f"S={S}: SB push {pct(ps,CN):.1f}%  BB call {pct(qs,CN):.1f}%  exploit(mBB/hand)={1000*exploit(E,W,S,ps,qs):.2f}")
