// One street, one continuous action. Camera cuts preserve world simulation time.
export const shots=[
 {id:'arrival',set:'street',offset:0,duration:8,follow:'person',from:[-5.05,1.47,1.18],to:[-4.85,1.47,1.10],lookFrom:[1,1.20,-1.25],lookTo:[1.2,1.20,-1.20],fov:46,title:'ОДНА УЛИЦА. ЖИВОЙ ЗИМНИЙ МИР.'},
 {id:'m3',set:'hero',offset:8,duration:8,follow:'car',from:[7,1.02,3.6],to:[6.5,1.12,3.9],lookFrom:[0,.80,0],lookTo:[0,.80,0],fov:47,title:'BMW M3 / СНЕГ, ВОДА, КОНТАКТ'},
 {id:'walk',set:'street',offset:16,duration:8,follow:'person',from:[-5.4,1.50,.60],to:[-4.85,1.45,.60],lookFrom:[.7,1.10,-.75],lookTo:[.9,1.10,-.65],fov:45,title:'КАЖДЫЙ ШАГ ОСТАВЛЯЕТ СЛЕД'},
 {id:'footsteps',set:'street',offset:24,duration:6,follow:'person',from:[-1.55,.49,1.0],to:[-1.75,.44,.95],lookFrom:[0,.24,0],lookTo:[.06,.25,0],fov:48,focus:1.9,aperture:.4,title:'ОПОРА. ОТПЕЧАТОК. ХРУСТ СНЕГА.'},
 {id:'snowbank',set:'street',offset:30,duration:8,from:[2,.85,2.65],to:[6,1.08,2.7],lookFrom:[12,.8,4.5],lookTo:[20,1.05,4.7],fov:46,title:'СУГРОБЫ И ПАДАЮЩИЕ ХЛОПЬЯ'},
 {id:'evening',set:'courtyard',offset:38,duration:10,follow:'person',from:[-6.3,1.65,.60],to:[-8.8,2.2,.75],lookFrom:[2,1.55,-1.8],lookTo:[6,2.1,-2.23],fov:48,title:'GAME ENGINE / МИР ИЗ ВЗАИМОДЕЙСТВИЙ',end:true},
];
