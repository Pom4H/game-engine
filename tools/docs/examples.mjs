// These source strings are the only definitions of the demos. No hidden demo-specific renderer.
const vehicleSource=(model='M3',extras='',controls='{ brake: 1 }',world='floor()',tail='')=>`import {
  scene, vehicle, chassis, roadWheels, assembly,
  ${model}, wing, floor, box, sphere, orbit,
} from '@rom4/game-engine/dsl';

const model = { ...${model},
  wheel: { ...${model}.wheel, spokes: 10 },
};
const car = vehicle('car', {
  chassis: chassis(model, { massKg: 1500 }),
  parts: [
    ...roadWheels(model, {
      springNPerM: 35000,
      damperNsPerM: 3200,
      wearEnergyJ: 20000000,
    }),${extras}
  ],
});

export default scene({
  camera: orbit([0, .75, 0], 10, -.75, .28),
  follow: 'car',
  durationSeconds: 20,
  entities: [${world}],
  vehicles: [assembly(car, model, {
    modelOriginM: [0, .75, 0],
    position: [0, .75, 0],
    paint: { color: [.16, .24, .30, 1],
      roughness: .24, metalness: .10,
      clearcoat: .8, clearcoatRoughness: .17 },
    controls: ${controls},${tail}
  })],
});
`;
const wings=`
    ...(wingsEnabled ? [-1, 1].map(side => wing(
      side < 0 ? 'wing.left' : 'wing.right', {
        at: [0, 0, side * 2.8],
        mountAt: [0, .25, side * .85],
        massKg: 25, spanM: 4, chordM: 1.6,
        zeroLiftRad: 0, incidenceRad: 0,
        control: 'flap', controlGainRad: .20,
      },
    )) : []),`;
