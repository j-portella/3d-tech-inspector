// src/store/useInspectorStore.ts
import { create } from 'zustand';
import type { InspectorState, ITComponent } from '../types/inspector';

// Conexões reais entre sistemas — hub-e-raios a partir do SAP. Exportado
// porque é usado tanto pelas linhas na cena 3D (Scene.tsx) quanto pela
// lista de dependências clicáveis no painel de detalhes (DetailPanel.tsx).
export const SYSTEM_CONNECTIONS: [string, string][] = [
  ['sap', 'totvs-protheus'],
  ['sap', 'salesforce'],
  ['sap', 'aws'],
  ['sap', 'google-cloud'],
  ['sap', 'sql'],
  ['sap', 'oracle'],
];

const step = (name: string) => ({ name });

// Mesmo layout hexagonal da referência aprovada (era: api-gateway no centro +
// 6 ao redor) — reaproveitando as coordenadas exatas, só remapeadas pros 7
// sistemas novos. SAP fica no centro como "âncora" visual do grid.
const INITIAL_COMPONENTS: ITComponent[] = [
  {
    id: 'sap',
    name: 'SAP',
    tech: 'ERP',
    type: 'erp',
    category: 'business',
    status: 'online',
    responsible: 'Time ERP',
    shape: 'cylinder',
    dependenciesCount: 3,
    openTickets: 1,
    sla: '99.9%',
    lastDeploy: '10/08/2026',
    description: 'ERP corporativo — gestão financeira, materiais e vendas.',
    defaultPosition: [0, 0, 0],
    explodedPosition: [0, 0, 0],
    color: '#3b82f6',
    modules: [
      'FI - Financeiro',
      'MM - Materiais',
      'SD - Vendas',
      'HR - Recursos Humanos',
    ],
    moduleFlows: {
      'FI - Financeiro': [step('Lançamento'), step('Aprovação'), step('Pagamento'), step('Conciliação')],
      'MM - Materiais': [step('Requisição'), step('Cotação'), step('Pedido de Compra'), step('Recebimento')],
      'SD - Vendas': [step('Cotação'), step('Pedido de Venda'), step('Faturamento'), step('Entrega')],
      'HR - Recursos Humanos': [step('Admissão'), step('Folha de Pagamento'), step('Benefícios'), step('Desligamento')],
    },
  },
  {
    id: 'oracle',
    name: 'ORACLE',
    tech: 'Banco de Dados',
    type: 'database',
    category: 'data',
    status: 'online',
    responsible: 'Time DBA',
    shape: 'cylinder',
    dependenciesCount: 2,
    openTickets: 1,
    sla: '99.9%',
    lastDeploy: '06/08/2026',
    description: 'Banco de dados corporativo — cargas críticas e legado.',
    defaultPosition: [0, 0, -4.2],
    explodedPosition: [0, 0, -4.2],
    color: '#ef4444',
    modules: ['Oracle Database', 'PL/SQL', 'Data Guard'],
    moduleFlows: {
      'Oracle Database': [step('Conexão'), step('Consulta'), step('Transação'), step('Commit')],
      'PL/SQL': [step('Chamada'), step('Compilação'), step('Execução'), step('Retorno')],
      'Data Guard': [step('Captura'), step('Transmissão'), step('Aplicação'), step('Sincronização')],
    },
  },
  {
    id: 'totvs-protheus',
    name: 'TOTVS PROTHEUS',
    tech: 'ERP',
    type: 'erp',
    category: 'business',
    status: 'online',
    responsible: 'Time ERP',
    shape: 'cylinder',
    dependenciesCount: 2,
    openTickets: 0,
    sla: '99.9%',
    lastDeploy: '09/08/2026',
    description: 'ERP nacional — backoffice, faturamento e gestão fiscal.',
    defaultPosition: [-3.8, 0, -1.8],
    explodedPosition: [-3.8, 0, -1.8],
    color: '#22c55e',
    modules: ['Backoffice', 'Faturamento', 'Estoque & Custos', 'Fiscal'],
    moduleFlows: {
      'Backoffice': [step('Cadastro'), step('Processamento'), step('Aprovação'), step('Arquivamento')],
      'Faturamento': [step('Emissão'), step('Validação Fiscal'), step('Envio'), step('Recebimento')],
      'Estoque & Custos': [step('Entrada'), step('Apuração de Custo'), step('Saída'), step('Inventário')],
      'Fiscal': [step('Apuração'), step('Geração de Guia'), step('Envio ao Fisco'), step('Confirmação')],
    },
  },
  {
    id: 'aws',
    name: 'AWS',
    tech: 'Cloud',
    type: 'cloud',
    category: 'infra',
    status: 'online',
    responsible: 'Time Infra',
    shape: 'cylinder',
    dependenciesCount: 4,
    openTickets: 0,
    sla: '99.99%',
    lastDeploy: '12/08/2026',
    description: 'Infraestrutura em nuvem — computação, storage e integrações.',
    defaultPosition: [3.8, 0, -1.8],
    explodedPosition: [3.8, 0, -1.8],
    color: '#f59e0b',
    modules: ['EC2', 'S3', 'RDS', 'Lambda'],
    moduleFlows: {
      'EC2': [step('Provisionamento'), step('Configuração'), step('Monitoramento'), step('Escalonamento')],
      'S3': [step('Upload'), step('Replicação'), step('Versionamento'), step('Backup')],
      'RDS': [step('Conexão'), step('Consulta'), step('Backup Automático'), step('Failover')],
      'Lambda': [step('Trigger'), step('Execução'), step('Log'), step('Retorno')],
    },
  },
  {
    id: 'salesforce',
    name: 'SALESFORCE',
    tech: 'CRM',
    type: 'crm',
    category: 'business',
    status: 'online',
    responsible: 'Time CRM',
    shape: 'cylinder',
    dependenciesCount: 2,
    openTickets: 0,
    sla: '99.95%',
    lastDeploy: '11/08/2026',
    description: 'CRM — gestão de clientes, vendas e atendimento.',
    defaultPosition: [-2.8, 0, 2.2],
    explodedPosition: [-2.8, 0, 2.2],
    color: '#38bdf8',
    modules: ['Sales Cloud', 'Service Cloud', 'Marketing Cloud'],
    moduleFlows: {
      'Sales Cloud': [step('Lead'), step('Oportunidade'), step('Proposta'), step('Fechamento')],
      'Service Cloud': [step('Abertura de Caso'), step('Triagem'), step('Resolução'), step('Encerramento')],
      'Marketing Cloud': [step('Segmentação'), step('Campanha'), step('Envio'), step('Análise de Resultado')],
    },
  },
  {
    id: 'google-cloud',
    name: 'GOOGLE CLOUD',
    tech: 'Cloud',
    type: 'cloud',
    category: 'infra',
    status: 'online',
    responsible: 'Time Infra',
    shape: 'cylinder',
    dependenciesCount: 2,
    openTickets: 0,
    sla: '99.95%',
    lastDeploy: '08/08/2026',
    description: 'Infraestrutura em nuvem — analytics e workloads gerenciados.',
    defaultPosition: [2.8, 0, 2.2],
    explodedPosition: [2.8, 0, 2.2],
    color: '#a855f7',
    modules: ['Compute Engine', 'BigQuery', 'Cloud Storage'],
    moduleFlows: {
      'Compute Engine': [step('Provisionamento'), step('Deploy'), step('Monitoramento'), step('Escalonamento')],
      'BigQuery': [step('Ingestão'), step('Processamento'), step('Consulta'), step('Exportação')],
      'Cloud Storage': [step('Upload'), step('Replicação'), step('Ciclo de Vida'), step('Arquivamento')],
    },
  },
  {
    id: 'sql',
    name: 'SQL',
    tech: 'Banco de Dados',
    type: 'database',
    category: 'data',
    status: 'online',
    responsible: 'Time DBA',
    shape: 'cylinder',
    dependenciesCount: 3,
    openTickets: 0,
    sla: '99.99%',
    lastDeploy: '05/08/2026',
    description: 'Banco de dados relacional principal.',
    defaultPosition: [0, 0, 4.8],
    explodedPosition: [0, 0, 4.8],
    color: '#14b8a6',
    modules: ['Banco Relacional', 'Stored Procedures', 'Replicação'],
    moduleFlows: {
      'Banco Relacional': [step('Conexão'), step('Consulta'), step('Transação'), step('Commit')],
      'Stored Procedures': [step('Chamada'), step('Validação'), step('Execução'), step('Retorno')],
      'Replicação': [step('Captura'), step('Transmissão'), step('Aplicação'), step('Confirmação')],
    },
  },
];

