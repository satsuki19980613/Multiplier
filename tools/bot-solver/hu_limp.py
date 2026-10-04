"""HU extended model: SB: fold / limp / jam.  BB vs jam: call/fold.  BB vs limp: check (realized equity) / iso-jam.  SB vs iso-jam: call/fold.
Postflop after limp-check: SB share = E/(E + r(1-E)), r = R_BB/R_SB (<1: BB (OOP) realizes less).  pot 2bb, value = 2*share-1 (net vs 1bb invested)."""
import numpy as np, sys
from hands import *
E=np.load("hu_eq.npy"); W=np.load("W2.npy"); den=W.sum(1); wt=CN/1326
def solve(S,r,iters=6000):
    sh=E/(E+r*(1-E))            # SB share when checked down  [i,j]
    Vchk=2*sh-1                 # SB net (relative to 1bb invested)
    pj=np.zeros(169);pl=np.zeros(169);c1=np.full(169,.5);rr=np.zeros(169);c2=np.full(169,.5)
    pj[:]=.3;pl[:]=.4
    for t in range(1,iters+1):
        # SB best response
        evJ=((W*((1-c1)[None,:]*1+c1[None,:]*S*(2*E-1))).sum(1))/den
        netcall=S*(2*E-1)
        evL=((W*(rr[None,:]*(c2[:,None]*netcall+(1-c2)[:,None]*(-1))+(1-rr)[None,:]*Vchk)).sum(1))/den
        evF=-0.5
        best=np.argmax(np.stack([np.full(169,evF),evJ,evL]),axis=0)
        bpj=(best==1).astype(float);bpl=(best==2).astype(float)
        # SB call vs iso-jam (reach: limp prob & BB iso r_j): gain=sum_j W[i,j]*pl_i*r_j*(netcall+1)
        g2=(W*rr[None,:]*(netcall+1)).sum(1)
        bc2=(g2>0).astype(float)
        # BB: vs jam
        wj=W*pj[:,None]    # [i,j]
        g1=(wj*(S*(2*E.T-1)+1)).sum(0)
        bc1=(g1>0).astype(float)
        # BB: iso vs check after limp: gain = sum_i W pl_i [ c2_i*S(2E_ji-1)+(1-c2_i)*1 - (-Vchk_ij) ]
        wl=W*pl[:,None]
        iso=(wl*(c2[:,None]*(S*(2*E.T-1))+(1-c2)[:,None]*1)).sum(0)
        chk=(wl*(-Vchk)).sum(0)
        brr=((iso-chk)>0).astype(float)
        a=1/(t+1)
        pj=(1-a)*pj+a*bpj;pl=(1-a)*pl+a*bpl;c1=(1-a)*c1+a*bc1;rr=(1-a)*rr+a*brr;c2=(1-a)*c2+a*bc2
    return pj,pl,c1,rr,c2
def w(v): return 100*(v*CN).sum()/1326
if __name__=="__main__":
    S=float(sys.argv[1])
    for r in [float(x) for x in sys.argv[2:]]:
        pj,pl,c1,rr,c2=solve(S,r)
        pf=np.clip(1-pj-pl,0,1)
        print(f"S={S} r={r}: SB jam {w(pj):.1f}% limp {w(pl):.1f}% fold {w(pf):.1f}% | BB call-jam {w(c1):.1f}% iso-jam vs limp {w(rr):.1f}% | SB call iso {w(c2):.1f}%")