const catalog=[
 {id:'m3',title:'M3 · конструкция',group:'Автомобили',legacy:['full-vehicle','full-transport'],status:'partial',limit:'Сборка M3 новым VehicleCompiler. Посадка, двери и старый каталог ригов ещё не перенесены.',source:vehicleSource()},
 {id:'pickup',title:'Pickup · конструкция',group:'Автомобили',legacy:['full-transport'],status:'partial',limit:'Процедурный pickup — ранняя геометрия. Модель и четыре колеса используют один источник размеров.',source:vehicleSource('PICKUP')},
 {id:'drive',title:'Управление и подвеска',group:'Автомобили',legacy:['full-vehicle','vehicles'],status:'partial',limit:'Новый Vehicle: газ, тормоз, руление, пружины. Контакт шин пока только с плоскостью y=0; ABS, КПП и bumps старого полигона не перенесены.',source:vehicleSource('M3','','{ throttle: .35, steer: .12 }')},
 {id:'wings',title:'Крылья · отрыв от земли',group:'Автомобили',legacy:[],status:'native',limit:'Реальные силы Vehicle. После 15 с разгона отклоняются крылья. Короткий отрыв/планирование, без тяги в воздухе; полноразмерные SI, не 1:64.',source:vehicleSource('M3',wings,'{ throttle: 1 }','floor(400)',`
    timeline: [{ atSeconds: 15, value: { flap: 1 } }],`).replace('const car =', 'const wingsEnabled = true;\n\nconst car =')},
 {id:'wear',title:'Шины · износ от работы',group:'Автомобили',legacy:['full-vehicle'],status:'partial',limit:'Ресурс уменьшен для короткого опыта, не реальная калибровка. Радиус резины и сцепление читают то же состояние износа.',source:vehicleSource('M3','','{ throttle: 1, steer: .4 }').replace('wearEnergyJ: 20000000','wearEnergyJ: 30000')},
 {id:'wall',title:'Краш · жёсткая стена',group:'Контакты',legacy:['full-crash'],status:'partial',limit:'Новый reduced plastic-contact слой. Не coupled node/beam из thegame. Начальная скорость задана в м/с.',source:vehicleSource('M3','','{}',`floor(),
    box('wall', [.4, 3, 8], {
      position: [9, 1.5, 0], material: { kind: 'concrete' },
      body: { mass: 0 },
    })`,`
    velocity: [17.78, 0, 0],
    damage: { skinThicknessM: .0008, radiusM: .45, maxDentM: .4 },`).replace("  follow: 'car',","  // Fixed camera keeps the impact visible.").replace('orbit([0, .75, 0], 10, -.75, .28)','orbit([5, .75, 0], 16, -.75, .3)')},
 {id:'drop',title:'Краш · груз на крышу',group:'Контакты',legacy:['full-crash'],status:'partial',limit:'Свободно падающее тело, одна физическая масса. Смятие — существующая приближённая контактная модель движка, не новый soft-body.',source:vehicleSource('M3','','{ brake: 1 }',`floor(),
    box('weight', [.8, .8, .8], {
      position: [0, 5.8, 0],
      material: { kind: 'steel', color: [.45, .30, .12, 1] },
      body: { mass: 500, restitution: 0 },
    })`,`
    damage: { skinThicknessM: .0008, radiusM: .5, maxDentM: .4 },`).replace('orbit([0, .75, 0], 10, -.75, .28)','orbit([0, 2.2, 0], 12, -.8, .3)')},
 {id:'collision',title:'Краш · два автомобиля',group:'Контакты',legacy:['full-crash'],status:'partial',limit:'Два новых Vehicle в одном PhysicsWorld. Нет старого coupled solver, но столкновение/массы/деформация реальные.',source:`import { scene, vehicle, chassis, roadWheels, assembly,
  M3, PICKUP, floor, orbit } from '@rom4/game-engine/dsl';

const entries = [M3, PICKUP].map((model, i) => {
  const car = vehicle('car-' + i, {
    chassis: chassis(model), parts: roadWheels(model),
  });
  const direction = i ? -1 : 1;
  return assembly(car, model, {
    modelOriginM: [0, .75, 0],
    position: [direction * -7, .75, i * .3],
    velocity: [direction * 12, 0, 0],
    controls: {},
    damage: { radiusM: .5, maxDentM: .4 },
  });
});

export default scene({
  camera: orbit([0, .8, 0], 20, -.8, .38),
  entities: [floor()], vehicles: entries,
});
`},
 {id:'glass',title:'Стекло · разрушение',group:'Контакты',legacy:['damage','full-crash'],status:'partial',limit:'Контакт разбивает настоящее стекло на фрагменты. Новый fracturePlate, не копия старого glassPaneState. Звук удара — текущий синтезатор движка.',source:`import { scene, box, sphere, floor, orbit }
  from '@rom4/game-engine/dsl';

export default scene({
  camera: orbit([0, 1.4, 0], 9, -.8, .3),
  entities: [
    floor(),
    box('glass', [.008, 2.2, 3], {
      position: [0, 1.4, 0],
      material: { kind: 'glass', color: [.6, .85, .92, .55] },
      body: { mass: 0 },
    }),
    sphere('striker', .18, {
      position: [-4, 1.5, 0],
      material: { kind: 'steel' },
      body: { mass: 5, velocity: [12, 0, 0], shape: 'sphere' },
    }),
  ],
});
`},
 {id:'materials',title:'Материалы · падение и звук',group:'Материалы',legacy:['material-synth','full-audio'],status:'partial',limit:'Контактные звуки текущего ProceduralAudio. Студия модальных материалов и автомобильный AudioEngine/worklet из старых docs не перенесены.',source:`import { scene, sphere, box, floor, orbit }
  from '@rom4/game-engine/dsl';

const materials = ['steel', 'wood', 'rubber', 'glass'] as const;
export default scene({
  camera: orbit([0, 1, 0], 11, -.95, .5),
  entities: [floor(30, 'concrete'),
    ...materials.map((kind, i) => sphere(kind, .4, {
      position: [0, 3 + i * .3, (i - 1.5) * 1.4],
      material: { kind },
      body: { mass: 3, shape: 'sphere' },
    })),
  ],
});
`},
 {id:'rendering',title:'Геометрия и покрытия',group:'Материалы',legacy:['rendering'],status:'ported',limit:'Реальные примитивы и материалы нового WebGPU renderer. Здесь нет нарисованной подложки или отдельного рендера для документации.',source:`import { scene, sphere, box, floor, orbit }
  from '@rom4/game-engine/dsl';

export default scene({
  camera: orbit([0, .6, 0], 10, -.7, .45),
  entities: [floor(),
    ...Array.from({length: 5}, (_, i) => sphere('sample-' + i, .6, {
      position: [0, .6, (i - 2) * 1.5],
      collision: 'none',
      material: { kind: 'aluminum', color: [.2, .4, .5, 1],
        roughness: .08 + i * .2, metalness: .8 },
    })),
  ],
});
`},
 {id:'walker',title:'Походка · IK и контакты',group:'Анимация',legacy:['animation','full-character'],status:'partial',limit:'Production locomotion/IK нового движка. Перенесены походка и контакты; стамина, приседание, прыжок и старый Character motor ещё не перенесены.',source:`import { scene, humanoid, floor, orbit }
  from '@rom4/game-engine/dsl';

const person = humanoid('walker', {
  root: [-3, 0, 0], speed: .7,
  heading: 0, period: 1.3, heightScale: 1,
});
export default scene({
  durationSeconds: 10,
  camera: orbit([0, .9, 0], 9, -.8, .25),
  entities: [floor(), ...person.entities],
  animation: { walkers: [person.rig] },
});
`},
 {id:'snow',title:'Снег · среда и следы',group:'Анимация',legacy:['full-character','full-city'],status:'partial',limit:'Нативные снег, контакты и следы нового движка. Старые генератор города и трафик не подключены.',source:`import { scene, humanoid, box, orbit }
  from '@rom4/game-engine/dsl';

const person = humanoid('walker', {
  root: [-2, 0, 0], speed: .65,
});
export default scene({
  durationSeconds: 10,
  camera: orbit([0, 1, 0], 8, -.8, .48),
  environment: { temperatureC: -10, sunlight: .8,
    humidity: .8, groundMoisture: .6,
    snowfall: 'moderate', wind: [1, 0, .2] },
  entities: [box('snow-field', [14, .08, 10], {
    position: [0, -.04, 0], material: {kind: 'concrete'},
    environmental: {surfaceUse: 'sidewalk', snowDepthM: .08},
  }), ...person.entities],
  surfaceContacts: { snow: [{surfaceId: 'snow-field', seed: 42}] },
  animation: { walkers: [person.rig] },
});
`},
 {id:'spatial',title:'Пространственный индекс',group:'Ядро',legacy:['spatial'],status:'ported',limit:'Запрос выполняет SpatialHash. Светлые точки внутри круга, голубые — остальные кандидаты broad phase. Сцена перестраивается только при правке кода.',source:`import { scene, sphere, floor, orbit, SpatialHash, mulberry32 }
  from '@rom4/game-engine/dsl';

const random = mulberry32(42);
const points = Array.from({length: 160}, (_, i) => ({
  id: String(i), x: (random()-.5)*20, z: (random()-.5)*20,
}));
const index = new SpatialHash(2);
for (const p of points) index.add(p, .1);
const radius = 5;
const candidates = new Set(index.near(0, 0, radius));
export default scene({
  camera: orbit([0, 0, 0], 28, -.8, 1.15),
  entities: [floor(30), ...points.map(p => sphere(p.id, .18, {
    position: [p.x, .2, p.z], collision: 'none',
    material: {kind:'plastic', color: Math.hypot(p.x,p.z) <= radius
      ? [.9,.8,.45,1] : candidates.has(p) ? [.3,.65,.8,1] : [.25,.28,.3,1]},
  }))],
});
`},
 {id:'kernel',title:'Планировщик · зависимости',group:'Ядро',legacy:['kernel'],status:'ported',limit:'Высота столбца = частота реального ModuleScheduler.plan. Конфликтующие writers без after отвергаются компилятором, последняя рабочая сцена остаётся.',source:`import { scene, box, floor, orbit, ModuleScheduler }
  from '@rom4/game-engine/dsl';

const scheduler = new ModuleScheduler(60);
scheduler.use({id:'input', phase:'input', rateHz:60,
  reads:[], writes:['controls']});
scheduler.use({id:'physics', phase:'simulate', rateHz:60,
  reads:['controls'], writes:['pose']});
scheduler.use({id:'publish', phase:'publish', rateHz:20,
  reads:['pose'], writes:[]});
const plan = scheduler.plan(3, 'detailed');
export default scene({
  camera: orbit([0, 1, 0], 10, -.8, .4),
  entities: [floor(), ...plan.flatMap((batch, i) =>
    batch.modules.map((module, j) => box(module.id, [.8,module.rateHz/30,.8], {
      position:[i*1.6-1.6,module.rateHz/60,j*1.4], collision:'none',
      material:{kind:'plastic', color:[.25,.5,.6,1]},
    })))],
});
`},
];
// Source coverage: never mark unsupported old systems as fully migrated.
export const LEGACY_PENDING=[
 {id:'full-city',title:'Город и трафик',reason:'Нужен перенос createWorld, дорожной сети, buildCity и Simulation; снег — отдельный доступный опыт.'},
 {id:'full-building',title:'Планы зданий, интерьер, разрез',reason:'BuildingPlan, порталы, этажи и BuildingRegistry отсутствуют в новом движке.'},
 {id:'full-transport',title:'Посадка и двери',reason:'Новый каталог содержит M3/pickup, но не старые transportRig, seatedPose и boardingPath.'},
 {id:'full-character',title:'Полный Character motor',reason:'Походка/IK доступны; приседание, стамина, прыжок и старый полигон не перенесены.'},
 {id:'full-crash',title:'Столб, кладка, coupled soft-body',reason:'Перенесены сценарии двух машин, стены и груза в reduced solver. Составной столб, 80 кирпичей с разрывом раствора и coupled solver не перенесены.'},
 {id:'full-audio',title:'Автомобильный AudioEngine',reason:'Текущие звуки контактов работают; микшер/worklet/двигатель/шины из thegame требуют адаптера.'},
 {id:'material-synth',title:'Студия материалов',reason:'Модальные банки и полный интерфейс старой студии не заменяются случайным осциллятором.'},
 {id:'audio',title:'ExhaustSynth и WAV',reason:'Автомобильный акустический тракт ещё не перенесён в новый движок.'},
 {id:'full-network',title:'Репликация при потерях',reason:'Нужны CausalPublisher/Receiver, wire и ограниченные очереди; не заменены синусоидой.'},
 {id:'full-storage',title:'Worker и SQLite',reason:'Требуется отдельный серверный host для SQLiteLocationStore и LocationSimulationPool.'},
 {id:'interest',title:'Области интереса',reason:'InterestPlanner отсутствует в новом движке.'},
 {id:'causal',title:'Очередь причинных событий',reason:'CausalWorldRuntime пока остаётся в thegame.'},
 {id:'storage',title:'Checkpoint и fencing',reason:'Нужны исходные encodeRecords и tokenMatches.'},
 {id:'population',title:'Население и потребности',reason:'Это домен thegame, не подменяется фиктивной симуляцией в docs.'},
 {id:'network',title:'Sequence wraparound',reason:'Сетевой протокол thegame не переносился.'},
 {id:'performance',title:'Синтетический performance trace',reason:'В новом стенде показано реальное время кадра; старый FramePerformanceTracker пока не перенесён.'},
 {id:'hud',title:'Игровой HUD',reason:'Новый стенд имеет только диагностический HUD, без старого игрового интерфейса.'},
];

const lighting=`  rendering: {
    exposure: 1, sunIntensity: 2.5,
    sunDirection: [.4, .8, -.3],
    shadowExtent: 25, fogDensity: 0,
  },
`;
export const EXAMPLES=catalog.map(example=>({...example,source:example.source.replace('export default scene({\n','export default scene({\n'+lighting)}));
