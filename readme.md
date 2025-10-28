# 🟥 Point Down – Extensão Chrome

**Point Down** é uma extensão para **Google Chrome** desenvolvida para auxiliar times de desenvolvimento e QA na atualização diária dos **Story Points (SP)** das issues do Jira.  
Ela integra automação, filtros inteligentes e modos distintos para **Desenvolvedores (DEV)** e **Analistas de Qualidade (QA)**, otimizando o controle e a organização do fluxo de trabalho ágil.

---

## ⚙️ Arquitetura Geral

| Componente | Descrição |
|-------------|------------|
| **background.js** | Gerencia o agendamento diário, o piscar do ícone e a abertura automática do modal. |
| **modal.html / js / css** | Interface principal para visualização e edição dos Story Points. Inclui seções diferentes para DEV e QA. |
| **options.html / js** | Página de configurações, com persistência em `chrome.storage.sync`. Controla o modo ativo, filtros, palavras-chave e agendamento. |
| **manifest.json** | Configuração MV3 da extensão (service worker, permissões, ícones e hosts Atlassian). |

---

## 🧭 Fluxo de Funcionamento

1. Ao iniciar, `background.js` agenda um alarme diário (padrão: **17h50**).  
   - Se `Enable Weekend` estiver desativado, o modal **não abre aos sábados e domingos**.
2. No horário configurado:
   - O ícone começa a piscar e o **modal principal** é aberto automaticamente.
3. O usuário visualiza as issues da sprint atual (JQL configurável) filtradas por *Status*.
4. O usuário ajusta os SP (incrementos de 0.5) e salva:
   - Cada atualização utiliza um **bloqueio cooperativo** (Issue Property no Jira) para evitar conflitos simultâneos.
   - Ao salvar ou fechar o modal, o piscar do ícone é interrompido.

---

## 🧩 Principais Funcionalidades

### 🔁 Agendamento e Lembrete
- Abertura automática do modal todos os dias no horário configurado.
- Exclusão de fins de semana (opcional).
- Piscar automático do ícone por até 5 minutos.
- Reagendamento automático em caso de reinício do navegador.

### 🧮 Controle de Story Points
- Campo Jira fixo: `customfield_10022`.
- Leitura do SP atual antes de salvar, garantindo consistência.
- Atualização com **retry e backoff** automáticos em caso de falha.
- **Bloqueio cooperativo** via Issue Property (`point_down_lock`) com tempo de vida e liberação automática.

### 🧱 Interface
- Lista de issues da sprint com:
  - Título, link direto para o Jira, *label* de status e input SP com botões ▲/▼.
  - Filtro local: mostrar/ocultar issues com SP = 0.
- Feedbacks visuais:
  - **Save Pulse** (botão pulsa enquanto há alterações não salvas).
  - **Status Pulse** (animação verde/azul durante o salvamento).
- Banner inferior com atalhos:
  - 🔗 **Go to Sprint!** → abre sprint ativa no Jira.
  - 🏁 **Board** → abre o board principal.

---

## 👥 Modos de Operação

### ⚙️ Seletor de Modo
O usuário escolhe o seu perfil na página **Opções**:
- `Sou DEV`
- `Sou QA`

Os dois modos são **mutuamente exclusivos**, afetando:
- a aparência da interface,  
- os filtros aplicados,  
- e as permissões das opções disponíveis.

---

## 🔀 Diferenças entre DEV Mode e QA Mode

### 1. Propósito Operacional
| Aspecto | **DEV Mode** | **QA Mode** |
|----------|---------------|--------------|
| **Objetivo** | Apoiar o desenvolvedor no controle diário das issues em progresso e suporte. | Facilitar o controle de testes, regressões e verificações exploratórias. |
| **Abordagem** | Foco em produtividade, backlog técnico e épicos específicos. | Foco em qualidade, cobertura de testes e regressões pendentes. |

---

### 2. Estrutura do Modal

| Seção | **DEV Mode** | **QA Mode** |
|--------|---------------|--------------|
| **Lista principal** | Issues da sprint atual filtradas por Status selecionados. | Igual. |
| **Seção adicional** | **Squad Mode** – inclui issues associadas a palavras-chave (ex: “Support DEV”, “Buffer”) e/ou épicos. | **Seção Especial QA** – inclui issues com termos “Exploratory”, “Regression”, “Retest”, além de palavras extras definidas nas opções. |
| **Campo de busca** | Busca apenas no *summary*. | Busca em *summary* e *description*. |
| **Combinação lógica** | Se houver palavras + épicos → aplica `AND`. | Combina automaticamente os padrões de regressão e teste exploratório. |

