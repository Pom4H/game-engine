export const provingGroundZones=Object.freeze([
  {id:'straight',label:'Прямая для разгона',domains:['rigid-contact','wheel','tyre','drivetrain','brake']},
  {id:'obstacles',label:'Участок с препятствиями',domains:['collision','suspension','structural','damage']},
  {id:'surfaces',label:'Различные покрытия',domains:['material-contact','tyre','brake','wet-grip']},
  {id:'split-mu',label:'Split-μ торможение',domains:['tyre','brake','asymmetric-grip','yaw-response']},
  {id:'circle',label:'Площадка кругового движения',domains:['tyre','steering','load-transfer','normal-load']},
  {id:'banked',label:'Banked / off-camber',domains:['tyre','normal-load','banked-contact','load-transfer']},
  {id:'loop',label:'Петля',domains:['rigid-contact','normal-load','aero','drivetrain']},
  {id:'ramps',label:'Трамплины',domains:['suspension','ballistic','landing','structural']},
  {id:'washboard',label:'Гребёнка / wheel-hop',domains:['suspension','road-excitation','wheel-hop','tyre']},
  {id:'bumps',label:'Пороги разной формы',domains:['suspension','road-excitation','landing']},
  {id:'potholes',label:'Ямы и выбоины',domains:['suspension','pothole-contact','ground-clearance','damage']},
  {id:'articulation',label:'Диагональная вывеска',domains:['suspension','articulation','ground-clearance','load-transfer']},
  {id:'water',label:'Водный участок',domains:['fluid','buoyancy','drag','sealing']},
  {id:'rough',label:'Рельеф',domains:['suspension','tyre','ground-clearance','structural']},
  {id:'handling',label:'Извилистая трасса',domains:['steering','tyre','load-transfer','aero']},
  {id:'hill',label:'Горка',domains:['drivetrain','brake','tyre','thermal']},
  {id:'brake-endurance',label:'Тормозной endurance-стенд',domains:['wheel','tyre','brake','thermal']},
  {id:'wind-tunnel',label:'Аэродинамический туннель',domains:['aero','wind','drag']},
  {id:'crosswind',label:'Боковой ветер',domains:['aero','wind-field','yaw-response']},
  {id:'soft-ground',label:'Мягкий грунт',domains:['soil','sinkage','traction','wheel']},
]);

export const releasePhysicsRequirements=Object.freeze([
  'rigid-contact','collision','material-contact','structural','damage',
  'wheel','tyre','wet-grip','suspension','steering','drivetrain','brake','load-transfer',
  'asymmetric-grip','yaw-response','banked-contact','road-excitation','wheel-hop','pothole-contact','articulation',
  'aero','wind','wind-field','normal-load','ballistic','landing',
  'fluid','buoyancy','drag','sealing','thermal','ground-clearance',
  'soil','sinkage','traction',
  'determinism','cause-provenance','energy-accounting','momentum-accounting'
]);
