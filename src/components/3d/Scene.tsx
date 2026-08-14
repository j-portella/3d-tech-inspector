// src/components/3d/Scene.tsx
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { ComponentMesh } from './ComponentMesh';
import { useInspectorStore, SYSTEM_CONNECTIONS } from '../../store/useInspectorStore';
import { useCameraCommandStore } from '../../store/useCameraCommandStore';

function FlowingLine({
  start,
  end,
  hasIncident,
}: {
  start: [number, number, number];
  end: [number, number, number];
  hasIncident: boolean;
}) {
  // Sai da altura da base (y=-0.75 no ComponentMesh), não do bloco.
  const basePoint = (p: [number, number, number]): [number, number, number] => [p[0], -0.75, p[2]];
  const points: [number, number, number][] = [basePoint(start), basePoint(end)];

  const haloColor = hasIncident ? '#ef4444' : '#00e5ff';
  const coreColor = hasIncident ? '#fca5a5' : '#8fefff';

  return (
    <group>
      {/* Halo — linha larga e translúcida por trás, simula o brilho de luz.
          Opacidade/espessura reforçadas nos dois casos (azul e vermelho
          estavam fracos demais). */}
      <Line points={points} color={haloColor} lineWidth={hasIncident ? 10 : 7} transparent opacity={hasIncident ? 0.55 : 0.4} />
      {/* Núcleo — linha fina e sólida, bem acesa */}
      <Line points={points} color={coreColor} lineWidth={hasIncident ? 3 : 2.5} transparent opacity={1} />
    </group>
  );
}

// Estado de uma posição em coordenadas esféricas em torno do alvo da câmera
// (raio = distância, theta = ângulo horizontal, phi = ângulo vertical).
interface SphericalState {
  radius: number;
  theta: number;
  phi: number;
}

