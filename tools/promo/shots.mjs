// One street, one continuous action. Camera cuts preserve world simulation time.
export const shots=[
 {id:'arrival',set:'street',offset:0,duration:8,from:[-30,1.65,5.8],to:[-27,1.7,5.6],lookFrom:[-9,2.0,0],lookTo:[2,2.2,-.5],fov:48,title:'ОДНА УЛИЦА. ЖИВОЙ ЗИМНИЙ МИР.'},
 {id:'m3',set:'street',offset:8,duration:8,follow:'car',from:[7,1.02,3.6],to:[6.5,1.12,3.9],lookFrom:[0,.80,0],lookTo:[0,.80,0],fov:47,title:'BMW M3 / СНЕГ, ВОДА, КОНТАКТ'},
 {id:'walk',set:'street',offset:16,duration:8,follow:'person',from:[-4.6,1.48,1.65],to:[-4.1,1.35,1.55],lookFrom:[.35,1.05,0],lookTo:[.55,1.05,0],fov:43,title:'КАЖДЫЙ ШАГ ОСТАВЛЯЕТ СЛЕД'},
 {id:'footsteps',set:'street',offset:24,duration:6,follow:'person',from:[-1.55,.49,1.0],to:[-1.75,.44,.95],lookFrom:[0,.24,0],lookTo:[.06,.25,0],fov:48,focus:1.9,aperture:.4,title:'ОПОРА. ОТПЕЧАТОК. ХРУСТ СНЕГА.'},
 {id:'snowbank',set:'street',offset:30,duration:8,from:[2,.85,2.65],to:[6,1.08,2.7],lookFrom:[12,.8,4.5],lookTo:[20,1.05,4.7],fov:46,title:'СУГРОБЫ И ПАДАЮЩИЕ ХЛОПЬЯ'},
 {id:'evening',set:'courtyard',offset:38,duration:10,from:[2,1.75,5.1],to:[-2,2.2,4.8],lookFrom:[20,2.4,3.5],lookTo:[27,3.2,2.0],fov:48,title:'GAME ENGINE / МИР ИЗ ВЗАИМОДЕЙСТВИЙ',end:true},
];
