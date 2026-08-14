// src/components/ui/DetailPanel.tsx
import { useEffect, useState } from 'react';
import { useInspectorStore, SYSTEM_CONNECTIONS } from '../../store/useInspectorStore';

// Tempo parado (sem trocar de seleção) antes do painel atualizar. Como a
// seleção agora acontece por apontar o dedo em tempo real, sem esse atraso
// o painel ficava trocando de conteúdo a cada frame e virava ilegível.
const STABLE_DELAY_MS = 400;

const STATUS_STYLE: Record<string, string> = {
  online: 'text-emerald-400 bg-emerald-400/10',
  warning: 'text-amber-400 bg-amber-400/10',
  error: 'text-red-400 bg-red-400/10',
  offline: 'text-slate-400 bg-slate-400/10',
};

export default function DetailPanel() {
  const { components, selectedComponentId, selectComponent, activeIncident, clearIncident } = useInspectorStore();

  // Só "aceita" a nova seleção depois que ela ficar parada por STABLE_DELAY_MS.
  const [stableId, setStableId] = useState<string | null>(selectedComponentId);
  useEffect(() => {
    const timer = setTimeout(() => setStableId(selectedComponentId), STABLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selectedComponentId]);

  // Painel inteiro recolhível — começa aberto, mas não domina a tela se
  // o usuário preferir esconder.
  const [collapsed, setCollapsed] = useState(false);
  // Campos secundários (Responsável/Deploy) escondidos por padrão.
  const [showMore, setShowMore] = useState(false);
  // Módulo com o fluxo aberto no momento (clique pra abrir/fechar).
  const [openModule, setOpenModule] = useState<string | null>(null);

  const component = components.find((c) => c.id === stableId);

  // Reseta "ver mais" e o módulo aberto toda vez que troca de componente,
  // pra não vazar o estado expandido de uma peça pra outra.
  useEffect(() => {
    setShowMore(false);
    setOpenModule(null);
  }, [stableId]);

  // Se um incidente for sorteado num módulo deste componente, abre o fluxo
  // dele automaticamente — assim o usuário vê o problema na hora, sem
  // precisar adivinhar qual módulo clicar.
  useEffect(() => {
    if (activeIncident && activeIncident.componentId === stableId) {
      setOpenModule(activeIncident.moduleName);
    }
  }, [activeIncident, stableId]);

  if (!component) return null;

  const relatedIds = SYSTEM_CONNECTIONS
    .filter(([a, b]) => a === component.id || b === component.id)
    .map(([a, b]) => (a === component.id ? b : a));
  const relatedComponents = relatedIds
    .map((id) => components.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const incidentHere =
    activeIncident && activeIncident.componentId === component.id ? activeIncident : null;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-11 h-11 flex items-center justify-center text-[#00e5ff] hover:bg-slate-800/40 transition-colors rounded-2xl"
        title="Mostrar detalhes"
      >
        <span className="text-lg">☰</span>
      </button>
    );
  }

  return (
    <div className="p-4 text-white flex flex-col gap-2.5 relative">
      <div className="flex items-center justify-between">
        <h3 className="text-[#00e5ff] text-xs font-bold tracking-widest uppercase">
          Detalhes
        </h3>
        <button
          onClick={() => setCollapsed(true)}
          className="text-slate-500 hover:text-white text-xs px-2 py-0.5 rounded transition-colors"
          title="Recolher"
        >
          ✕
        </button>
      </div>

      {/* Nome + status — compacto, uma linha */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm leading-tight">{component.name}</h2>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_STYLE[component.status]}`}>
          {component.status.toUpperCase()}
        </span>
      </div>

      {/* Saúde — SLA + chamados numa linha só, em vez de dois cards grandes */}
      <div className="flex items-center gap-3 text-[11px] bg-slate-900/50 border border-slate-800 rounded-lg px-2.5 py-1.5">
        <span className="text-slate-500">SLA <b className="text-emerald-400">{component.sla}</b></span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500">
          Chamados{' '}
          <b className={component.openTickets > 0 ? 'text-amber-400' : 'text-emerald-400'}>
            {component.openTickets}
          </b>
        </span>
      </div>

      {/* Módulos — clicáveis, abrem o fluxo abaixo */}
      {component.modules.length > 0 && (
        <div>
          <span className="text-[9px] text-slate-500 font-bold block mb-1 uppercase">
            Módulos <span className="normal-case text-slate-600">(clique p/ ver o fluxo)</span>
          </span>
          <div className="flex flex-wrap gap-1">
            {component.modules.map((mod) => {
              const hasIncident = incidentHere?.moduleName === mod;
              const isOpenMod = openModule === mod;
              return (
                <button
                  key={mod}
                  onClick={() => setOpenModule(isOpenMod ? null : mod)}
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${
                    isOpenMod ? 'bg-slate-800/80' : 'bg-slate-900/50 hover:bg-slate-800/50'
                  }`}
                  style={{
                    borderColor: hasIncident ? '#f87171' : `${component.color}66`,
                    color: hasIncident ? '#f87171' : component.color,
                  }}
                >
                  {hasIncident ? '⚠ ' : ''}{mod}
                </button>
              );
            })}
          </div>

          {/* Fluxo do módulo selecionado */}
          {openModule && component.moduleFlows[openModule] && (
            <div className="mt-1.5 bg-slate-900/50 border border-slate-800 rounded-lg p-2">
              <span className="text-[9px] text-slate-500 font-bold block mb-1.5 uppercase">
                Fluxo — {openModule}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {component.moduleFlows[openModule].map((s, i) => {
                  const isProblem = incidentHere?.moduleName === openModule && incidentHere?.stepIndex === i;
                  return (
                    <div key={s.name} className="flex items-center gap-1">
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${
                          isProblem
                            ? 'bg-red-500/20 text-red-300 border border-red-500/60 animate-pulse'
                            : 'bg-slate-800/70 text-slate-200'
                        }`}
                      >
                        {s.name}
                      </span>
                      {i < component.moduleFlows[openModule].length - 1 && (
                        <span className="text-slate-600 text-[10px]">→</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {incidentHere?.moduleName === openModule && (
                <div className="flex items-center justify-between mt-1.5 gap-2">
                  <p className="text-[9px] text-red-300">
                    {component.openTickets} chamado(s) aberto(s) nessa etapa
                  </p>
                  <button
                    onClick={clearIncident}
                    className="text-[9px] font-bold px-2 py-0.5 rounded border border-red-500/60 text-red-300 bg-red-950/40 hover:bg-red-900/50 transition-colors whitespace-nowrap"
                  >
                    Corrigir
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Conectado com */}
      {relatedComponents.length > 0 && (
        <div>
          <span className="text-[9px] text-slate-500 font-bold block mb-1 uppercase">Conectado com</span>
          <div className="flex flex-wrap gap-1">
            {relatedComponents.map((rel) => (
              <button
                key={rel.id}
                onClick={() => selectComponent(rel.id)}
                className="text-[9px] font-semibold px-2 py-0.5 rounded-full border bg-slate-900/50 hover:bg-slate-800/70 transition-colors cursor-pointer"
                style={{ borderColor: rel.color, color: rel.color }}
              >
                {rel.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ver mais — Responsável, Deploy e Descrição, escondidos por padrão */}
      <button
        onClick={() => setShowMore((v) => !v)}
        className="text-[9px] text-slate-500 hover:text-slate-300 font-semibold uppercase tracking-wide text-left transition-colors"
      >
        {showMore ? '− ocultar detalhes' : '+ ver mais detalhes'}
      </button>

      {showMore && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="border border-slate-800 bg-slate-900/50 p-2 rounded">
            <span className="text-[9px] text-slate-500 font-bold block mb-0.5 uppercase">Responsável</span>
            <span className="font-semibold text-[11px] truncate block">{component.responsible}</span>
          </div>
          <div className="border border-slate-800 bg-slate-900/50 p-2 rounded">
            <span className="text-[9px] text-slate-500 font-bold block mb-0.5 uppercase">Deploy</span>
            <span className="font-semibold text-[11px]">{component.lastDeploy}</span>
          </div>
          <div className="col-span-2 border border-slate-800 bg-slate-900/50 p-2 rounded">
            <span className="text-[9px] text-slate-500 font-bold block mb-0.5 uppercase">Descrição</span>
            <span className="text-slate-300 text-[10px] leading-relaxed">{component.description}</span>
          </div>
        </div>
      )}
    </div>
  );
}