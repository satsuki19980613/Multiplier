import numpy as np, sys, time, json
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
S=[float(x) for x in sys.argv[1:4]]; iters=int(sys.argv[4])
t=time.time()
G=Game3(T3,W3,E2,*S)
print("setup",time.time()-t,flush=True)
t=time.time()
x,loss=solve(G,iters)
print("solve",time.time()-t,"exploit mbb",loss*1000)
print("BTN push %.1f  SBpush(after fold) %.1f  SBcall %.1f  BBcall vs SB %.1f  BBcall vs BTN %.1f  BBcall vs BTN+SB %.1f"%tuple(pct(x[k]) for k in ['a','sp','sc','b1','b2','b3']))
np.savez(f"nash3_{S[0]:g}_{S[1]:g}_{S[2]:g}.npz",**x)
