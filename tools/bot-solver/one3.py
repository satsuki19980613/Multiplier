import numpy as np, sys, time
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
c=tuple(float(v) for v in sys.argv[1:4]); G=Game3(T3,W3,E2,*c)
x,loss=solve(G,3000,verbose=False)
np.savez(f"nash3_{c[0]:g}_{c[1]:g}_{c[2]:g}.npz",**x); print(c,loss*1000)
