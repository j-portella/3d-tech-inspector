// src/store/useCameraCommandStore.ts
//
// Canal simples entre o reconhecimento de voz/gestos (HandTracker, fora do
// Canvas) e a câmera 3D (Scene.tsx, dentro do Canvas). O HandTracker não tem
// acesso direto à câmera/OrbitControls, então ele só "grita" aqui, e o
// Scene.tsx escuta e executa o movimento.
import { create } from 'zustand';

export type CameraCommand = 'zoom-in' | 'zoom-out' | 'rotate-left' | 'rotate-right';

// Telemetria contínua das duas mãos, pra controle de câmera em tempo real
// (zoom/girar/subir enquanto a peça está ampliada). Diferente do CameraCommand
// acima (que dispara UMA VEZ e anima até um alvo fixo), isso é lido a cada
// frame direto via getState() — nem HandTracker nem Scene re-renderizam por
// causa disso, só o loop de animação do Three.js consome o valor mais recente.
export interface TwoHandGesture {
  active: boolean;
  handDistance: number; // distância entre as mãos, normalizada pela largura da tela (0-1)
  midpointX: number; // ponto médio entre as mãos, normalizado (0-1)
  midpointY: number;
}

interface CameraCommandState {
  command: CameraCommand | null;
  // Incrementa a cada comando, mesmo se for repetido (ex: "aproximar" duas
  // vezes seguidas) — assim o efeito que escuta sempre percebe a mudança.
  commandId: number;
  triggerCommand: (command: CameraCommand) => void;
  twoHandGesture: TwoHandGesture | null;
  setTwoHandGesture: (gesture: TwoHandGesture | null) => void;
}

export const useCameraCommandStore = create<CameraCommandState>((set, get) => ({
  command: null,
  commandId: 0,
  triggerCommand: (command) => set({ command, commandId: get().commandId + 1 }),
  twoHandGesture: null,
  setTwoHandGesture: (gesture) => set({ twoHandGesture: gesture }),
}));