export const useInspectorStore = create<InspectorState>((set, get) => ({
  components: INITIAL_COMPONENTS,
  // Antes começava com 'sap' pré-selecionado; isso, combinado com o gesto de
  // mão aberta, dava a impressão de que a tela "auto-selecionava" algo assim
  // que abria. Agora começa sem nada selecionado.
  selectedComponentId: null,
  viewMode: 'default',
  isolatedComponentId: null,
  activeIncident: null,

  selectComponent: (id) => set({ selectedComponentId: id }),
  setViewMode: (mode) => set((state) => ({
    viewMode: mode,
    isolatedComponentId: mode !== 'isolated' ? null : state.isolatedComponentId
  })),
  isolateComponent: (id) => set({
    isolatedComponentId: id,
    selectedComponentId: id,
    viewMode: 'isolated'
  }),
  resetView: () => set({
    viewMode: 'default',
    isolatedComponentId: null,
    // BUG CORRIGIDO: remontar não limpava a seleção — o sistema anterior
    // continuava "selecionado" nos bastidores, causando o efeito de
    // "abre o antigo primeiro, depois o novo" quando você falava pra abrir
    // outro sistema logo em seguida.
    selectedComponentId: null,
  }),
  updateComponentPosition: (id, position) => set((state) => ({
    components: state.components.map((c) =>
      c.id === id ? { ...c, defaultPosition: position, explodedPosition: position } : c
    ),
  })),

  triggerRandomIncident: () => {
    const { components } = get();
    // Só sorteia entre sistemas que realmente têm módulos com fluxo definido
    const candidates = components.filter((c) => Object.keys(c.moduleFlows).length > 0);
    if (candidates.length === 0) return;

    const component = candidates[Math.floor(Math.random() * candidates.length)];
    const moduleNames = Object.keys(component.moduleFlows);
    const moduleName = moduleNames[Math.floor(Math.random() * moduleNames.length)];
    const steps = component.moduleFlows[moduleName];
    const stepIndex = Math.floor(Math.random() * steps.length);

    set((state) => ({
      activeIncident: { componentId: component.id, moduleName, stepIndex },
      components: state.components.map((c) =>
        c.id === component.id
          ? { ...c, status: 'warning', openTickets: c.openTickets + 1 }
          : c
      ),
    }));
  },

  clearIncident: () => {
    const { activeIncident, components } = get();
    if (!activeIncident) return;
    set({
      activeIncident: null,
      components: components.map((c) =>
        c.id === activeIncident.componentId
          ? { ...c, status: 'online', openTickets: Math.max(0, c.openTickets - 1) }
          : c
      ),
    });
  },
}));