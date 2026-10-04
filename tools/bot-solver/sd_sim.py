import numpy as np, numba as nb, time
from hands import CB,CN
from sim_check import CLS, settle
from evalnb import eval7
@nb.njit(parallel=True,cache=True)
def sd(CB,CN,CLS,S,a,sp,sc,b1,b2,b3,N):
    nth=64
    s1=np.zeros((nth,3));s2=np.zeros((nth,3));cnt=np.zeros(nth)
    for th in nb.prange(nth):
        np.random.seed(5+th)
        for t in range(N//nth):
            used=np.zeros(52,np.int64);h=np.zeros((3,2),np.int64)
            for p in range(3):
                while True:
                    c0=np.random.randint(0,52);c1=np.random.randint(0,52)
                    if c0!=c1 and used[c0]==0 and used[c1]==0: break
                used[c0]=1;used[c1]=1;h[p,0]=c0;h[p,1]=c1
            board=np.zeros(5,np.int64);m=0
            while m<5:
                x=np.random.randint(0,52)
                if used[x]==0: used[x]=1;board[m]=x;m+=1
            cl=np.zeros(3,np.int64);sc_=np.zeros(3)
            for p in range(3):
                cl[p]=CLS[h[p,0],h[p,1]]
                sc_[p]=eval7(h[p,0],h[p,1],board[0],board[1],board[2],board[3],board[4])
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
            net=settle(stk,contrib,folded,sc_)
            for p in range(3):
                s1[th,p]+=net[p];s2[th,p]+=net[p]*net[p]
            cnt[th]+=1
    n=cnt.sum();m=s1.sum(0)/n;v=s2.sum(0)/n-m*m
    return m,np.sqrt(v)
d=np.load("nash3_10_10_10.npz");x={k:d[k].astype(np.float64) for k in d.files}
m,s=sd(CB,CN,CLS,10.0,x['a'],x['sp'],x['sc'],x['b1'],x['b2'],x['b3'],200_000_000)
print("per-hand mean (bb):",m,"sd (bb):",s)
