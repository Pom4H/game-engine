export const provingGroundZones=Object.freeze([
  {id:'straight',label:'Прямая для разгона',domains:['rigid-contact','wheel','tyre','drivetrain','brake']},
  {id:'obstacles',label:'Участок с препятствиями',domains:['collision','suspension','structural','damage']},
  {id:'surfaces',label:'Различные покрытия',domains:['material-contact','tyre','brake','wet-grip']},
  {id:'circle',label:'Площадка кругового движения',domains:['tyre','steering','load-transfer','centripetal']},
  {id:'loop',label:'Петля',domains:['rigid-contact','normal-load','aero','powertrain']},
  {id:'ramps',label:'Трамплины',domains:['suspension','ballistic','landing','structural']},
  {id:'water',label:'Водный участок',domains:['fluid','buoyancy','drag','sealing']},
  {id:'rough',label:'Рельеф',domains:['suspension','tyre','ground-clearance','structural']},
  {id:'handling',label:'Извилистая трасса',domains:['steering','tyre','load-transfer','aero']},
  {id:'hill',label:'Горка',domains:['drivetrain','brake','traction','thermal']},
  {id:'wind-tunnel',label:'Аэродинамический туннель',domains:['aero','wind','drag','downforce']},
]);

export const releasePhysicsRequirements=Object.freeze([
  'rigid-contact','collision','material-contact','structural','damage',
  'wheel','tyre','suspension','steering','drivetrain','brake','load-transfer',
  'aero','wind','normal-load','ballistic','landing',
  'fluid','buoyancy','drag','sealing','thermal','ground-clearance',
  'determinism','cause-provenance','energy-accounting','momentum-accounting'
]);
