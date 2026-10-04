import numpy as np, numba as nb, time, sys
from hands import CB,CN
from evalnb import eval7

@nb.njit(cache=True)
def draw_board(rng_state_unused, used, out):
    k=0
    while k<5:
        c=np.random.randint(0,52)
        if used[c]==0:
            used[c]=1; out[k]=c; k+=1

@nb.njit(parallel=True,cache=True)
def hu_table(CB,CN,N,seed):
    E=np.zeros((169,169))
    for idx in nb.prange(169*169):
        i=idx//169; j=idx%169
        if j<i: continue
        np.random.seed(seed+idx)
        if i==j:
            E[i,j]=0.5; continue
        tot=0.0
        board=np.zeros(5,np.int64)
        for t in range(N):
            used=np.zeros(52,np.int64)
            a=np.random.randint(0,CN[i]); c0=CB[i,a,0]; c1=CB[i,a,1]
            used[c0]=1;used[c1]=1
            while True:
                b=np.random.randint(0,CN[j]); d0=CB[j,b,0]; d1=CB[j,b,1]
                if used[d0]==0 and used[d1]==0: break
            used[d0]=1;used[d1]=1
            draw_board(0,used,board)
            s1=eval7(c0,c1,board[0],board[1],board[2],board[3],board[4])
            s2=eval7(d0,d1,board[0],board[1],board[2],board[3],board[4])
            if s1>s2: tot+=1.0
            elif s1==s2: tot+=0.5
        E[i,j]=tot/N
    return E

if __name__=="__main__":
    N=int(sys.argv[1]); out=sys.argv[2]
    t=time.time()
    E=hu_table(CB,CN,N,12345)
    for i in range(169):
        for j in range(i):
            E[i,j]=1-E[j,i]
    np.save(out,E)
    print("time",time.time()-t)
    # sanity: AA vs KK, AKs vs 22, 72o vs AA
    from hands import IDX
    print(E[IDX['AA'],IDX['KK']],E[IDX['AKs'],IDX['22']],E[IDX['72o'],IDX['AA']],E[IDX['AKo'],IDX['QQ']])