// Escuta os comandos de voz de câmera (aproximar/recuar/girar) e anima
// suavemente a posição da câmera em torno do alvo do OrbitControls.
function CameraVoiceController({ controlsRef }: { controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  const command = useCameraCommandStore((s) => s.command);
  const commandId = useCameraCommandStore((s) => s.commandId);

  const animRef = useRef<{
    active: boolean;
    from: SphericalState;
    to: SphericalState;
    t: number;
  }>({
    active: false,
    from: { radius: 0, theta: 0, phi: 0 },
    to: { radius: 0, theta: 0, phi: 0 },
    t: 0,
  });

  useEffect(() => {
    if (!command || !controlsRef.current) return;
    const controls = controlsRef.current;
    const target: THREE.Vector3 = controls.target;

    const offset = camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    const from: SphericalState = { radius: spherical.radius, theta: spherical.theta, phi: spherical.phi };
    const to: SphericalState = { ...from };

    const minDistance = controls.minDistance ?? 4;
    const maxDistance = controls.maxDistance ?? 30;

    if (command === 'zoom-in') {
      to.radius = THREE.MathUtils.clamp(from.radius * 0.72, minDistance, maxDistance);
    } else if (command === 'zoom-out') {
      to.radius = THREE.MathUtils.clamp(from.radius * 1.35, minDistance, maxDistance);
    } else if (command === 'rotate-left') {
      to.theta = from.theta - Math.PI / 4; // 45 graus
    } else if (command === 'rotate-right') {
      to.theta = from.theta + Math.PI / 4;
    }

    animRef.current = { active: true, from, to, t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandId]);

  useFrame((_, delta) => {
    const anim = animRef.current;
    if (!anim.active || !controlsRef.current) return;

    anim.t = Math.min(anim.t + delta / 0.5, 1); // ~0.5s de animação
    const eased = 1 - Math.pow(1 - anim.t, 3); // ease-out cúbico

    const radius = THREE.MathUtils.lerp(anim.from.radius, anim.to.radius, eased);
    const theta = THREE.MathUtils.lerp(anim.from.theta, anim.to.theta, eased);
    const phi = THREE.MathUtils.lerp(anim.from.phi, anim.to.phi, eased);

    const target: THREE.Vector3 = controlsRef.current.target;
    const offset = new THREE.Vector3().setFromSphericalCoords(radius, phi, theta);

    camera.position.copy(target).add(offset);
    camera.lookAt(target);
    controlsRef.current.update();

    if (anim.t >= 1) {
      anim.active = false;
    }
  });

  return null;
}

// Controla a câmera continuamente com base na telemetria das duas mãos
// (só ativa quando a peça está ampliada — ver HandTracker). Usa a MESMA
// matemática esférica do CameraVoiceController acima, mas em vez de animar
// até um alvo fixo uma vez, aplica a variação frame a frame direto.
function TwoHandCameraController({ controlsRef }: { controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  const prevGestureRef = useRef<{ distance: number; midX: number; midY: number } | null>(null);

  useFrame(() => {
    const gesture = useCameraCommandStore.getState().twoHandGesture;
    if (!gesture || !gesture.active || !controlsRef.current) {
      prevGestureRef.current = null;
      return;
    }

    const controls = controlsRef.current;
    const target: THREE.Vector3 = controls.target;
    const offset = camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    if (prevGestureRef.current) {
      const deltaDistance = gesture.handDistance - prevGestureRef.current.distance;
      const deltaMidX = gesture.midpointX - prevGestureRef.current.midX;
      const deltaMidY = gesture.midpointY - prevGestureRef.current.midY;

      const minDistance = controls.minDistance ?? 4;
      const maxDistance = controls.maxDistance ?? 30;

      // Zoom: mãos se afastando (deltaDistance positivo) aproxima a câmera.
      // Sensibilidades abaixo são estimativas — ajustar após teste real.
      const ZOOM_SENSITIVITY = 14;
      spherical.radius = THREE.MathUtils.clamp(
        spherical.radius - deltaDistance * ZOOM_SENSITIVITY,
        minDistance,
        maxDistance
      );

      // Girar: ponto médio das mãos se movendo na horizontal gira a câmera
      const ROTATE_SENSITIVITY = 6;
      spherical.theta -= deltaMidX * ROTATE_SENSITIVITY;

      // Subir/descer: ponto médio se movendo na vertical ajusta o ângulo polar
      const VERTICAL_SENSITIVITY = 6;
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi - deltaMidY * VERTICAL_SENSITIVITY,
        0.15,
        Math.PI / 2.1
      );

      const newOffset = new THREE.Vector3().setFromSphericalCoords(
        spherical.radius,
        spherical.phi,
        spherical.theta
      );
      camera.position.copy(target).add(newOffset);
      camera.lookAt(target);
      controls.update();
    }

    prevGestureRef.current = {
      distance: gesture.handDistance,
      midX: gesture.midpointX,
      midY: gesture.midpointY,
    };
  });

  return null;
}

export function Scene() {
  const components = useInspectorStore((state) => state.components);
  const viewMode = useInspectorStore((state) => state.viewMode);
  const activeIncident = useInspectorStore((state) => state.activeIncident);
  const controlsRef = useRef<any>(null);

  const findPosition = (id: string) => components.find((c) => c.id === id)?.defaultPosition;

  return (
    <div className="w-full h-full relative bg-transparent">
      <Canvas
        camera={{ position: [0, 12.5, 11], fov: 42 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0); // Fundo 100% transparente para mostrar a câmera atrás
        }}
      >
        <ambientLight intensity={1.2} />
        <directionalLight position={[10, 15, 10]} intensity={1.8} />
        <pointLight position={[0, 6, 0]} intensity={2.5} color="#00e5ff" />

        {/* Grade do chão transparente */}
        <Grid
          position={[0, -0.72, 0]}
          args={[18, 18]}
          cellColor="#00e5ff"
          sectionColor="#3b82f6"
          fadeDistance={22}
          cellThickness={0.5}
          sectionThickness={1}
        />

        {/* Linhas de Fluxo — hub-e-raios a partir do SAP. Só na vista padrão:
             durante ampliar/isolar, as outras peças ficam ocultas, então
             mostrar a linha viraria um raio "órfão" apontando pro nada. */}
        {viewMode === 'default' && SYSTEM_CONNECTIONS.map(([fromId, toId]) => {
          const start = findPosition(fromId);
          const end = findPosition(toId);
          if (!start || !end) return null;
          const hasIncident = activeIncident?.componentId === fromId || activeIncident?.componentId === toId;
          return (
            <FlowingLine
              key={`flow-${fromId}-${toId}`}
              start={start}
              end={end}
              hasIncident={hasIncident}
            />
          );
        })}

        {/* Módulos 3D */}
        {components.map((component) => (
          <ComponentMesh
            key={component.id}
            component={component}
            onDragStart={() => {
              // Desliga o OrbitControls enquanto arrasta, senão a câmera
              // gira/dá zoom junto com o movimento do mouse.
              if (controlsRef.current) controlsRef.current.enabled = false;
            }}
            onDragEnd={() => {
              if (controlsRef.current) controlsRef.current.enabled = true;
            }}
          />
        ))}

        <OrbitControls
          ref={controlsRef}
          enablePan={true}
          enableZoom={true}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={4}
          maxDistance={30}
        />

        {/* Escuta comandos de voz (aproximar/recuar/girar) e move a câmera */}
        <CameraVoiceController controlsRef={controlsRef} />

        {/* Controle contínuo de câmera com duas mãos (zoom/girar/altura),
            só ativo quando a peça está ampliada */}
        <TwoHandCameraController controlsRef={controlsRef} />

        {/* Bloom de verdade — antes o brilho neon era "fingido" só com
            opacidade/emissive nos materiais. luminanceThreshold alto pra
            não borrar o vídeo da câmera atrás, só as partes bem brilhantes
            (bordas, linhas, ícones) da cena 3D. */}
        <EffectComposer>
          <Bloom
            intensity={0.7}
            luminanceThreshold={0.15}
            luminanceSmoothing={0.4}
            mipmapBlur
            radius={0.6}
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}