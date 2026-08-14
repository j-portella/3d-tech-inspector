// src/components/ui/HandTracker.tsx
import { useEffect, useRef, useState } from 'react';
import type { Results, Hands as HandsType } from '@mediapipe/hands';
import { useInspectorStore } from '../../store/useInspectorStore';
import { useCameraCommandStore } from '../../store/useCameraCommandStore';

// Hands, HAND_CONNECTIONS e Camera vêm de <script> em index.html (globais em
// window), não de import de módulo — o pacote @mediapipe/hands quebra
// especificamente em build de produção do Vite quando importado como ESM
// ("X.Hands is not a constructor"). Só o TIPO é importado acima (apagado
// no build, não tem esse problema).
const Hands = (window as any).Hands as new (config: { locateFile: (file: string) => string }) => HandsType;
const HAND_CONNECTIONS = (window as any).HAND_CONNECTIONS as [number, number][];
const Camera = (window as any).Camera as new (
  videoElement: HTMLVideoElement,
  config: { onFrame: () => Promise<void>; width: number; height: number }
) => { start: () => Promise<void>; stop: () => void };

// Apelidos por voz para cada componente (normalizados: minúsculas, sem acento).
// Cobrem o nome completo, variações curtas e a tecnologia, pra reconhecer
// mesmo que o usuário fale só um pedaço do nome.
const COMPONENT_VOICE_ALIASES: Record<string, string[]> = {
  'sap': ['sap'],
  'totvs-protheus': ['totvs protheus', 'protheus', 'totvs'],
  'salesforce': ['salesforce', 'sales force'],
  'aws': ['aws', 'amazon web services', 'amazon'],
  'google-cloud': ['google cloud', 'gcp'],
  'sql': ['sql', 'banco sql', 'banco de dados sql'],
  'oracle': ['oracle'],
};

function normalizeVoiceText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim();
}

// Encontra o componente cujo apelido aparece no transcript falado.
// Ordena por tamanho de apelido (maior primeiro) pra evitar falso positivo
// (ex: "pagamentos" bater antes de "pedido" quando ambos aparecem).
function findComponentIdByVoice(normalizedTranscript: string): string | null {
  let bestMatch: { id: string; length: number } | null = null;
  for (const [id, aliases] of Object.entries(COMPONENT_VOICE_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeVoiceText(alias);
      if (normalizedTranscript.includes(normalizedAlias)) {
        if (!bestMatch || normalizedAlias.length > bestMatch.length) {
          bestMatch = { id, length: normalizedAlias.length };
        }
      }
    }
  }
  return bestMatch?.id ?? null;
}

