export type ViewMode = 'default' | 'exploded' | 'isolated';

// Adicionamos o 'panel' (Painel achatado)
export type ComponentShape = 'box' | 'cylinder' | 'sphere' | 'panel';

// Categoria do sistema, usada para agrupar espacialmente no diagrama
// (ilhas por categoria, em vez de um hub único no centro).
export type SystemCategory = 'business' | 'infra' | 'data';

// Uma etapa do fluxo de um módulo (ex: "Lançamento" dentro de FI - Financeiro).
export interface ModuleFlowStep {
  name: string;
}

export interface ITComponent {
  id: string;
  name: string;
  // Novo campo opcional para a imagem do logo:
  logo?: string;
  tech: string;
  type: 'erp' | 'crm' | 'cloud' | 'database';
  category: SystemCategory;
  status: 'online' | 'warning' | 'error' | 'offline';

  shape?: ComponentShape;
  parentId?: string;

  responsible: string;
  dependenciesCount: number;
  openTickets: number;
  sla: string;
  lastDeploy: string;
  description: string;
  defaultPosition: [number, number, number];
  explodedPosition: [number, number, number];
  color: string;
  // Módulos do sistema, revelados quando a peça abre (explode)
  modules: string[];
  // Fluxo de cada módulo, indexado pelo nome exato em `modules`. Mostrado
  // no painel de detalhes quando o usuário clica num módulo.
  moduleFlows: Record<string, ModuleFlowStep[]>;
}

// Um incidente simulado: aponta pra uma etapa específica de um módulo de um
// sistema, pra dar vida ao painel (em vez de só números estáticos).
export interface SimulatedIncident {
  componentId: string;
  moduleName: string;
  stepIndex: number;
}

export interface InspectorState {
  components: ITComponent[];
  selectedComponentId: string | null;
  viewMode: ViewMode;
  isolatedComponentId: string | null;
  activeIncident: SimulatedIncident | null;

  selectComponent: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  isolateComponent: (id: string) => void;
  resetView: () => void;
  // Atualiza a posição (arraste) de um componente. Atualiza defaultPosition
  // e explodedPosition juntos, pra o reposicionamento valer em todas as vistas.
  updateComponentPosition: (id: string, position: [number, number, number]) => void;
  // Sorteia um sistema + módulo + etapa e marca como incidente ativo; soma
  // 1 chamado nesse sistema e muda o status pra 'warning'.
  triggerRandomIncident: () => void;
  // Limpa o incidente ativo e desfaz o chamado/status extra que ele causou.
  clearIncident: () => void;
}