import { LaneType } from './types';

export const GRID_WIDTH = 20;
export const TILE_SIZE = 32; // px
export const INITIAL_LIVES = 3;
export const SPEED_INCREMENT_THRESHOLD = 3; // Level up every 3 points for faster progression

export const getLaneConfig = (level: number): LaneType[] => {
  const riverLanes = level >= 10 ? 4 : (level >= 5 ? 3 : 2);
  const roadLanes = level >= 10 ? 5 : (level >= 5 ? 4 : 3);
  
  const lanes: LaneType[] = [];
  lanes.push('goal');
  for (let i = 0; i < riverLanes; i++) lanes.push('river');
  lanes.push('safe');
  for (let i = 0; i < roadLanes; i++) lanes.push('road');
  lanes.push('start');
  
  return lanes;
};

export const SOUNDS = {
  jump: 'jump',
  collision: 'collision',
  win: 'win',
  powerup: 'powerup',
  levelup: 'levelup'
} as const;