export function HandTracker() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isActive] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [lastCommand, setLastCommand] = useState<string>('Aponte o indicador: selecionar | Mão aberta: ampliar | Fale o nome do sistema');
  const [audioError, setAudioError] = useState<string | null>(null);
  const [visionError, setVisionError] = useState<string | null>(null);
  const isPinchingRef = useRef(false);
  const lastGestureTriggerRef = useRef<number>(0);
  const isHandSpreadRef = useRef(false);
  const lastExplodeGestureTriggerRef = useRef<number>(0);
  const handSpreadStartRef = useRef<number | null>(null);
  const lastPointedIdRef = useRef<string | null>(null);
  const pinchHoldStartRef = useRef<number | null>(null);
  const pinchHoldTriggeredRef = useRef(false);
  const lastDebugUpdateRef = useRef<number>(0);

  const {
    setViewMode,
    resetView,
    selectedComponentId,
    selectComponent,
    isolateComponent,
    viewMode,
    triggerRandomIncident,
    clearIncident,
  } = useInspectorStore();
  const triggerCameraCommand = useCameraCommandStore((s) => s.triggerCommand);

  // Ref sempre atualizada com o valor mais recente, sem forçar o efeito
  // de voz a ser recriado toda vez que a seleção mudar.
  const selectedComponentIdRef = useRef(selectedComponentId);
  useEffect(() => {
    selectedComponentIdRef.current = selectedComponentId;
  }, [selectedComponentId]);

  // Mesma ideia para o viewMode: os comandos de câmera (zoom/girar) só valem
  // quando a peça está explodida, mas não queremos recriar o reconhecimento
  // de voz toda vez que o modo mudar.
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // --- RECONHECIMENTO DE VOZ CONTÍNUO E ROBUSTO ---
  useEffect(() => {
    // Mic desligado: nem cria o reconhecimento. Simples e previsível — nada
    // de tentar "filtrar" o que é comando ou não enquanto ligado, isso seria
    // sempre uma adivinhação.
    if (!micEnabled) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setAudioError('Áudio não suportado neste navegador.');
      return;
    }

    if (!window.isSecureContext) {
      setAudioError('Reconhecimento de voz exige HTTPS (ou localhost).');
      return;
    }

    // Controla se devemos reiniciar automaticamente no onend.
    // Evita a race condition de stop()/start() que matava o reconhecimento
    // silenciosamente quando o efeito era recriado (ex: ao trocar selectedComponentId).
    let shouldRestart = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';

    recognition.onresult = (event: any) => {
      const rawText = event.results[event.results.length - 1][0].transcript;
      // Sanitização robusta: minúsculas e remove pontuação comum
      const transcript = rawText.toLowerCase().replace(/[^\w\sà-ú]/gi, '').trim();
      // Não mostra mais o transcript bruto na tela (privacidade — antes
      // exibia literalmente tudo que o mic captava, mesmo conversa de fundo
      // sem relação com o app). Só atualiza o HUD quando um comando real
      // for reconhecido, mais abaixo.
      setAudioError(null);

      const normalizedTranscript = normalizeVoiceText(transcript);
      const matchedComponentId = findComponentIdByVoice(normalizedTranscript);
      const wantsExplode = transcript.includes('ampliar') || transcript.includes('abrir');

      // Falou o nome de um componente: seleciona ele.
      // Se também falou "ampliar"/"abrir" junto, além de selecionar já abre
      // (mostra só ele e oculta os demais).
      if (matchedComponentId) {
        selectComponent(matchedComponentId);
        if (wantsExplode) {
          setViewMode('exploded');
          setLastCommand(`Ampliando: ${matchedComponentId}`);
        } else {
          setLastCommand(`Selecionado: ${matchedComponentId}`);
        }
        return;
      }

      // Comandos de Vista (sem nome de componente reconhecido)
      if (wantsExplode) {
        setViewMode('exploded');
        setLastCommand('Ampliando');
      }
      if (transcript.includes('remontar') || transcript.includes('resetar') || transcript.includes('fechar') || transcript.includes('voltar')) {
        resetView();
        setLastCommand('Remontando');
      }
      if (transcript.includes('isolar')) {
        // BUG CORRIGIDO: setViewMode('isolated') sozinho nunca definia
        // isolatedComponentId, então nada era realmente isolado.
        // isolateComponent(id) seta isolatedComponentId + selectedComponentId
        // + viewMode juntos, do jeito que a store espera.
        if (selectedComponentIdRef.current) {
          isolateComponent(selectedComponentIdRef.current);
          setLastCommand(`Isolando: ${selectedComponentIdRef.current}`);
        } else {
          setLastCommand('Selecione um componente para isolar.');
        }
      }
      if (transcript.includes('simular incidente') || transcript.includes('simular problema')) {
        triggerRandomIncident();
        setLastCommand('Incidente simulado');
      }
      if (transcript.includes('resolver incidente') || transcript.includes('limpar incidente')) {
        clearIncident();
        setLastCommand('Incidente resolvido');
      }

      // Comandos de câmera: só fazem sentido com a peça aberta (explodida).
      if (viewModeRef.current === 'exploded') {
        if (transcript.includes('aproximar') || transcript.includes('zoom')) {
          triggerCameraCommand('zoom-in');
          setLastCommand('Comando: Aproximar');
        } else if (transcript.includes('recuar') || transcript.includes('afastar') || transcript.includes('recusar')) {
          triggerCameraCommand('zoom-out');
          setLastCommand('Comando: Recuar');
        } else if (transcript.includes('esquerda')) {
          triggerCameraCommand('rotate-left');
          setLastCommand('Comando: Girar à esquerda');
        } else if (transcript.includes('direita')) {
          triggerCameraCommand('rotate-right');
          setLastCommand('Comando: Girar à direita');
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Erro no reconhecimento de voz:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setAudioError('Permissão de microfone negada. Verifique as permissões do navegador.');
        shouldRestart = false; // sem permissão, reiniciar não resolve
      } else if (event.error === 'no-speech') {
        // silêncio momentâneo — não é erro real, deixa o onend reiniciar normalmente
      } else if (event.error === 'aborted') {
        // esperado durante cleanup/unmount — ignora
      } else {
        setAudioError(`Erro de voz: ${event.error}`);
      }
    };

    // Reinicia o áudio automaticamente se ele parar (sem gerar loop de recriação)
    recognition.onend = () => {
      if (isActive && shouldRestart) {
        try {
          recognition.start();
        } catch (err) {
          console.error('Falha ao reiniciar reconhecimento:', err);
        }
      }
    };

    if (isActive) {
      try {
        recognition.start();
        setAudioError(null);
      } catch (err) {
        console.error('Erro ao iniciar voz:', err);
        setAudioError('Erro ao acessar microfone. Verifique permissões.');
      }
    }

    return () => {
      shouldRestart = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    };
    // selectedComponentId foi removido das dependências propositalmente:
    // usamos selectedComponentIdRef para ler o valor atual sem recriar o
    // reconhecimento de voz a cada seleção de componente.
  }, [isActive, micEnabled, setViewMode, resetView, selectComponent, isolateComponent, triggerCameraCommand, triggerRandomIncident, clearIncident]);

  // --- VISÃO COMPUTACIONAL AR EM TELA CHEIA (2 MÃOS) ---
  useEffect(() => {
    if (!videoRef.current || !fullCanvasRef.current || !isActive) return;

    // Defesa: se o <script> do CDN (index.html) ainda não carregou quando
    // este efeito roda (internet lenta, bloqueador de anúncio, etc.), Hands
    // e Camera vêm undefined — sem essa checagem, o erro seria um crash
    // confuso em vez de uma mensagem clara.
    if (typeof Hands !== 'function' || typeof Camera !== 'function') {
      setVisionError('Biblioteca de rastreamento de mão não carregou (verifique a conexão e recarregue a página).');
      return;
    }

    let hands: HandsType | null = null;

    // Inicialização do MediaPipe Hands pode falhar (ex: falha ao buscar o
    // WASM do CDN). Sem isso, a falha ficava silenciosa e a mão nunca
    // aparecia, sem nenhuma pista do motivo.
    try {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2, // Lê as duas mãos simultaneamente
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
      });
    } catch (err) {
      console.error('Erro ao inicializar MediaPipe Hands:', err);
      setVisionError(
        `Erro ao inicializar rastreamento de mão: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    hands.onResults((results: Results) => {
      const canvas = fullCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks) {
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;
        const vRatio = vWidth / vHeight;
        const cRatio = canvas.width / canvas.height;

        let scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0;
        if (cRatio > vRatio) {
          scaleY = cRatio / vRatio;
          offsetY = (1 - scaleY) / 2;
        } else {
          scaleX = vRatio / cRatio;
          offsetX = (1 - scaleX) / 2;
        }

        const getScreenPos = (lm: { x: number; y: number }) => ({
          x: (1 - (lm.x * scaleX + offsetX)) * canvas.width,
          y: (lm.y * scaleY + offsetY) * canvas.height
        });

        // Desenha o esqueleto de todas as mãos detectadas — sempre, como
        // feedback visual, independente do modo de gesto ativo.
        for (const landmarks of results.multiHandLandmarks) {
          HAND_CONNECTIONS.forEach(([i, j]) => {
            const p1 = getScreenPos(landmarks[i]);
            const p2 = getScreenPos(landmarks[j]);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00ff88';
            ctx.shadowBlur = 8;
            ctx.stroke();
          });

          landmarks.forEach((lm) => {
            const pos = getScreenPos(lm);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 10;
            ctx.fill();
          });
        }

        const now = Date.now();
        const isAmpliado = viewModeRef.current === 'exploded';
        const twoHandsForCamera = isAmpliado && results.multiHandLandmarks.length === 2;

        if (twoHandsForCamera) {
          // --- MODO CÂMERA COM DUAS MÃOS (só ativo com a peça ampliada) ---
          // Usa a VARIAÇÃO frame a frame da distância/ponto médio entre as
          // mãos, não o valor absoluto — contorna o problema de a câmera
          // não saber a distância real da mão até a tela.
          const wristA = getScreenPos(results.multiHandLandmarks[0][0]);
          const wristB = getScreenPos(results.multiHandLandmarks[1][0]);
          const handDistance = Math.hypot(wristA.x - wristB.x, wristA.y - wristB.y) / canvas.width;
          const midpointX = (wristA.x + wristB.x) / 2 / canvas.width;
          const midpointY = (wristA.y + wristB.y) / 2 / canvas.height;

          useCameraCommandStore.getState().setTwoHandGesture({
            active: true,
            handDistance,
            midpointX,
            midpointY,
          });

          if (now - lastDebugUpdateRef.current > 250) {
            lastDebugUpdateRef.current = now;
            setLastCommand('Modo câmera (2 mãos): afaste p/ zoom, mova p/ girar e subir/descer');
          }
        } else {
          useCameraCommandStore.getState().setTwoHandGesture(null);

          // --- GESTOS DE UMA MÃO (apontar/pinça/mão aberta) — só rodam
          // quando NÃO estamos no modo câmera de duas mãos. ---
          for (const landmarks of results.multiHandLandmarks) {
            // --- GESTO DE PINÇA REFINADO PARA SELEÇÃO ÚNICA (Polegar + Indicador -> Clique) ---
            const thumbTip = getScreenPos(landmarks[4]);
            const indexTip = getScreenPos(landmarks[8]);
            const pinkyTip = getScreenPos(landmarks[20]);
            const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

            // --- APONTAR COM O INDICADOR -> SELECIONA EM TEMPO REAL ---
            // Roda todo frame (não depende de pinça): identifica qual card está
            // sob a ponta do indicador via data-component-id e seleciona.
            // Só troca a seleção quando o card apontado MUDA, pra não disparar
            // a mesma ação repetidamente a cada frame.
            const pointedElements = document.elementsFromPoint(indexTip.x, indexTip.y);
            const pointedCard = pointedElements.find(
              (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.componentId !== undefined
            );
            const pointedId = pointedCard?.dataset.componentId ?? null;
            if (pointedId && pointedId !== lastPointedIdRef.current) {
              lastPointedIdRef.current = pointedId;
              selectComponent(pointedId);
            }

            // Círculo HUD na ponta do indicador (Sempre verde neon, para não confundir com a seleção Drei)
            ctx.beginPath();
            ctx.arc(indexTip.x, indexTip.y, pinchDist < 45 ? 24 : 12, 0, 2 * Math.PI);
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 3;
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 15;
            ctx.stroke();

            // Simula o clique ao juntar os dedos (Pinça) — mantido como
            // alternativa; a seleção principal agora é por apontar (acima).
            if (pinchDist < 45 && !isPinchingRef.current && (now - lastGestureTriggerRef.current > 1000)) {
              isPinchingRef.current = true;
              lastGestureTriggerRef.current = now;
              pinchHoldStartRef.current = now;
              pinchHoldTriggeredRef.current = false;

              // Testa alguns pontos ao redor do dedo (não só o pixel exato) —
              // mais tolerante a pequenos desalinhos entre o dedo e o card.
              const samplePoints = [
                { x: indexTip.x, y: indexTip.y },
                { x: indexTip.x - 14, y: indexTip.y },
                { x: indexTip.x + 14, y: indexTip.y },
                { x: indexTip.x, y: indexTip.y - 14 },
                { x: indexTip.x, y: indexTip.y + 14 },
              ];

              let matchedCard: HTMLElement | null = null;
              for (const point of samplePoints) {
                const elements = document.elementsFromPoint(point.x, point.y);
                const found = elements.find(
                  (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('component-card')
                );
                if (found) {
                  matchedCard = found;
                  break;
                }
              }

              if (matchedCard) {
                matchedCard.click();
                setLastCommand('Gesto: Pinça -> SELECIONAR');
              }
            } else if (pinchDist < 45 && isPinchingRef.current) {
              // --- PINÇA SEGURADA -> AMPLIAR (alternativa mais confiável ao
              // gesto de mão espalhada, já que reaproveita a detecção de
              // pinça que já funciona bem para seleção). ---
              if (
                !pinchHoldTriggeredRef.current &&
                pinchHoldStartRef.current !== null &&
                now - pinchHoldStartRef.current > 900
              ) {
                pinchHoldTriggeredRef.current = true;
                setViewMode('exploded');
                setLastCommand('Gesto: Pinça segurada -> AMPLIAR');
              }
            } else if (pinchDist >= 45) {
              isPinchingRef.current = false;
              pinchHoldStartRef.current = null;
              pinchHoldTriggeredRef.current = false;
            }

            // --- GESTO DE MÃO ABERTA (dedos bem espalhados, sustentado) -> AMPLIAR ---
            // Normalizado pelo tamanho da própria mão na tela (distância pulso -> base
            // do dedo médio), pra não depender de quão perto a mão está da câmera.
            // Exige ~350ms sustentados pra não disparar com um gesto passageiro
            // (ex: a mão só de passagem enquanto o usuário vai fazer a pinça).
            const wrist = getScreenPos(landmarks[0]);
            const middleMcp = getScreenPos(landmarks[9]);
            const palmSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 1;
            const handSpan = Math.hypot(thumbTip.x - pinkyTip.x, thumbTip.y - pinkyTip.y);
            const handSpanRatio = handSpan / palmSize;

            const SPREAD_RATIO_THRESHOLD = 2.2; // baixado de 2.7 — ainda estimativa
            const SPREAD_RATIO_RESET = 1.7;
            const SPREAD_HOLD_MS = 350;

            if (handSpanRatio > SPREAD_RATIO_THRESHOLD) {
              if (handSpreadStartRef.current === null) {
                handSpreadStartRef.current = now;
              } else if (
                now - handSpreadStartRef.current > SPREAD_HOLD_MS &&
                !isHandSpreadRef.current &&
                now - lastExplodeGestureTriggerRef.current > 1500
              ) {
                isHandSpreadRef.current = true;
                lastExplodeGestureTriggerRef.current = now;
                setViewMode('exploded');
                setLastCommand('Gesto: Mão Aberta -> AMPLIAR');
              }
            } else {
              handSpreadStartRef.current = null;
              if (handSpanRatio < SPREAD_RATIO_RESET) {
                isHandSpreadRef.current = false;
              }
            }
          }
        }
      } else {
        useCameraCommandStore.getState().setTwoHandGesture(null);
      }
    });

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (!videoRef.current || !hands) return;
        try {
          await hands.send({ image: videoRef.current });
        } catch (err) {
          // Erro por frame não deve spammar o console indefinidamente,
          // mas precisa aparecer pelo menos uma vez com contexto real.
          console.error('Erro no MediaPipe Hands ao processar frame:', err);
          setVisionError(`Erro no rastreamento de mão: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      width: 1280,
      height: 720
    });

    // NOTA (assumindo comportamento documentado do @mediapipe/camera_utils):
    // Camera.start() retorna uma Promise que faz getUserMedia() internamente
    // e rejeita se a permissão for negada ou o dispositivo estiver ocupado.
    // Sem o .catch(), essa rejeição ficava como unhandled promise rejection
    // — visível só no console, nunca pro usuário.
    camera
      .start()
      .then(() => setVisionError(null))
      .catch((err: unknown) => {
        console.error('Erro ao iniciar câmera (MediaPipe):', err);
        const name = (err as { name?: string } | null)?.name;
        setVisionError(
          name === 'NotAllowedError'
            ? 'Permissão de câmera negada.'
            : name === 'NotReadableError'
              ? 'Câmera em uso por outro processo/aba.'
              : `Erro ao acessar câmera: ${err instanceof Error ? err.message : String(err)}`
        );
      });

    return () => {
      camera.stop();
      hands?.close();
    };
  }, [isActive, setViewMode, selectComponent]);

  return (
    <>
      {/* Vídeo de fundo */}
      <video
        ref={videoRef}
        className="fixed inset-0 w-full h-full object-cover transform -scale-x-100 z-0 brightness-90 contrast-110"
        playsInline
        muted
      />

      {/* Canvas dos traços */}
      <canvas
        ref={fullCanvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-20"
      />

      {/* HUD Inferior de Status */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/90 border border-cyan-500/60 backdrop-blur-md px-6 py-2 rounded-full flex items-center gap-3 shadow-[0_0_20px_rgba(0,229,255,0.4)]">
        <span className={`w-2.5 h-2.5 rounded-full ${audioError || visionError ? 'bg-red-500' : 'bg-emerald-400 animate-pulse'}`} />
        <span className="text-xs font-mono text-cyan-300 tracking-wider">
          {visionError
            ? `Câmera: ${visionError}`
            : !micEnabled
              ? 'Microfone desligado'
              : audioError
                ? audioError
                : lastCommand}
        </span>
        <button
          onClick={() => setMicEnabled((v) => !v)}
          className={`ml-1 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
            micEnabled
              ? 'text-cyan-300 border-cyan-500/60 hover:bg-cyan-950/40'
              : 'text-slate-500 border-slate-700 hover:bg-slate-800/40'
          }`}
          title={micEnabled ? 'Desligar microfone' : 'Ligar microfone'}
        >
          {micEnabled ? '🎤 ON' : '🎤 OFF'}
        </button>
      </div>
    </>
  );
}