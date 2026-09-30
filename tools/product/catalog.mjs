/** Product metadata describes existing modules. Source file inventories are derived at build time. */
export const MODULES=[
 {id:'core',title:'Ядро и композиция',text:'Время, зависимости и владение. Модули подключаются обычным TypeScript.',example:'kernel',view:'План исполнения',groups:['core']},
 {id:'procedural',title:'Процедурная геометрия',text:'Параметры формы, неизменяемые меши и локальное обновление динамических вершин.',example:'m3',view:'Геометрия ↔ параметры',groups:['procedural','assets']},
 {id:'physics',title:'Физика',text:'Один владелец массы. Контакты, силы, ограничения и деформируемая структура.',example:'collision',view:'Контакты и тела',groups:['physics']},
 {id:'vehicles',title:'Транспорт',text:'Колёса, подвеска и крылья складывают силы на одном физическом теле.',example:'wings',view:'Деталь ↔ конструкция',groups:['vehicles']},
 {id:'materials',title:'Материалы',text:'Механические, оптические и акустические свойства общей модели материала.',example:'materials',view:'Покрытие ↔ образец',groups:['materials']},
 {id:'environment',title:'Окружение',text:'Вода, снег, температура и контактные следы в состоянии поверхности.',example:'snow',view:'Поверхность ↔ среда',groups:['environment']},
 {id:'animation',title:'Движение',text:'Походка и поза — представления состояния, а не второе физическое тело.',example:'walker',view:'Скелет и походка',groups:['animation']},
 {id:'render',title:'WebGPU',text:'Свет, материалы, отражения, динамические меши и измерение работы GPU.',example:'rendering',view:'Кадр ↔ оптика',groups:['render']},
 {id:'audio',title:'Звук',text:'Синтез удара, механизмов, шагов и окружения из фактов мира.',example:'glass',view:'Событие → звук',groups:['audio']},
 {id:'network',title:'Сетевое представление',text:'Явные проекции, ограниченные очереди и независимое время отображения.',example:'wings',view:'Authority / replica / replay',groups:['network']},
 {id:'dsl',title:'DSL и исходник',text:'Код и HUD редактируют одни литералы. Вычисляемые выражения не перезаписываются.',example:'m3',view:'TypeScript ↔ HUD',groups:['dsl']},
 {id:'runtime',title:'Исполнение и ввод',text:'Браузерный host, управление, установка сцены и освобождение ресурсов.',example:'drive',view:'Управление и диагностика',groups:['runtime','scene']},
 {id:'games',title:'Правила игры',text:'Шахматы реагируют на ход. Арена использует фиксированный физический шаг.',game:'chess',view:'Доска / фигура / партия',groups:['games','examples']},
];
