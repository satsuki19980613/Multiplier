import numpy as np, numba as nb
from hands import CB,CN
from sim_check import CLS, settle
from evalnb import eval7
@nb.njit(parallel=True,cache=True)
def sd(CB,CN,CLS,S,a,sp,sc,b1,b2,b3,N,K):
    nth=64
    s1=np.zeros((nth,3));s2=np.zeros((nth,3));s2a=np.zeros((nth,3));cnt=np.zeros(nth)
    for th in nb.prange(nth):
        np.random.seed(9+th)
        for t in range(N//nth):
            used0=np.zeros(52,np.int64);h=np.zeros((3,2),np.int64)
            for p in range(3):
                while True:
                    c0=np.random.randint(0,52);c1=np.random.randint(0,52)
                    if c0!=c1 and used0[c0]==0 and used0[c1]==0: break
                used0[c0]=1;used0[c1]=1;h[p,0]=c0;h[p,1]=c1
            cl=np.zeros(3,np.int64)
            for p in range(3): cl[p]=CLS[h[p,0],h[p,1]]
            contrib=np.zeros(3);contrib[1]=0.5;contrib[2]=1.0;folded=np.zeros(3,np.bool_)
            stk=np.zeros(3);stk[0]=S;stk[1]=S;stk[2]=S
            r=np.random.random
            if r()<a[cl[0]]:
                contrib[0]=S
                if r()<sc[cl[1]]:
                    contrib[1]=S
                    if r()<b3[cl[2]]: contrib[2]=S
                    else: folded[2]=True
                else:
                    folded[1]=True
                    if r()<b2[cl[2]]: contrib[2]=S
                    else: folded[2]=True
            else:
                folded[0]=True
                if r()<sp[cl[1]]:
                    contrib[1]=S
                    if r()<b1[cl[2]]: contrib[2]=S
                    else: folded[2]=True
                else: folded[1]=True
            avg=np.zeros(3); first=np.zeros(3)
            for k in range(K):
                used=used0.copy();board=np.zeros(5,np.int64);m=0
                while m<5:
                    x=np.random.randint(0,52)
                    if used[x]==0: used[x]=1;board[m]=x;m+=1
                sc_=np.zeros(3)
                for p in range(3): sc_[p]=eval7(h[p,0],h[p,1],board[0],board[1],board[2],board[3],board[4])
                net=settle(stk,contrib,folded,sc_)
                for p in range(3):
                    avg[p]+=net[p]/K
                    if k==0: first[p]=net[p]
            for p in range(3):
                s1[th,p]+=first[p];s2[th,p]+=first[p]*first[p];s2a[th,p]+=avg[p]*avg[p]
            cnt[th]+=1
    n=cnt.sum();m=s1.sum(0)/n
    return m,np.sqrt(s2.sum(0)/n-m*m),np.sqrt(s2a.sum(0)/n-m*m)
d=np.load("nash3_10_10_10.npz");x={k:d[k].astype(np.float64) for k in d.files}
m,s,sa=sd(CB,CN,CLS,10.0,x['a'],x['sp'],x['sc'],x['b1'],x['b2'],x['b3'],20_000_000,16)
print("sd single runout:",s," sd with runout averaged (all-in EV):",sa," ratio^2 (variance ratio):",(sa/s)**2)