---

### 3. Filtros de Status

| Tipo | **DEV Mode** | **QA Mode** |
|------|---------------|--------------|
| **Preset padrão** | Todos os status ativados. | Apenas *In Progress*, *Blocked* e *Need Requirements*. |
| **Personalização** | Totalmente configurável. | Limitada ao subset QA. |

---

### 4. Políticas e Restrições

| Parâmetro | **DEV Mode** | **QA Mode** |
|------------|---------------|--------------|
| **Force Test Card (FGC-9683)** | Disponível e configurável. | **Desativado e bloqueado**. |
| **Enable Weekend** | Disponível (padrão: OFF). | **Forçado OFF** (sem abertura em fins de semana). |
| **Enable Queue Lock** | Ativado (padrão ON). | Ativado (padrão ON). |
| **Palavras padrão** | “Support DEV”, “Buffer”. | Nenhuma (as palavras de DEV são removidas). |
| **Épicos** | Disponíveis e configuráveis. | Ocultos. |

---

### 5. Interface Visual

| Elemento | **DEV Mode** | **QA Mode** |
|-----------|---------------|--------------|
| **Caixa de “Palavras-chave”** | Dentro da seção *Squad Mode*. | Movida para a seção *Avançadas*. |
| **Caixa de “Filtros de Status”** | Visível no topo, sempre ativa. | Igual, mas com valores restritos. |
| **Cores dos Status** | Todos exibem *label* colorida (com texto branco em status QA/Testing). | Apenas status ativos exibidos; demais ficam acinzentados. |
| **Seções renderizadas** | Mostra `#squadOutputSection`. | Mostra `#specialSection`. |

---

## 💾 Salvamento e Segurança

- Bloqueio cooperativo por Issue Property (`point_down_lock`) com expiração de 60s.  
- Repetição automática em caso de erro (retry com backoff).  
- Liberação garantida do lock ao finalizar ou fechar o modal.  
- Token Jira armazenado localmente via `chrome.storage.sync` (não é enviado a terceiros).  
- Nenhuma coleta de dados ou registro remoto.  

---

## 🛠️ Página de Opções

| Seção | Função |
|--------|---------|
| **Credenciais Jira** | Base URL, e-mail e token (autenticação básica). |
| **JQL Base** | Query opcional (sempre combinada com os filtros de Status). |
| **Horário Diário** | Formato HH:MM (padrão 17:50). |
| **Filtros de Status** | Conjunto de checkboxes com presets diferentes para DEV e QA. |
| **Palavras-chave** | Lista de termos usados na busca (editável). |
| **Códigos FGC** | Issues específicas que sempre devem aparecer. |
| **Épicos** | Filtragem adicional por épico (somente DEV). |
| **Force Test Card** | Inclui o card FGC-9683 (apenas DEV). |
| **Enable Queue Lock** | Liga/desliga o controle de lock. |
| **Enable Weekend** | Permite abertura em fins de semana (somente DEV). |

---

## 💡 Boas Práticas

- **DEV**: use o *Squad Mode* para visualizar issues de suporte, backlog técnico ou épicos específicos.  
- **QA**: utilize a *Seção Especial* para acompanhar regressões e testes exploratórios.  
- Atualize SP apenas após validação do progresso real.  
- Mantenha `Enable Queue Lock` sempre ativo.  
- Caso o modal não abra aos fins de semana, é o comportamento esperado no modo QA.  

---

## 🧠 Dicas Avançadas

- Adicione palavras personalizadas como “ux”, “hotfix”, “backend” para rastrear categorias específicas.  
- Filtre épicos para focar em módulos de projeto (ex: *FGC-9540* para Mobile Sync).  
- O filtro SP=0 ajuda a identificar issues ainda não estimadas.  
- O botão **Save & Exit** salva e fecha rapidamente em um único clique.  

---

## 🧰 Permissões Necessárias

```json
"permissions": [
  "storage",
  "alarms",
  "notifications",
  "https://*.atlassian.net/*"
]
