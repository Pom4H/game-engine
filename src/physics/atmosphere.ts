import type {MutableVec3,Vec3} from '../math.js';

export interface WeatherAir{readonly temperatureC:number;readonly wind:readonly[number,number];readonly gust:number;readonly humidity?:number}
export interface AirSample{readonly wind:MutableVec3;density:number;pressurePa:number;temperatureK:number;gust:number}
export type WeatherReader=(minute:number,x:number,z:number)=>WeatherAir;
export const createAirSample=():AirSample=>({wind:[0,0,0],density:1.225,pressurePa:101325,temperatureK:288.15,gust:0});
const RD=287.05,RV=461.5,G=9.80665,LAPSE=.0065;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*(3-2*v);};
function hash(seed:number,x:number,z:number,t:number):number{
  let h=(seed^Math.imul(x,374761393)^Math.imul(z,668265263)^Math.imul(t,2246822519))|0;
  h=Math.imul(h^(h>>>13),1274126177);return(h^(h>>>16))>>>0;
}
export function thermodynamics(altitudeM:number,seaLevelTemperatureC:number,relativeHumidity:number,out:AirSample):void{
  if(![altitudeM,seaLevelTemperatureC,relativeHumidity].every(Number.isFinite))throw new RangeError('Atmosphere inputs must be finite');
  if(relativeHumidity<0||relativeHumidity>1)throw new RangeError('Relative humidity must be in 0..1');
  const h=clamp(altitudeM,-500,20000),t0=clamp(seaLevelTemperatureC+273.15,233.15,323.15),h1=Math.min(h,11000),t1=t0-LAPSE*h1;
  const p1=101325*Math.pow(t1/t0,G/(RD*LAPSE)),pressurePa=h<=11000?p1:p1*Math.exp(-G*(h-11000)/(RD*t1)),c=t1-273.15;
  const vapor=Math.min(pressurePa*.2,relativeHumidity*610.94*Math.exp(17.625*c/(c+243.04)));
  out.pressurePa=pressurePa;out.temperatureK=t1;out.density=(pressurePa-vapor)/(RD*t1)+vapor/(RV*t1);return;
}
function signed(seed:number,x:number,z:number,t:number):number{return hash(seed,x,z,t)/2147483648-1;}
function gustNoise(seed:number,x:number,z:number,seconds:number):number{
  const px=x/180,pz=z/180,pt=seconds/14,ix=Math.floor(px),iz=Math.floor(pz),it=Math.floor(pt),u=smooth(px-ix),v=smooth(pz-iz),w=smooth(pt-it);let sum=0;
  for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++)for(let dt=0;dt<2;dt++)sum+=signed(seed,ix+dx,iz+dz,it+dt)*(dx?u:1-u)*(dz?v:1-v)*(dt?w:1-w);
  return sum;
}
export class AtmosphereField{
  private readonly columns=new Map<string,WeatherAir>();
  constructor(readonly seed:number,private readonly readWeather:WeatherReader,readonly capacity=512){if(!Number.isSafeInteger(capacity)||capacity<8)throw new RangeError('Atmosphere cache needs at least eight entries');}
  private column(minute:number,x:number,z:number):WeatherAir{
    const key=minute+':'+x+':'+z,old=this.columns.get(key);if(old)return old;
    const value=this.readWeather(minute,x*256,z*256);if(![value.temperatureC,...value.wind,value.gust].every(Number.isFinite)||value.gust<0||value.gust>1)throw new RangeError('Invalid weather sample');
    const copy:WeatherAir={temperatureC:value.temperatureC,wind:[...value.wind],gust:value.gust,humidity:clamp(value.humidity??.5,0,1)};
    if(this.columns.size>=this.capacity)this.columns.delete(this.columns.keys().next().value!);this.columns.set(key,copy);return copy;
  }
  sample(position:Vec3,groundY:number,minute:number,seconds:number,out=createAirSample(),humidity?:number):AirSample{
    const [x,y,z]=position;if(![x,y,z,groundY,minute,seconds].every(Number.isFinite))throw new RangeError('Atmosphere sample inputs must be finite');
    const gx=x/256,gz=z/256,ix=Math.floor(gx),iz=Math.floor(gz),it=Math.floor(minute),u=smooth(gx-ix),v=smooth(gz-iz),t=smooth(minute-it);
    let temperature=0,wx=0,wz=0,gust=0,rh=0;
    for(let dz=0;dz<2;dz++)for(let dx=0;dx<2;dx++)for(let dt=0;dt<2;dt++){const k=(dx?u:1-u)*(dz?v:1-v)*(dt?t:1-t);if(k===0)continue;const a=this.column(it+dt,ix+dx,iz+dz);temperature+=a.temperatureC*k;wx+=a.wind[0]*k;wz+=a.wind[1]*k;gust+=a.gust*k;rh+=(a.humidity??.5)*k;}
    thermodynamics(y,temperature,humidity??rh,out);
    const agl=Math.max(0,y-groundY),exposure=1+.35*clamp(agl/60,0,1),mean=Math.hypot(wx,wz),amplitude=gust*(.22+.08*mean)*exposure;
    out.wind[0]=wx*exposure+amplitude*gustNoise(this.seed,x,z,seconds);out.wind[2]=wz*exposure+amplitude*gustNoise(this.seed^0x71f03,x,z,seconds);out.wind[1]=amplitude*.12*smooth(agl/18)*gustNoise(this.seed^0x3ab91,x,z,seconds)||0;out.gust=gust;return out;
  }
  get cachedColumns():number{return this.columns.size;}
}
