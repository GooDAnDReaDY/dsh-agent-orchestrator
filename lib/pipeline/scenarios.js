/**
 * Predefined Scenarios & Agent Role Profiles for DSH Multi-Agent Orchestrator.
 *
 * All agent profiles and scenarios are self-contained within plugin settings (no external path dependencies).
 * Roles enforce strict separation of duties (e.g. backend and frontend/design are separate agents and stages).
 */

import { validateGraph } from './dag-engine.js'

export const ROLE_IDS = {
  SPEC: 'spec',
  ARCHITECTURE: 'architecture',
  UI_DESIGN: 'ui_design',
  FRONTEND: 'frontend',
  BACKEND: 'backend',
  FULLSTACK: 'fullstack',
  QA_TESTS: 'qa_tests',
  BUGFIX: 'bugfix',
  DOCS: 'docs',
  REFACTORING: 'refactoring',
  RESEARCH: 'research',
  DEVOPS: 'devops',
}

/**
 * 12 Built-in specialized agent roles stored purely inside plugin settings.
 */
export function getDefaultRoles() {
  return {
    [ROLE_IDS.SPEC]: {
      id: ROLE_IDS.SPEC,
      name: 'Technical Spec Analyst',
      category: 'Requirements & Functional Bounds',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'high',
      skills: ['project-design-contract', 'planning-with-files'],
      tools: ['view_file', 'grep_search'],
      systemPrompt: [
        'You are the Lead Technical Spec Analyst.',
        'Responsibilities: Formulate exhaustive, unambiguous functional requirements, acceptance criteria (DoD), input/output schemas, and error boundaries.',
        'Strict Boundaries: NEVER write production implementation code, never create styling, never merge code. Deliver only clean, structured technical specifications.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 4096,
    },
    [ROLE_IDS.ARCHITECTURE]: {
      id: ROLE_IDS.ARCHITECTURE,
      name: 'System Architect',
      category: 'System Design & Contracts',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'high',
      skills: ['project-design-contract', 'dsh-plugin-authoring', 'ponytail'],
      tools: ['view_file', 'grep_search', 'find_by_name'],
      systemPrompt: [
        'You are the Principal System Architect.',
        'Responsibilities: Design modular architectures adhering strictly to DSH conventions, Cordis service lifecycles, and standard library primitives. Deliver DESIGN.md, ADR, and interface contracts.',
        'Strict Boundaries: NEVER implement full production code, never deploy, never mix frontend styles into backend architecture.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 4096,
    },
    [ROLE_IDS.UI_DESIGN]: {
      id: ROLE_IDS.UI_DESIGN,
      name: 'UI/UX Interface Designer',
      category: 'UI/UX & Slot Integrations',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['dsh-ui-design', 'minimalist-ui', 'design-taste-frontend'],
      tools: ['view_file'],
      systemPrompt: [
        'You are the Lead Interface & Slot Designer.',
        'Responsibilities: Craft clean, native UI surfaces for DSH. Specify layout hierarchy, theme CSS variables (--dsw-alias-*), prefix isolation (.dso-*), and interactive states (loading, empty, ready, error).',
        'Strict Boundaries: NEVER write backend Cordis services, database logic, or server routes. Focus exclusively on visual interface design and token contracts.',
      ].join(' '),
      temperature: 0.3,
      maxTokens: 4096,
    },
    [ROLE_IDS.FRONTEND]: {
      id: ROLE_IDS.FRONTEND,
      name: 'Frontend Developer',
      category: 'Client Components & Interaction',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['dsh-ui-design', 'full-output-enforcement'],
      tools: ['view_file', 'replace_file_content', 'write_to_file'],
      systemPrompt: [
        'You are the Senior Frontend Developer.',
        'Responsibilities: Implement React client components, hook state management, DOM event listeners, and slot registrations according to UI design specs. Keep bundle size below 250 KiB.',
        'Strict Boundaries: NEVER modify backend server routes or database schemas. Do not invent design tokens that violate the designer specification.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 8192,
    },
    [ROLE_IDS.BACKEND]: {
      id: ROLE_IDS.BACKEND,
      name: 'Backend Developer',
      category: 'Server Logic & Services',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['dsh-plugin-authoring', 'full-output-enforcement', 'ponytail'],
      tools: ['view_file', 'replace_file_content', 'write_to_file', 'run_command'],
      systemPrompt: [
        'You are the Senior Backend Developer.',
        'Responsibilities: Implement host Cordis modules, WebServer routes, store persistence, credentials resolution, and tools definitions. Use Node.js ESM and standard library.',
        'Strict Boundaries: NEVER write React UI JSX or client CSS styles. Server and client remain strictly decoupled.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 8192,
    },
    [ROLE_IDS.FULLSTACK]: {
      id: ROLE_IDS.FULLSTACK,
      name: 'Fullstack Integrator',
      category: 'End-to-End Feature Assembly',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['dsh-plugin-authoring', 'dsh-ui-design', 'full-output-enforcement'],
      tools: ['view_file', 'replace_file_content', 'write_to_file'],
      systemPrompt: [
        'You are the Fullstack Integration Engineer.',
        'Responsibilities: Assemble client-server contracts, wire HTTP endpoints with client hooks, and ensure seamless end-to-end data flow between backend services and UI slots.',
        'Strict Boundaries: Always respect modular file boundaries (max 500-600 lines per file). Never bypass established architectural contracts.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 8192,
    },
    [ROLE_IDS.QA_TESTS]: {
      id: ROLE_IDS.QA_TESTS,
      name: 'QA Automation Engineer',
      category: 'Automated Testing & Security',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['dsh-plugin-authoring', 'ponytail-review'],
      tools: ['view_file', 'run_command', 'write_to_file'],
      systemPrompt: [
        'You are the QA Automation Specialist.',
        'Responsibilities: Write pure unit tests (`node --test test/*.test.mjs`), boundary condition verifications, rate-limit recovery mocks, and cycle detection checks with zero external network dependencies.',
        'Strict Boundaries: Do not alter production implementation logic directly; write assertions and test harnesses.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 4096,
    },
    [ROLE_IDS.BUGFIX]: {
      id: ROLE_IDS.BUGFIX,
      name: 'Hotfix & Triage Engineer',
      category: 'Diagnostic & Defect Elimination',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'low',
      skills: ['dsh-plugin-authoring', 'ponytail'],
      tools: ['view_file', 'grep_search', 'replace_file_content', 'run_command'],
      systemPrompt: [
        'You are the Hotfix Engineer.',
        'Responsibilities: Perform root-cause diagnosis of defects, apply targeted minimal fixes, verify that no regressions are introduced, and confirm the fix passes test suites.',
        'Strict Boundaries: NEVER refactor unrelated code. Adhere to minimal blast radius.',
      ].join(' '),
      temperature: 0.1,
      maxTokens: 4096,
    },
    [ROLE_IDS.DOCS]: {
      id: ROLE_IDS.DOCS,
      name: 'Documentation Specialist',
      category: 'Technical Writing & Releases',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'low',
      skills: ['dsh-documentation-standard', 'dhs-plugin-release-workflow'],
      tools: ['view_file', 'replace_file_content', 'write_to_file'],
      systemPrompt: [
        'You are the Lead Technical Writer.',
        'Responsibilities: Produce rich technical documentation following the additive gate standard. Maintain README in English, Russian, and Chinese, documenting features, settings, API endpoints, and verification evidence.',
        'Strict Boundaries: Never delete or overwrite previous feature documentation; update by addition.',
      ].join(' '),
      temperature: 0.3,
      maxTokens: 4096,
    },
    [ROLE_IDS.REFACTORING]: {
      id: ROLE_IDS.REFACTORING,
      name: 'Refactoring & Optimization Specialist',
      category: 'Complexity Reduction & Performance',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'medium',
      skills: ['ponytail', 'ponytail-review', 'full-output-enforcement'],
      tools: ['view_file', 'grep_search', 'replace_file_content', 'run_command'],
      systemPrompt: [
        'You are the Refactoring Specialist.',
        'Responsibilities: Hunt for complexity, remove dead flexibility, replace custom helpers with native standard library methods, reduce bundle size below 250 KiB, and verify that all test suites remain 100% green.',
        'Strict Boundaries: Never alter external public APIs or break backwards compatibility.',
      ].join(' '),
      temperature: 0.2,
      maxTokens: 8192,
    },
    [ROLE_IDS.RESEARCH]: {
      id: ROLE_IDS.RESEARCH,
      name: 'Research & Spike Engineer',
      category: 'Exploration & Technology Evaluation',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'high',
      skills: ['planning-with-files'],
      tools: ['view_file', 'grep_search', 'search_web'],
      systemPrompt: [
        'You are the Research & Spike Specialist.',
        'Responsibilities: Conduct technical evaluations, evaluate trade-offs between libraries or model providers, benchmark latency/cost, and build isolated proof-of-concepts.',
        'Strict Boundaries: Deliver findings and recommendations report; do not merge exploratory code into production branches.',
      ].join(' '),
      temperature: 0.3,
      maxTokens: 4096,
    },
    [ROLE_IDS.DEVOPS]: {
      id: ROLE_IDS.DEVOPS,
      name: 'DevOps & Tooling Engineer',
      category: 'Packaging, CI & Environment',
      defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      reasoningEffort: 'low',
      skills: ['dhs-plugin-release-workflow'],
      tools: ['view_file', 'run_command', 'write_to_file'],
      systemPrompt: [
        'You are the DevOps & Tooling Specialist.',
        'Responsibilities: Configure package manifests, verify npm pack file sizes (<256 KiB), maintain build scripts, validate systemd units, and automate verification workflows.',
        'Strict Boundaries: Never expose credentials or private network IPs. Use credential references exclusively.',
      ].join(' '),
      temperature: 0.1,
      maxTokens: 4096,
    },
  }
}

/**
 * Default scenario topologies: hotfix (1), simple (2), medium (3-4), complex (5-6), enterprise (7+).
 */
export function getDefaultScenarios() {
  return {
    hotfix: {
      id: 'hotfix',
      title: 'Hotfix / Trivial (1 Stage)',
      description: 'Instant defect elimination or single-parameter tweak with direct verification.',
      stages: [
        {
          id: 'stage_hotfix',
          name: 'Hotfix Implementation & Smoke Test',
          roleId: ROLE_IDS.BUGFIX,
          dependsOn: [],
          isParallelAllowed: false,
          subtaskScope: 'Locate the defect, apply targeted minimal fix, and verify zero regressions.',
        },
      ],
    },
    simple: {
      id: 'simple',
      title: 'Simple Scenario (2 Stages)',
      description: 'Clarification/Spec followed by targeted execution (e.g. Design, Backend fix, or Docs).',
      stages: [
        {
          id: 'stage_spec',
          name: 'Task Discussion & Scope Specification',
          roleId: ROLE_IDS.SPEC,
          dependsOn: [],
          isParallelAllowed: false,
          subtaskScope: 'Clarify objectives, formulate acceptance criteria, and establish boundary constraints.',
        },
        {
          id: 'stage_exec',
          name: 'Targeted Implementation',
          roleId: ROLE_IDS.UI_DESIGN,
          dependsOn: ['stage_spec'],
          isParallelAllowed: false,
          subtaskScope: 'Execute the agreed specification with complete, production-ready deliverables.',
        },
      ],
    },
    medium: {
      id: 'medium',
      title: 'Medium Scenario (3–4 Stages)',
      description: 'Standard feature development with strict separation of design, implementation, and testing.',
      stages: [
        {
          id: 'stage_spec',
          name: '1. Specification & Requirements',
          roleId: ROLE_IDS.SPEC,
          dependsOn: [],
          isParallelAllowed: false,
          subtaskScope: 'Define technical specification, schemas, and DoD criteria.',
        },
        {
          id: 'stage_design',
          name: '2. UI Design & Layouts',
          roleId: ROLE_IDS.UI_DESIGN,
          dependsOn: ['stage_spec'],
          isParallelAllowed: false,
          subtaskScope: 'Create UI layouts, theme CSS variables, and slot specifications.',
        },
        {
          id: 'stage_frontend',
          name: '3. Frontend Code Implementation',
          roleId: ROLE_IDS.FRONTEND,
          dependsOn: ['stage_design'],
          isParallelAllowed: false,
          subtaskScope: 'Implement client React components based strictly on the approved design.',
        },
        {
          id: 'stage_tests',
          name: '4. Automated Verification & QA',
          roleId: ROLE_IDS.QA_TESTS,
          dependsOn: ['stage_frontend'],
          isParallelAllowed: false,
          subtaskScope: 'Verify frontend logic, mock APIs, and ensure edge cases pass cleanly.',
        },
      ],
    },
    complex: {
      id: 'complex',
      title: 'Complex Scenario (5–6 Stages)',
      description: 'Full multi-agent engineering lifecycle: Spec -> Architecture -> Design -> Code -> QA -> Trilingual Docs.',
      stages: [
        {
          id: 'stage_1_spec',
          name: '1. Technical Specification',
          roleId: ROLE_IDS.SPEC,
          dependsOn: [],
          isParallelAllowed: false,
          subtaskScope: 'Draft functional requirements, acceptance criteria, and boundary constraints.',
        },
        {
          id: 'stage_2_architecture',
          name: '2. System Design & DESIGN.md',
          roleId: ROLE_IDS.ARCHITECTURE,
          dependsOn: ['stage_1_spec'],
          isParallelAllowed: false,
          subtaskScope: 'Produce DESIGN.md, define Cordis service interfaces, and structure module boundaries.',
        },
        {
          id: 'stage_3_ui_design',
          name: '3. UI/UX Interface Design',
          roleId: ROLE_IDS.UI_DESIGN,
          dependsOn: ['stage_2_architecture'],
          isParallelAllowed: true,
          subtaskScope: 'Design client components, CSS theme variables, and interactive states.',
        },
        {
          id: 'stage_4_code',
          name: '4. Code Implementation',
          roleId: ROLE_IDS.FRONTEND,
          dependsOn: ['stage_2_architecture', 'stage_3_ui_design'],
          isParallelAllowed: false,
          subtaskScope: 'Implement software modules adhering to architectural contracts and design layouts.',
        },
        {
          id: 'stage_5_qa_tests',
          name: '5. Automated Testing & Verification',
          roleId: ROLE_IDS.QA_TESTS,
          dependsOn: ['stage_4_code'],
          isParallelAllowed: false,
          subtaskScope: 'Develop and execute exhaustive unit tests (`node --test test/*.test.mjs`).',
        },
        {
          id: 'stage_6_docs',
          name: '6. Trilingual Documentation & Release Notes',
          roleId: ROLE_IDS.DOCS,
          dependsOn: ['stage_4_code', 'stage_5_qa_tests'],
          isParallelAllowed: false,
          subtaskScope: 'Update README in English, Russian, and Chinese following additive documentation gate.',
        },
      ],
    },
    enterprise: {
      id: 'enterprise',
      title: 'Enterprise / Deep R&D (7 Stages)',
      description: 'Full exploratory and fullstack lifecycle with parallel backend/frontend branches and QA gate.',
      stages: [
        {
          id: 'stage_1_research',
          name: '1. Spike & Technology Research',
          roleId: ROLE_IDS.RESEARCH,
          dependsOn: [],
          isParallelAllowed: false,
          subtaskScope: 'Investigate libraries, external APIs, and evaluate trade-offs.',
        },
        {
          id: 'stage_2_spec',
          name: '2. Specification & Contracts',
          roleId: ROLE_IDS.SPEC,
          dependsOn: ['stage_1_research'],
          isParallelAllowed: false,
          subtaskScope: 'Draft technical specification and formal acceptance contracts.',
        },
        {
          id: 'stage_3_arch',
          name: '3. System Architecture & DESIGN.md',
          roleId: ROLE_IDS.ARCHITECTURE,
          dependsOn: ['stage_2_spec'],
          isParallelAllowed: false,
          subtaskScope: 'Formulate system architecture and define decoupled API interfaces.',
        },
        {
          id: 'stage_4_backend',
          name: '4. Backend Services & Routes',
          roleId: ROLE_IDS.BACKEND,
          dependsOn: ['stage_3_arch'],
          isParallelAllowed: true,
          subtaskScope: 'Implement Cordis host services, WebServer routes, and data persistence.',
        },
        {
          id: 'stage_4_design',
          name: '4. UI/UX Interface Design',
          roleId: ROLE_IDS.UI_DESIGN,
          dependsOn: ['stage_3_arch'],
          isParallelAllowed: true,
          subtaskScope: 'Design client components, slot registrations, and theme tokens.',
        },
        {
          id: 'stage_5_frontend',
          name: '5. Frontend Assembly',
          roleId: ROLE_IDS.FRONTEND,
          dependsOn: ['stage_4_backend', 'stage_4_design'],
          isParallelAllowed: false,
          subtaskScope: 'Assemble client React components and wire with backend API routes.',
        },
        {
          id: 'stage_6_qa',
          name: '6. End-to-End & Automated QA',
          roleId: ROLE_IDS.QA_TESTS,
          dependsOn: ['stage_5_frontend'],
          isParallelAllowed: false,
          subtaskScope: 'Execute full test suite verifying backend, frontend contracts, and error resilience.',
        },
        {
          id: 'stage_7_docs',
          name: '7. Trilingual Docs & Release Gate',
          roleId: ROLE_IDS.DOCS,
          dependsOn: ['stage_6_qa'],
          isParallelAllowed: false,
          subtaskScope: 'Produce comprehensive multi-language documentation and prepare release manifest.',
        },
      ],
    },
  }
}

/**
 * Validates a scenario object and its DAG stages.
 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') {
    throw new Error('Scenario must be an object')
  }
  if (!scenario.id || !Array.isArray(scenario.stages)) {
    throw new Error('Scenario must have an id and a stages array')
  }
  validateGraph(scenario.stages)
  return true
}

