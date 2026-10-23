/* Experimental port of StructuralBody's active XPBD step. No fast-math/FMA.
 * Lifecycle, initialization, impulses and bake still use the production JS body.
 * ABI: offsets follow adapter.mjs; scalars = plastic work, quiet time, steps.
 * XPBD: dLambda=(-C-alpha*lambda)/(sum(w*|gradient|^2)+alpha),
 * alpha=compliance/dt^2. Material parameters and constraint order are unchanged.
 */
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned char u8;
typedef struct { double x,y,z; } V;
__attribute__((import_module("math"),import_name("exp"))) extern double exponential(double);
__attribute__((import_module("math"),import_name("pow"))) extern double power(double,double);
#ifdef HOST_NORM
__attribute__((import_module("math"),import_name("hypot"))) extern double norm(double,double,double);
#else
static double norm(double x,double y,double z){return __builtin_sqrt(x*x+y*y+z*z);}
#endif
static double absd(double x){return __builtin_fabs(x);}
static double maxd(double a,double b){return a>b?a:b;}
static V point(double *p,u32 i){u32 j=i*3;return (V){p[j],p[j+1],p[j+2]};}
static V sub(V a,V b){return (V){a.x-b.x,a.y-b.y,a.z-b.z};}
static V cross(V a,V b){return (V){a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
static V scale(V a,double s){return (V){a.x*s,a.y*s,a.z*s};}
static double dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
static void gradients(double *p,u32 a,u32 b,u32 c,u32 d,V *ga,V *gb,V *gc,V *gd,double *volume){
  V A=point(p,a),B=point(p,b),C=point(p,c),D=point(p,d);
  *gb=scale(cross(sub(C,A),sub(D,A)),1.0/6.0);
  *gc=scale(cross(sub(D,A),sub(B,A)),1.0/6.0);
  *gd=scale(cross(sub(B,A),sub(C,A)),1.0/6.0);
  *ga=(V){-gb->x-gc->x-gd->x,-gb->y-gc->y-gd->y,-gb->z-gc->z-gd->z};
  *volume=dot(sub(B,A),cross(sub(C,A),sub(D,A)))/6.0;
}
static void apply(double *p,double *inverse,u32 i,V g,double lambda){
  u32 j=i*3;double s=inverse[i]*lambda;p[j]+=g.x*s;p[j+1]+=g.y*s;p[j+2]+=g.z*s;
}
enum {POSITION,PREVIOUS,VELOCITY,FORCE,MASS,INVERSE,ORIGINAL_POSITION,KIND,IA,IB,IC,ID,ORIGINAL_REST,REST,COMPLIANCE,YIELD_LIMIT,BREAK_LIMIT,PLASTICITY,YIELD_FORCE,LAMBDA,PREDICTED,IMPULSE_WEIGHTS,BROKEN};
#define D(field) ((double *)(unsigned long)offsets[field])
#define U16(field) ((u16 *)(unsigned long)offsets[field])
#define U8(field) ((u8 *)(unsigned long)offsets[field])
/* Return 1 exactly when the shared JS lifecycle must bake this body. */
int step(u32 n,u32 m,u32 iterations,u32 *offsets,double *scalars,double dt,double gx,double gy,double gz,double damping,double thermal,double sleepSpeed,double sleepDelay){
  double *p=D(POSITION),*previous=D(PREVIOUS),*v=D(VELOCITY),*force=D(FORCE),*inverse=D(INVERSE);
  double *original=D(ORIGINAL_REST),*rest=D(REST),*compliance=D(COMPLIANCE),*yield=D(YIELD_LIMIT),*failure=D(BREAK_LIMIT),*plasticity=D(PLASTICITY),*yieldForce=D(YIELD_FORCE),*lambda=D(LAMBDA),*predicted=D(PREDICTED);
  u8 *kind=U8(KIND),*broken=U8(BROKEN);u16 *ia=U16(IA),*ib=U16(IB),*ic=U16(IC),*id=U16(ID);
  for(u32 i=0;i<n*3;i++)previous[i]=p[i];
  for(u32 i=0;i<n;i++){
    u32 j=i*3;double w=inverse[i];
    v[j]+=dt*(gx+force[j]*w);v[j+1]+=dt*(gy+force[j+1]*w);v[j+2]+=dt*(gz+force[j+2]*w);
    p[j]+=dt*v[j];p[j+1]+=dt*v[j+1];p[j+2]+=dt*v[j+2];force[j]=force[j+1]=force[j+2]=0;
  }
  for(u32 i=0;i<m;i++){
    lambda[i]=0;if(broken[i])continue;
    if(kind[i]==0){V delta=sub(point(p,ib[i]),point(p,ia[i]));predicted[i]=norm(delta.x,delta.y,delta.z);}
    else{V A=point(p,ia[i]);predicted[i]=dot(sub(point(p,ib[i]),A),cross(sub(point(p,ic[i]),A),sub(point(p,id[i]),A)))/6.0;}
  }
  for(u32 iteration=0;iteration<iterations;iteration++)for(u32 i=0;i<m;i++){
    if(broken[i])continue;
    u32 a=ia[i],b=ib[i];double alpha=compliance[i]/(dt*dt);
    if(kind[i]==0){
      u32 A=a*3,B=b*3;double dx=p[B]-p[A],dy=p[B+1]-p[A+1],dz=p[B+2]-p[A+2];
      double length=norm(dx,dy,dz);if(length<1e-10)continue;
      double nx=dx/length,ny=dy/length,nz=dz/length,C=length-rest[i]*thermal,denom=inverse[a]+inverse[b]+alpha;
      if(denom<=1e-14)continue;
      double dl=(-C-alpha*lambda[i])/denom;lambda[i]+=dl;
      double wa=inverse[a]*dl,wb=inverse[b]*dl;
      p[A]-=nx*wa;p[A+1]-=ny*wa;p[A+2]-=nz*wa;p[B]+=nx*wb;p[B+1]+=ny*wb;p[B+2]+=nz*wb;
    }else{
      u32 c=ic[i],d=id[i];V ga,gb,gc,gd;double volume;
      gradients(p,a,b,c,d,&ga,&gb,&gc,&gd,&volume);
      double C=volume-rest[i]*power(thermal,3),denom=inverse[a]*dot(ga,ga)+inverse[b]*dot(gb,gb)+inverse[c]*dot(gc,gc)+inverse[d]*dot(gd,gd)+alpha;
      if(denom<=1e-14)continue;
      double dl=(-C-alpha*lambda[i])/denom;lambda[i]+=dl;
      apply(p,inverse,a,ga,dl);apply(p,inverse,b,gb,dl);apply(p,inverse,c,gc,dl);apply(p,inverse,d,gd,dl);
    }
  }
  double invDt=1/dt;
  for(u32 i=0;i<n*3;i++)v[i]=(p[i]-previous[i])*invDt;
  for(u32 i=0;i<m;i++){
    if(broken[i])continue;
    double thermalPower=kind[i]==0?thermal:power(thermal,3),effectiveOriginal=original[i]*thermalPower,effectiveRest=rest[i]*thermalPower;
    double divisor=maxd(kind[i]==0?1e-9:1e-12,absd(effectiveOriginal));
    double trialStrain=(predicted[i]-effectiveRest)/divisor,originalStrain=(predicted[i]-effectiveOriginal)/divisor;
    if(absd(originalStrain)>failure[i]){broken[i]=1;continue;}
    if(absd(trialStrain)>yield[i]&&plasticity[i]>0){
      double sign=trialStrain>0?1:trialStrain<0?-1:0,elastic=sign*yield[i]*absd(effectiveOriginal);
      double targetEffective=predicted[i]-elastic,targetBase=targetEffective/thermalPower,delta=(targetBase-rest[i])*plasticity[i];
      if(kind[i]==0){if(absd(delta)>1e-12){rest[i]=maxd(absd(original[i])*.04,rest[i]+delta);scalars[0]+=absd(delta*thermalPower)*yieldForce[i];}}
      else if(absd(delta)>1e-15)rest[i]+=delta;
    }
  }
  if(damping>0){
    double gain=1-exponential(-damping*dt);
    for(u32 i=0;i<m;i++){
      if(broken[i]||kind[i]!=0)continue;
      u32 a=ia[i],b=ib[i],A=a*3,B=b*3;double dx=p[B]-p[A],dy=p[B+1]-p[A+1],dz=p[B+2]-p[A+2];
      double length=norm(dx,dy,dz);if(length<1e-10)continue;
      double nx=dx/length,ny=dy/length,nz=dz/length,relative=(v[B]-v[A])*nx+(v[B+1]-v[A+1])*ny+(v[B+2]-v[A+2])*nz,denom=inverse[a]+inverse[b];
      if(denom<=1e-14)continue;
      double impulse=-relative*gain/denom,wa=inverse[a]*impulse,wb=inverse[b]*impulse;
      v[A]-=nx*wa;v[A+1]-=ny*wa;v[A+2]-=nz*wa;v[B]+=nx*wb;v[B+1]+=ny*wb;v[B+2]+=nz*wb;
    }
  }
  double peak=0;
  for(u32 i=0;i<m;i++){
    if(broken[i])continue;
    u32 a=ia[i],b=ib[i];
    if(kind[i]==0){
      u32 A=a*3,B=b*3;double dx=p[B]-p[A],dy=p[B+1]-p[A+1],dz=p[B+2]-p[A+2],length=norm(dx,dy,dz);
      if(length<1e-10)continue;
      double relative=((v[B]-v[A])*dx+(v[B+1]-v[A+1])*dy+(v[B+2]-v[A+2])*dz)/length;peak=maxd(peak,absd(relative));
    }else{
      u32 c=ic[i],d=id[i];V ga,gb,gc,gd;double volume;gradients(p,a,b,c,d,&ga,&gb,&gc,&gd,&volume);
      double rate=dot(ga,point(v,a))+dot(gb,point(v,b))+dot(gc,point(v,c))+dot(gd,point(v,d));
      double area=maxd(1e-9,power(absd(rest[i]),2.0/3.0));peak=maxd(peak,absd(rate)/area);
    }
  }
  scalars[2]++;scalars[1]=peak<sleepSpeed?scalars[1]+dt:0;
  return scalars[1]>=sleepDelay;
}
