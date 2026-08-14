// src/App.tsx
import { Scene } from './components/3d/Scene';
import DetailPanel from './components/ui/DetailPanel';
import { HandTracker } from './components/ui/HandTracker';
import { useInspectorStore } from './store/useInspectorStore';

export default function App() {
  const {
    setViewMode,
    resetView,
    isolateComponent,
    selectedComponentId,
    activeIncident,
    triggerRandomIncident,
    clearIncident,
  } = useInspectorStore();

  return (
    <div className="w-screen h-screen relative overflow-hidden select-none bg-black">
      {/* 1. Câmera de Fundo + Overlay de Mãos (Camada 0 e 20) */}
      <HandTracker />

      {/* 2. Topbar Flutuante HUD (Estilo Homem de Ferro) */}
      <header className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-950/80 border border-slate-800/80 backdrop-blur-md px-6 py-2 rounded-2xl flex items-center gap-4 shadow-2xl">
        <button 
          onClick={() => setViewMode('exploded')}
          className="text-xs font-bold text-cyan-400 hover:text-white px-3 py-1 bg-cyan-950/40 border border-cyan-800/60 rounded-lg transition-all"
        >
          AMPLIAR
        </button>
        <button
          onClick={() => {
            // BUG CORRIGIDO: setViewMode('isolated') sozinho nunca definia
            // isolatedComponentId na store, então nada era realmente
            // isolado — a tela ficava igual ao modo padrão.
            // isolateComponent(id) seta isolatedComponentId, selectedComponentId
            // e viewMode juntos, atomicamente.
            if (selectedComponentId) {
              isolateComponent(selectedComponentId);
            }
          }}
          disabled={!selectedComponentId}
          className="text-xs font-bold text-purple-400 hover:text-white px-3 py-1 bg-purple-950/40 border border-purple-800/60 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ISOLAR
        </button>
        <button 
          onClick={() => resetView()}
          className="text-xs font-bold text-emerald-400 hover:text-white px-3 py-1 bg-emerald-950/40 border border-emerald-800/60 rounded-lg transition-all"
        >
          REMONTAR
        </button>
        <button
          onClick={() => (activeIncident ? clearIncident() : triggerRandomIncident())}
          className={`text-xs font-bold px-3 py-1 rounded-lg transition-all border ${
            activeIncident
              ? 'text-red-300 bg-red-950/50 border-red-700/60 hover:text-white'
              : 'text-amber-400 bg-amber-950/40 border-amber-800/60 hover:text-white'
          }`}
        >
          {activeIncident ? 'RESOLVER INCIDENTE' : 'SIMULAR INCIDENTE'}
        </button>
      </header>

      {/* 3. Área 3D Central Transparente (Camada 10) */}
      <div className="absolute inset-0 z-10">
        <Scene />
      </div>

      {/* 4. Painel Lateral de Detalhes Flutuante na Direita — some por completo
             quando nada está selecionado (antes, o contêiner vazio colapsava
             numa linha fina, só a borda sobrando). Largura reduzida a pedido
             (w-80 → w-64). */}
      {selectedComponentId && (
        <div className="absolute top-6 right-6 w-64 max-h-[calc(100vh-3rem)] z-30 bg-slate-950/85 border border-slate-800/80 backdrop-blur-xl rounded-2xl overflow-y-auto shadow-2xl">
          <DetailPanel />
        </div>
      )}

      {/* 5. Crédito de autoria — discreto, canto inferior esquerdo */}
      <div className="absolute bottom-4 left-4 z-30 text-[10px] font-medium text-slate-500 tracking-wide pointer-events-none select-none">
        Criado por Juliano Portella
      </div>
    </div>
  );
}