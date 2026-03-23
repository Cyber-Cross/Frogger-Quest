import React, { useRef, useEffect } from 'react';
import { Position, LaneType, Obstacle, PowerUp } from '../types';
import { GRID_WIDTH, TILE_SIZE } from '../constants';

interface CanvasBoardProps {
  laneConfig: LaneType[];
  obstacles: Obstacle[];
  frogPos: Position;
  powerUp: PowerUp | null;
}

export const CanvasBoard: React.FC<CanvasBoardProps> = ({ 
  laneConfig, 
  obstacles, 
  frogPos, 
  powerUp 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridHeight = laneConfig.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Lanes
    laneConfig.forEach((type, y) => {
      switch (type) {
        case 'goal': ctx.fillStyle = 'rgba(16, 185, 129, 0.2)'; break;
        case 'river': ctx.fillStyle = 'rgba(14, 165, 233, 0.3)'; break;
        case 'safe': ctx.fillStyle = 'rgba(120, 113, 108, 0.2)'; break;
        case 'road': ctx.fillStyle = 'rgba(30, 41, 59, 0.4)'; break;
        case 'start': ctx.fillStyle = 'rgba(22, 163, 74, 0.2)'; break;
        default: ctx.fillStyle = 'transparent';
      }
      ctx.fillRect(0, y * TILE_SIZE, GRID_WIDTH * TILE_SIZE, TILE_SIZE);
      
      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(0, y * TILE_SIZE, GRID_WIDTH * TILE_SIZE, TILE_SIZE);
    });

    // Draw Obstacles
    obstacles.forEach(obs => {
      ctx.font = `${TILE_SIZE * 0.8}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      if (obs.type === 'log') {
        // Logs are 3 tiles wide
        ctx.fillText(obs.emoji, (obs.x + 1.5) * TILE_SIZE, (obs.y + 0.5) * TILE_SIZE);
      } else {
        ctx.fillText(obs.emoji, (obs.x + 0.5) * TILE_SIZE, (obs.y + 0.5) * TILE_SIZE);
      }
    });

    // Draw Power-up
    if (powerUp) {
      ctx.font = `${TILE_SIZE * 0.7}px serif`;
      ctx.fillText('❤️', (powerUp.x + 0.5) * TILE_SIZE, (powerUp.y + 0.5) * TILE_SIZE);
    }

    // Draw Frog
    ctx.font = `${TILE_SIZE * 0.9}px serif`;
    ctx.fillText('🐸', (frogPos.x + 0.5) * TILE_SIZE, (frogPos.y + 0.5) * TILE_SIZE);

  }, [laneConfig, obstacles, frogPos, powerUp]);

  return (
    <canvas 
      ref={canvasRef}
      width={GRID_WIDTH * TILE_SIZE}
      height={gridHeight * TILE_SIZE}
      className="block"
    />
  );
};
