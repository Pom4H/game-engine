import type {SceneSpec} from './types.js';
import {validateScene} from './validate.js';

/** Type-friendly scene authoring with runtime validation and a detached immutable input value. */
export function defineScene(scene:SceneSpec):SceneSpec{return validateScene(scene);}
