// src/components/3d/ComponentMesh.tsx
import { useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Edges, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { ITComponent } from '../../types/inspector';
import { useInspectorStore } from '../../store/useInspectorStore';

// Bloco holográfico de um módulo: cubo sólido semi-transparente com borda
// nítida, girando continuamente enquanto visível. Componente separado
// porque cada bloco precisa do seu próprio useFrame (não dá pra girar N
// blocos independentes com uma única ref).
function ModuleBlock({ color, label, side }: { color: string; label: string; side: 'left' | 'right' }) {
  const blockRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (blockRef.current) {
      blockRef.current.rotation.y += delta * 0.7;
      blockRef.current.rotation.x += delta * 0.25;
    }
  });

  // Cubo fica do lado voltado pro centro da peça; o texto fica do lado de
  // fora. Gap generoso de propósito: Html sempre desenha por cima da cena
  // 3D (não respeita profundidade), então se o texto for comprido a caixa
  // dele cobria o cubo mesmo com distância pequena.
  const iconX = side === 'left' ? 0.55 : -0.55;
  const labelX = side === 'left' ? -0.95 : 0.95;

  return (
    <group>
      <mesh ref={blockRef} position={[iconX, 0, 0]}>
        <boxGeometry args={[0.26, 0.26, 0.26]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.35}
          roughness={0.2}
          metalness={0.3}
        />
        <Edges scale={1.02} color={color} />
      </mesh>
      <Html position={[labelX, 0, 0]} center transform distanceFactor={6.5}>
        <div
          className="pointer-events-none bg-slate-950/95 border-2 rounded-lg px-3 py-1.5 text-[10px] font-bold text-white whitespace-nowrap"
          style={{ borderColor: color, boxShadow: `0 0 10px ${color}88` }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

// Linha de energia (tracejado animado) do núcleo até um módulo.
// Reaproveita o mesmo padrão de animação de dashOffset já usado e
// validado no FlowingLine do Scene.tsx.
function ModuleConnectorLine({
  color,
  to,
  isOpen,
}: {
  color: string;
  to: [number, number, number];
  isOpen: boolean;
}) {
  const lineRef = useRef<any>(null);

  useFrame((_, delta) => {
    if (lineRef.current?.material) {
      lineRef.current.material.dashOffset -= delta * 1.4;
      lineRef.current.material.opacity = THREE.MathUtils.lerp(
        lineRef.current.material.opacity,
        isOpen ? 0.75 : 0,
        delta * 5
      );
    }
  });

  return (
    <Line
      ref={lineRef}
      points={[[0, 0, 0], to]}
      color={color}
      lineWidth={1.5}
      dashed
      dashSize={0.08}
      gapSize={0.06}
      dashScale={4}
      transparent
      opacity={0}
    />
  );
}

// Um "slot" de módulo: anima sozinho da abertura (entre a base e a tampa)
// até a posição final na coluna esquerda/direita, dando a sensação de que
// o módulo está saindo de dentro da peça, não só aparecendo do nada.
function ModuleSlot({
  finalPosition,
  isOpen,
  color,
  label,
  side,
}: {
  finalPosition: [number, number, number];
  isOpen: boolean;
  color: string;
  label: string;
  side: 'left' | 'right';
}) {
  const slotRef = useRef<THREE.Group>(null);
  // Ponto de partida: mesma coluna (x/z), mas bem mais baixo, perto da
  // abertura entre base e tampa.
  const startY = finalPosition[1] - 0.4;

  useFrame((_, delta) => {
    if (!slotRef.current) return;
    const targetY = isOpen ? finalPosition[1] : startY;
    slotRef.current.position.y = THREE.MathUtils.lerp(slotRef.current.position.y, targetY, delta * 5);

    const targetScale = isOpen ? 1 : 0;
    const s = THREE.MathUtils.lerp(slotRef.current.scale.x, targetScale, delta * 6);
    slotRef.current.scale.setScalar(s);
    slotRef.current.visible = s > 0.02;
  });

  return (
    <group ref={slotRef} position={[finalPosition[0], startY, finalPosition[2]]} scale={0}>
      <ModuleBlock color={color} label={label} side={side} />
    </group>
  );
}

interface Props {
  component: ITComponent;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

// Plano do chão (y=0) usado pra converter a posição do ponteiro (2D) numa
// posição 3D durante o arraste. Fica fora do componente pra não recriar o
// objeto Plane a cada render.
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function ComponentMesh({ component, onDragStart, onDragEnd }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const cardHolderRef = useRef<THREE.Group>(null);
  const rimGlowRef = useRef<THREE.Mesh>(null);
  const moduleRingRef = useRef<THREE.Group>(null);
  const scanRingRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const bodyLidRef = useRef<THREE.Mesh>(null);
  const incidentGlowRef = useRef<THREE.Mesh>(null);
  const coreGlowRef = useRef<THREE.Mesh>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3());

  const { raycaster } = useThree();
  const { selectedComponentId, viewMode, isolatedComponentId, selectComponent, updateComponentPosition } =
    useInspectorStore();

  const isSelected = selectedComponentId === component.id;
  const isExploded = viewMode === 'exploded';
  const hasSelection = !!selectedComponentId;
  // Bancos de dados (SQL, Oracle) usam cilindro redondo, não a torre
  // hexagonal dos demais sistemas — usa o campo semântico já existente
  // (component.type), em vez de comparar IDs na unha.
  const isDatabase = component.type === 'database';

  // Posição alvo do grupo principal no espaço
  let targetPos = new THREE.Vector3(...component.defaultPosition);
  if (isExploded && hasSelection) {
    // Com um componente selecionado, apenas ELE vem para o centro/frente.
    // Os demais permanecem na posição padrão (e serão ocultados abaixo).
    targetPos = isSelected
      ? new THREE.Vector3(0, 0, 0)
      : new THREE.Vector3(...component.defaultPosition);
  } else if (isExploded) {
    // Ninguém selecionado ainda: mantém a visão geral explodida de todos.
    targetPos = new THREE.Vector3(...component.explodedPosition);
  } else if (viewMode === 'isolated') {
    targetPos = component.id === isolatedComponentId
      ? new THREE.Vector3(0, 0, 0)
      : new THREE.Vector3(...component.defaultPosition);
  }

  // Peça "aberta" = selecionada e em modo exploded (ou nada selecionado ainda).
  // Isolar NÃO conta como "aberta" — só mostra a peça no estado normal, sem
  // revelar o anel de módulos (era um pedido explícito: isolar ≠ explodir).
  const isOpen = isExploded && (isSelected || !hasSelection);

  // Esconde os componentes que não devem aparecer no modo atual:
  //  - exploded: esconde todos, exceto o selecionado (se houver seleção)
  //  - isolated: esconde todos, exceto o isolado
  // BUG CORRIGIDO: antes, o modo 'isolated' nunca escondia ninguém — só
  // movia a peça isolada pro centro, deixando as outras 6 visíveis do
  // mesmo jeito, o que fazia a tela parecer idêntica ao modo 'default'.
  const shouldHide =
    (isExploded && hasSelection && !isSelected) ||
    (viewMode === 'isolated' && component.id !== isolatedComponentId);
  const targetScale = shouldHide ? 0.001 : 1;

  // Animação suave
  useFrame((state, delta) => {
    if (groupRef.current) {
      // Enquanto arrastando, a posição é controlada diretamente pelo
      // handler de pointermove — não deixa o lerp "brigar" com o arraste.
      if (!isDraggingRef.current) {
        groupRef.current.position.lerp(targetPos, delta * 4);
      }

      const currentScale = groupRef.current.scale.x;
      const newScale = THREE.MathUtils.lerp(currentScale, targetScale, delta * 6);
      groupRef.current.scale.setScalar(newScale);
      // Desativa cliques/raycasts em componentes praticamente invisíveis
      groupRef.current.visible = newScale > 0.02;
    }

    // Card holográfico sobe um pouco quando a peça está aberta
    if (cardHolderRef.current) {
      const targetY = isOpen ? 1.3 : 1.0;
      cardHolderRef.current.position.y = THREE.MathUtils.lerp(
        cardHolderRef.current.position.y,
        targetY,
        delta * 5
      );
    }

    // Anel de brilho na base — invisível por padrão, só aparece (sólido)
    // quando a peça está selecionada.
    if (rimGlowRef.current) {
      const material = rimGlowRef.current.material as THREE.MeshBasicMaterial;
      const targetOpacity = isSelected ? 1 : 0;
      material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, delta * 5);
    }

    // Anel de escaneamento holográfico — gira continuamente enquanto aberto
    if (scanRingRef.current) {
      if (isOpen) {
        scanRingRef.current.rotation.z += delta * 0.7;
      }
      const material = scanRingRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.lerp(material.opacity, isOpen ? 0.85 : 0, delta * 4);
    }

    // Feixe de luz vertical — efeito de projeção holográfica
    if (beamRef.current) {
      const material = beamRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.lerp(material.opacity, isOpen ? 0.16 : 0, delta * 4);
    }

    // Tampa — desliza pra cima quando aberto, revelando a fresta de onde
    // os módulos "saem". Fechado, encaixa de volta formando o corpo único.
    if (bodyLidRef.current) {
      const targetLidY = isOpen ? 0.7 : 0.25;
      bodyLidRef.current.position.y = THREE.MathUtils.lerp(bodyLidRef.current.position.y, targetLidY, delta * 4);
    }

    // Contorno vermelho pulsante — só quando o sistema está com incidente
    // ativo (status 'warning'), pra chamar atenção mesmo de longe/fechado.
    if (incidentGlowRef.current) {
      const hasIncident = component.status === 'warning' || component.status === 'error';
      const material = incidentGlowRef.current.material as THREE.MeshBasicMaterial;
      if (hasIncident) {
        const pulse = (Math.sin(state.clock.elapsedTime * 4) + 1) / 2; // oscila 0 -> 1
        material.opacity = THREE.MathUtils.lerp(material.opacity, 0.25 + pulse * 0.45, delta * 8);
        incidentGlowRef.current.visible = true;
      } else {
        material.opacity = THREE.MathUtils.lerp(material.opacity, 0, delta * 6);
        incidentGlowRef.current.visible = material.opacity > 0.02;
      }
    }

    // Brilho do núcleo — aparece na fresta entre base e tampa quando abre
    if (coreGlowRef.current) {
      const material = coreGlowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.lerp(material.opacity, isOpen ? 0.9 : 0, delta * 4);
    }
  });

  // Arraste só faz sentido na vista padrão — durante explodir/isolar a
  // posição já está sendo controlada pela lógica de targetPos acima.
  const dragEnabled = viewMode === 'default';

  const raycastGroundPoint = (): THREE.Vector3 | null => {
    const point = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(GROUND_PLANE, point);
    return hit ? point : null;
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!dragEnabled || !groupRef.current) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);

    const groundPoint = raycastGroundPoint();
    if (!groundPoint) return;

    // Offset entre o ponto clicado no chão e a posição atual da peça,
    // pra ela não "pular" fazendo o centro saltar pro cursor.
    dragOffsetRef.current.copy(groupRef.current.position).sub(groundPoint);
    isDraggingRef.current = true;
    onDragStart?.();
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDraggingRef.current || !groupRef.current) return;
    e.stopPropagation();

    const groundPoint = raycastGroundPoint();
    if (!groundPoint) return;

    const newPos = groundPoint.add(dragOffsetRef.current);
    groupRef.current.position.set(newPos.x, 0, newPos.z);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDraggingRef.current) return;
    e.stopPropagation();
    (e.target as Element).releasePointerCapture(e.pointerId);

    isDraggingRef.current = false;
    onDragEnd?.();

    if (groupRef.current) {
      updateComponentPosition(component.id, [
        groupRef.current.position.x,
        0,
        groupRef.current.position.z,
      ]);
    }
  };

  const getIcon = () => {
    switch (component.id) {
      case 'sap':
        // ERP: camadas empilhadas (módulos integrados)
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="4" width="16" height="4" rx="1" />
            <rect x="6" y="10" width="12" height="4" rx="1" />
            <rect x="8" y="16" width="8" height="4" rx="1" />
          </svg>
        );
      case 'totvs-protheus':
        // ERP: rede de módulos interligados
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="5" r="2.2" />
            <circle cx="5" cy="18" r="2.2" />
            <circle cx="19" cy="18" r="2.2" />
            <path d="M12 7.2 L6.3 16.2 M12 7.2 L17.7 16.2 M7.2 18 L16.8 18" />
          </svg>
        );
      case 'salesforce':
        // CRM: nuvem com contato central
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.3-2A5 5 0 0 0 6.5 19h11z" />
            <circle cx="12" cy="14" r="1.6" fill="currentColor" stroke="none" />
          </svg>
        );
      case 'aws':
        // Cloud: nuvem com bloco de computação
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.3-2A5 5 0 0 0 6.5 19h11z" />
            <rect x="9.5" y="12" width="5" height="4" rx="0.6" fill="currentColor" stroke="none" />
          </svg>
        );
      case 'google-cloud':
        // Cloud: nuvem com nó de dados
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.3-2A5 5 0 0 0 6.5 19h11z" />
            <path d="M9.5 15.5 12 12 14.5 15.5 12 17.5z" fill="currentColor" stroke="none" />
          </svg>
        );
      case 'sql':
        // Banco de dados: cilindro simples
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <ellipse cx="12" cy="6" rx="7" ry="3" />
            <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
            <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" />
          </svg>
        );
      case 'oracle':
        // Banco de dados: dois cilindros empilhados (instâncias)
        return (
          <svg className="w-6 h-6 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <ellipse cx="12" cy="5" rx="6.5" ry="2.4" />
            <path d="M5.5 5v5.5c0 1.33 2.9 2.4 6.5 2.4s6.5-1.07 6.5-2.4V5" />
            <ellipse cx="12" cy="13.4" rx="6.5" ry="2.4" />
            <path d="M5.5 13.4v5.2c0 1.33 2.9 2.4 6.5 2.4s6.5-1.07 6.5-2.4v-5.2" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <group ref={groupRef} position={component.defaultPosition}>
      {/* 1. BASE (landing pad) — cinza metálico, igual pra todos os sistemas
             (confirmado: não varia por sistema, só o corpo acima varia). */}
      <mesh position={[0, -0.75, 0]}>
        <boxGeometry args={[2.0, 0.1, 2.0]} />
        <meshStandardMaterial color="#8b93a1" roughness={0.35} metalness={0.85} />
        <Edges scale={1.005} color="#475569" />
      </mesh>

      {/* 2. CORPO — dividido em BASE fixa e TAMPA que desliza pra cima ao
             ampliar, revelando uma fresta com brilho (o "abrir de verdade"
             que você pediu, em vez de só materializar os módulos no ar). */}
      {/* 2a. Base fixa */}
      <mesh
        position={[0, -0.35, 0]}
        onClick={(e) => { e.stopPropagation(); selectComponent(component.id); }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerOver={() => {
          if (dragEnabled) document.body.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        {isDatabase ? (
          <cylinderGeometry args={[0.75, 0.75, 0.7, 32]} />
        ) : (
          <boxGeometry args={[1.4, 0.7, 1.4]} />
        )}
        <meshStandardMaterial color="#0a0e17" roughness={0.3} metalness={0.65} />
        <Edges scale={1.005} color={component.color} />
      </mesh>

      {/* 2b. Tampa — em repouso encaixa perfeitamente na base (mesmo
             contorno externo); ao ampliar, sobe e revela a fresta. */}
      <mesh
        ref={bodyLidRef}
        position={[0, 0.25, 0]}
        onClick={(e) => { e.stopPropagation(); selectComponent(component.id); }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {isDatabase ? (
          <cylinderGeometry args={[0.75, 0.75, 0.5, 32]} />
        ) : (
          <boxGeometry args={[1.4, 0.5, 1.4]} />
        )}
        <meshStandardMaterial color="#0a0e17" roughness={0.3} metalness={0.65} />
        <Edges scale={1.005} color={component.color} />
      </mesh>

      {/* 2c. Brilho do núcleo — preenche a fresta quando aberto. Formato
             acompanha o corpo: círculo pros bancos de dados (cilindro),
             quadrado pros demais (caixa) — um círculo dentro de uma fresta
             quadrada ficava parecendo um "buraco" errado. */}
      <mesh ref={coreGlowRef} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {isDatabase ? (
          <circleGeometry args={[0.72, 32]} />
        ) : (
          <planeGeometry args={[1.36, 1.36]} />
        )}
        <meshBasicMaterial color={component.color} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 2c-bis. CONTORNO DE INCIDENTE — envolve base+tampa juntas, pulsa em
             vermelho enquanto o sistema está com status 'warning'/'error'.
             Some por completo quando não há incidente. */}
      <mesh ref={incidentGlowRef} position={[0, -0.1, 0]} visible={false} scale={1.06}>
        {isDatabase ? (
          <cylinderGeometry args={[0.75, 0.75, 1.2, 32]} />
        ) : (
          <boxGeometry args={[1.4, 1.2, 1.4]} />
        )}
        <meshBasicMaterial color="#ef4444" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* 2d. ANÉIS DO CILINDRO — só nos bancos de dados: as linhas horizontais
             que fazem o cilindro ser reconhecível como ícone de banco de
             dados (discos empilhados). Ficam dentro da faixa da BASE fixa
             (-0.7 a 0) de propósito — senão, com a tampa subindo, um dos
             anéis ficaria "flutuando" desgrudado da peça. */}
      {isDatabase && (
        <>
          <mesh position={[0, -0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.75, 0.015, 8, 32]} />
            <meshBasicMaterial color={component.color} />
          </mesh>
          <mesh position={[0, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.75, 0.015, 8, 32]} />
            <meshBasicMaterial color={component.color} />
          </mesh>
        </>
      )}

      {/* 3. ANEL DE BRILHO — o "acento" colorido embaixo de cada peça, só quando selecionada */}
      <mesh ref={rimGlowRef} position={[0, -0.76, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.0, 1.1, 32]} />
        <meshBasicMaterial color={component.color} transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 4. Anel de seleção no chão (mais amplo, só quando selecionado) */}
      {isSelected && (
        <mesh position={[0, -0.77, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.3, 1.45, 32]} />
          <meshBasicMaterial color={component.color} transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* 5. HASTE — conector fino entre o topo da torre e o card flutuante */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 8]} />
        <meshBasicMaterial color={component.color} transparent opacity={0.6} />
      </mesh>

      {/* 6. CARD HOLOGRÁFICO — ícone + nome, sempre visível, flutuando acima do pedestal */}
      <group ref={cardHolderRef} position={[0, 1.0, 0]}>
        <Html
          position={[0, 0, 0]}
          rotation={[-Math.PI / 9, 0, 0]}
          transform
          center
          distanceFactor={6}
          onClick={() => selectComponent(component.id)}
        >
          <div
            data-component-id={component.id}
            className={`component-card w-28 rounded-2xl text-center cursor-pointer transition-all duration-300 pointer-events-auto bg-slate-950/95 border backdrop-blur-sm
              ${isSelected ? 'scale-105 border-2' : 'border'}`}
            style={{
              borderColor: component.color,
              boxShadow: isSelected || isOpen
                ? `0 0 18px ${component.color}aa, 0 0 4px ${component.color}`
                : `0 0 8px ${component.color}55`,
            }}
          >
            <div className="pt-2.5 flex justify-center">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${component.color}22`, color: component.color }}
              >
                {getIcon()}
              </div>
            </div>
            <div className="px-2 pb-2 pt-1">
              <div className="text-[9.5px] font-extrabold tracking-wider text-white uppercase truncate">
                {component.name}
              </div>
              <div className="text-[7.5px] font-medium text-slate-400">
                {component.tech}
              </div>
            </div>
          </div>
        </Html>
      </group>

      {/* 7. MÓDULOS — duas colunas fixas (esquerda/direita), cada um subindo
             da fresta entre base e tampa. Antes era uma roda de 360°, o que
             fazia alguns nomes caírem atrás da peça e ficarem ilegíveis. */}
      <group ref={moduleRingRef} position={[0, 0.15, 0]}>
        {(() => {
          const COLUMN_X = 2.1; // era 3.4 — ficava desproporcional/longe demais do corpo
          const ROW_SPACING = 0.6;
          const leftCount = Math.ceil(component.modules.length / 2);
          const leftModules = component.modules.slice(0, leftCount);
          const rightModules = component.modules.slice(leftCount);

          // Grade de linhas COMPARTILHADA entre as duas colunas — antes cada
          // lado centralizava a própria lista sozinho, então com contagens
          // diferentes (ex: 2 à esquerda, 1 à direita) as linhas não batiam
          // entre si e ficava com cara de desalinhado.
          const maxRows = Math.max(leftModules.length, rightModules.length);
          const gridSpan = (maxRows - 1) * ROW_SPACING;

          const layoutColumn = (mods: string[], side: 'left' | 'right') => {
            const x = side === 'left' ? -COLUMN_X : COLUMN_X;
            return mods.map((mod, i) => {
              const y = gridSpan / 2 - i * ROW_SPACING;
              // Zig-zague de profundidade removido: dependia de como a
              // câmera projeta profundidade em cada ângulo, e em alguns
              // casos colidia em vez de separar (imprevisível sem poder
              // renderizar). Só a altura (Y) separa os módulos agora —
              // menos "dramático" visualmente, mas confiável.
              const position: [number, number, number] = [x, y, 0];
              return { mod, position, side };
            });
          };

          const slots = [...layoutColumn(leftModules, 'left'), ...layoutColumn(rightModules, 'right')];
          // Mesmo deslocamento usado dentro do ModuleBlock — a linha precisa
          // mirar no TEXTO de verdade, não no centro solto do slot (que não
          // é nem o cubo nem o texto, causava a linha "flutuando" no vácuo).
          const LABEL_OFFSET = 0.95;

          return slots.map(({ mod, position, side }) => {
            const labelTarget: [number, number, number] = [
              position[0] + (side === 'left' ? -LABEL_OFFSET : LABEL_OFFSET),
              position[1],
              position[2],
            ];
            return (
              <group key={mod}>
                <ModuleConnectorLine color={component.color} to={labelTarget} isOpen={isOpen} />
                <ModuleSlot finalPosition={position} isOpen={isOpen} color={component.color} label={mod} side={side} />
              </group>
            );
          });
        })()}
      </group>

      {/* 8. ANEL DE ESCANEAMENTO — gira continuamente enquanto a peça está aberta */}
      <mesh ref={scanRingRef} position={[0, -0.78, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.75, 0.012, 8, 64]} />
        <meshBasicMaterial color={component.color} transparent opacity={0} />
      </mesh>

      {/* 9. FEIXE HOLOGRÁFICO — projeção vertical estilo "hologram", some quando fechado */}
      <mesh ref={beamRef} position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.5, 0.05, 2.2, 24, 1, true]} />
        <meshBasicMaterial
          color={component.color}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}